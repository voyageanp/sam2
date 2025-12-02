import sys
import os
import json
import logging
from pathlib import Path
from typing import Dict, Any

# Add server directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from inference.predictor import InferenceAPI
from inference.data_types import (
    StartSessionRequest,
    AddPointsRequest,
    AddMaskRequest,
    ClearPointsInFrameRequest,
    ClearPointsInVideoRequest,
    RemoveObjectRequest,
    PropagateInVideoRequest,
    CloseSessionRequest,
    Mask
)
from app_conf import DATA_PATH

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def replay_requests(log_path: str = None):
    if log_path is None:
        log_path = DATA_PATH / "api_requests.jsonl"
    
    if not os.path.exists(log_path):
        logger.error(f"Log file not found: {log_path}")
        return

    api = InferenceAPI()
    # Disable recording during replay to avoid infinite loop/duplication
    api.record_requests = False
    
    # Map request types to classes
    request_classes = {
        "StartSessionRequest": StartSessionRequest,
        "AddPointsRequest": AddPointsRequest,
        "AddMaskRequest": AddMaskRequest,
        "ClearPointsInFrameRequest": ClearPointsInFrameRequest,
        "ClearPointsInVideoRequest": ClearPointsInVideoRequest,
        "RemoveObjectRequest": RemoveObjectRequest,
        "PropagateInVideoRequest": PropagateInVideoRequest,
        "CloseSessionRequest": CloseSessionRequest
    }

    logger.info(f"Replaying requests from {log_path}")
    
    with open(log_path, "r") as f:
        for line in f:
            try:
                entry = json.loads(line)
                method_name = entry["method"]
                request_type = entry["request_type"]
                request_data = entry["request_data"]
                
                logger.info(f"Replaying {method_name} ({request_type})")
                
                if request_type not in request_classes:
                    logger.warning(f"Unknown request type: {request_type}")
                    continue
                
                # Reconstruct request object
                req_class = request_classes[request_type]
                
                # Handle nested objects (like Mask)
                if request_type == "AddMaskRequest" and "mask" in request_data:
                    mask_data = request_data["mask"]
                    request_data["mask"] = Mask(**mask_data)
                
                request = req_class(**request_data)
                
                # Call method
                method = getattr(api, method_name)
                result = method(request)
                
                # Handle generator results (propagate_in_video)
                if method_name == "propagate_in_video":
                    count = 0
                    for _ in result:
                        count += 1
                    logger.info(f"Propagate yielded {count} frames")
                else:
                    logger.info(f"Result: {result}")
                    
            except Exception as e:
                logger.error(f"Error replaying line: {e}")

if __name__ == "__main__":
    replay_requests()
