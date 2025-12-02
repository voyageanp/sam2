import sys
import os
from unittest.mock import MagicMock, patch
from pathlib import Path
import torch
import numpy as np

import logging

# Add server directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Configure logging
logging.basicConfig(level=logging.INFO)

# Mock app_conf before importing predictor
sys.modules["app_conf"] = MagicMock()
sys.modules["app_conf"].INFERENCE_MODE = "cut-and-selected-frame-concat"
sys.modules["app_conf"].CHUNK_SIZE = 10
sys.modules["app_conf"].SAVE_PREDICTIONS = False
sys.modules["app_conf"].MODEL_SIZE = "tiny"
sys.modules["app_conf"].APP_ROOT = "/tmp"
sys.modules["app_conf"].DATA_PATH = Path("/tmp")
sys.modules["app_conf"].FFMPEG_NUM_THREADS = 1

# Mock sam2.build_sam
sys.modules["sam2"] = MagicMock()
sys.modules["sam2.build_sam"] = MagicMock()
sys.modules["sam2.build_sam"].build_sam2_video_predictor = MagicMock()

# Mock pycocotools
sys.modules["pycocotools"] = MagicMock()
sys.modules["pycocotools.mask"] = MagicMock()
sys.modules["pycocotools.mask"].decode = MagicMock()
sys.modules["pycocotools.mask"].encode = MagicMock(return_value={"size": [100, 100], "counts": b"counts"})

from inference.predictor import InferenceAPI, encode_masks
from inference.data_types import StartSessionRequest, PropagateInVideoRequest

def test_chunked_propagation():
    print("Starting test_chunked_propagation")
    
    # Patch encode_masks in predictor module
    patcher = patch("inference.predictor.encode_masks")
    mock_encode = patcher.start()
    mock_encode.return_value = {"size": [100, 100], "counts": b"counts"}
    print(f"encode_masks return: {mock_encode(np.zeros((10,10)))}")
    
    api = InferenceAPI()
        
    # Mock predictor
    mock_predictor = MagicMock()
    api.predictor = mock_predictor
    api.device = MagicMock()
    api.device.type = "cpu"
    
    # Mock init_state to return dummy state
    call_count = 0
    def mock_init_state(path, offload_video_to_cpu, start_frame=0, max_frames=None):
        nonlocal call_count
        call_count += 1
        print(f"init_state called with start_frame={start_frame}")
        
        if start_frame >= 30: # Simulate end of video
             raise RuntimeError("End of video")
             
        return {
            "num_frames": 10, # Chunk size
            "start_frame_offset": start_frame,
            "obj_ids": [1],
            "video_height": 100,
            "video_width": 100,
            "images": [None]*10
        }
    mock_predictor.init_state.side_effect = mock_init_state
    
    # Mock propagate_in_video to yield dummy results
    def mock_propagate(inference_state, start_frame_idx, max_frame_num_to_track, reverse):
        print(f"propagate called with start_frame_idx={start_frame_idx}")
        # Yield 10 frames (0-9)
        for i in range(10):
            if i < start_frame_idx: continue
            yield i, [1], torch.zeros(1, 1, 100, 100)
            
    mock_predictor.propagate_in_video.side_effect = mock_propagate
    
    # Mock add_new_mask
    mock_predictor.add_new_mask.return_value = (0, [1], torch.zeros(1, 1, 100, 100))
    
    # Start session
    req = StartSessionRequest(path="dummy.mp4", type="start_session")
    resp = api.start_session(req)
    session_id = resp.session_id
    
    # Propagate
    prop_req = PropagateInVideoRequest(
        session_id=session_id,
        start_frame_index=0,
        type="propagate_in_video"
    )
    
    # Consume generator
    results = list(api.propagate_in_video(prop_req))
    
    print(f"Total results: {len(results)}")
    frame_indices = [r.frame_index for r in results]
    print(f"Frame indices: {frame_indices}")
    
    # Expected:
    # Chunk 1 (0-9): Yields 0, 1, ..., 9.
    # Chunk 2 (9-18): Yields 10, ..., 18. (Skipping 9)
    # Chunk 3 (18-27): Yields 19, ..., 27. (Skipping 18)
    # Chunk 4 (27-36): init_state fails (>=30).
    
    # Total frames: 10 + 9 + 9 = 28 frames?
    # 0-9 (10 frames)
    # 10-18 (9 frames)
    # 19-27 (9 frames)
    # Total 28.
    
    expected_indices = list(range(28))
    assert frame_indices == expected_indices, f"Mismatch! Got {frame_indices}"
    print("Test passed!")

    patcher.stop()

if __name__ == "__main__":
    test_chunked_propagation()
