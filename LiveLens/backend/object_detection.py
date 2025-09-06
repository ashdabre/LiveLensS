import torch

# Load YOLOv5n model from Ultralytics
model = torch.hub.load('ultralytics/yolov5', 'custom', path='inference_server/models/yolov5n.pt')

def detect_objects(frame):
    results = model(frame)
    return results.pandas().xyxy[0].to_dict(orient="records")
