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

in vec2 vTexCoord;
out vec4 outColor;

void main() {
  vec4 color = texture(uSampler, vTexCoord);
  vec4 finalColor = color;

  // Iterate over masks
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

    // Target bounds (0.9x size, aligned to bottom center)
    float scale = 0.9;
    float newWidth = width * scale;
    float newHeight = height * scale;

    float newMinX = minX + (width - newWidth) / 2.0;
    float newMaxX = newMinX + newWidth;
    float newMaxY = maxY; // Align to bottom
    float newMinY = newMaxY - newHeight;

    // Current pixel position in pixels
    float px = vTexCoord.x * uSize.x;
    float py = (1.0 - vTexCoord.y) * uSize.y; // WebGL Y is flipped relative to pixel coords usually? 
    // Wait, vTexCoord (0,0) is bottom-left in WebGL usually.
    // uSampler is usually flipped or not?
    // In BaseGLEffect: gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    // And texCoordBufferData is [1.0, 1.0, 0.0, 1.0, 1.0, 0.0, 0.0, 0.0] (Triangle Strip)
    // Vertices: 1.0, 1.0 (TR), -1.0, 1.0 (TL), 1.0, -1.0 (BR), -1.0, -1.0 (BL)
    // TexCoords: 1,1 (TR), 0,1 (TL), 1,0 (BR), 0,0 (BL)
    // So vTexCoord (0,0) is Bottom-Left, (1,1) is Top-Right.
    
    // However, image coordinates usually have (0,0) at Top-Left.
    // If UNPACK_FLIP_Y_WEBGL is true, the texture is flipped.
    // So texture(uSampler, vec2(0,0)) samples the bottom-left of the image data?
    // Or does it sample the top-left because it was flipped?
    
    // Let's assume standard UV: u=x/width, v=1.0 - y/height (if y is 0 at top)
    // If vTexCoord.y=0 is bottom, and image y=0 is top.
    
    // Let's look at how other shaders handle this or assume standard behavior.
    // Cutout.frag doesn't use coordinates, just samples.
    
    // Let's use normalized coordinates for bounds to simplify.
    // Bounds are likely in pixels (based on EffectFrameContext).
    
    // Convert current pixel to pixel coords (origin top-left for logic, but need to match texture)
    // If vTexCoord.y=1 is Top.
    float currentX = vTexCoord.x * uSize.x;
    float currentY = (1.0 - vTexCoord.y) * uSize.y; // 0 at top, H at bottom

    // Check if current pixel is inside the "new" (shrunk) bounds
    if (currentX >= newMinX && currentX <= newMaxX && currentY >= newMinY && currentY <= newMaxY) {
      // Map back to original object coordinates
      // (currentX - newMinX) / newWidth = (origX - minX) / width
      float normalizedX = (currentX - newMinX) / newWidth;
      float normalizedY = (currentY - newMinY) / newHeight;

      float origX = minX + normalizedX * width;
      float origY = minY + normalizedY * height;

      // Convert orig pixel coords to UV
      vec2 origUV = vec2(origX / uSize.x, 1.0 - (origY / uSize.y));

      // Sample mask at original location
      // Mask textures are likely LUMINANCE, so .r is the value.
      float maskVal = texture(maskTexture, origUV).r;

      if (maskVal > 0.5) {
        // It's part of the object in the original scale
        // Sample the original image color at that location
        vec4 objColor = texture(uSampler, origUV);
        
        // Overlay logic: simple alpha blend or replacement
        // Since we want to "layer" it, we can just replace or blend.
        // Let's replace for now, maybe blend with alpha if objColor has alpha (usually video is opaque)
        finalColor = objColor;
      }
    }
  }

  outColor = finalColor;
}
