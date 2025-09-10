
---

## Click Start Viewer, copy phone URL, and join from your phone. 

```markdown
# Backend – Python Inference & Signaling

This folder contains the **backend services**:  
- A **Python server** (port 5001) for ONNX inference and metrics.  
- A **Node.js WebSocket server** (port 4000) for WebRTC signaling.  
```
## Features
- ONNX Runtime inference with YOLOv5n (or fallback dummy detections).
- REST API endpoints:
  - `/update` → Push new frames.
  - `/recent?n=10` → Get recent frames.
  - `/count` → Count frames in memory.
- WebSocket (`/ws`) for real-time inference streaming.
- Periodically stores detection results + stats in **`metrics.json`**.
- Tracks FPS, latency, and average accuracy for analysis.
- Signaling server manages rooms and peer connections for WebRTC.

## Key Files
- `app.py` → aiohttp-based Python server (inference + metrics).
- `metrics.json` → Rolling log of recent detections and stats.
- `signaling.js` (Node.js) → Manages WebRTC rooms and ICE candidates.

## How to Run (Backend Only)
### Python Inference Server
```bash
cd backend
pip install -r requirements.txt
python app.py
```

or to ease everything up simply fetc containers from docker and run the build commds the frontend and bacjkend will execute simultaenously

```bash
docker-compose up --build
```
