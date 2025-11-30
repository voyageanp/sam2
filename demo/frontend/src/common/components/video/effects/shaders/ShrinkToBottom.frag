#version 300 es
precision highp float;

uniform sampler2D uSampler;
uniform vec2 uSize;
uniform int uNumMasks;

// Max 3 masks supported for now, matching other effects
uniform sampler2D uMaskTexture0;
uniform sampler2D uMaskTexture1;
uniform sampler2D uMaskTexture2;

// [minX, minY, maxX, maxY]
uniform vec4 uMaskBounds0;
uniform vec4 uMaskBounds1;
uniform vec4 uMaskBounds2;

uniform float uShrinkRatio;

in vec2 vTexCoord;
out vec4 outColor;

void main() {
  vec4 finalColor = texture(uSampler, vTexCoord);
  bool isOriginalObject = false;

  // 1. Check if pixel is part of ANY original mask (to be erased)
  for (int i = 0; i < 3; i++) {
    if (i >= uNumMasks) break;
    
    sampler2D maskTexture;
    if (i == 0) maskTexture = uMaskTexture0;
    else if (i == 1) maskTexture = uMaskTexture1;
    else maskTexture = uMaskTexture2;

    float maskVal = texture(maskTexture, vTexCoord).r;
    if (maskVal > 0.5) {
      isOriginalObject = true;
      break;
    }
  }

  if (isOriginalObject) {
    finalColor = vec4(1.0, 1.0, 1.0, 1.0); // Make it white
  }

  // 2. Check if pixel is part of the SHRUNK object (to be drawn)
  for (int i = 0; i < 3; i++) {
    if (i >= uNumMasks) break;

    vec4 bounds;
    sampler2D maskTexture;

    if (i == 0) {
      bounds = uMaskBounds0;
      maskTexture = uMaskTexture0;
    } else if (i == 1) {
      bounds = uMaskBounds1;
      maskTexture = uMaskTexture1;
    } else {
      bounds = uMaskBounds2;
      maskTexture = uMaskTexture2;
    }

    // Original bounds
    float minX = bounds.x;
    float minY = bounds.y;
    float maxX = bounds.z;
    float maxY = bounds.w;
    
    float width = maxX - minX;
    float height = maxY - minY;

    // Target bounds (uShrinkRatio size, aligned to bottom center)
    float scale = uShrinkRatio;
    float newWidth = width * scale;
    float newHeight = height * scale;

    float newMinX = minX + (width - newWidth) / 2.0;
    float newMaxX = newMinX + newWidth;
    float newMaxY = maxY; // Align to bottom
    float newMinY = newMaxY - newHeight;

    // Current pixel position in pixels
    float currentX = vTexCoord.x * uSize.x;
    float currentY = (1.0 - vTexCoord.y) * uSize.y; // 0 at top, H at bottom

    // Check if current pixel is inside the "new" (shrunk) bounds
    if (currentX >= newMinX && currentX <= newMaxX && currentY >= newMinY && currentY <= newMaxY) {
      // Map back to original object coordinates
      float normalizedX = (currentX - newMinX) / newWidth;
      float normalizedY = (currentY - newMinY) / newHeight;

      float origX = minX + normalizedX * width;
      float origY = minY + normalizedY * height;

      // Convert orig pixel coords to UV
      vec2 origUV = vec2(origX / uSize.x, 1.0 - (origY / uSize.y));

      // Sample mask at original location
      float maskVal = texture(maskTexture, origUV).r;

      if (maskVal > 0.5) {
        // It's part of the object in the original scale
        finalColor = texture(uSampler, origUV);
      }
    }
  }

  outColor = finalColor;
}
