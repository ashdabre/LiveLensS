# LiveLensS  -WebRTC-based Object Detection

LiveLensS is a WebRTC-based vision intelligence project that enables real-time camera streaming and AI-powered analysis.  

## Features  
- WebRTC-based live video streaming  
- AI-powered inference (YOLOv5n model)  
- Frontend and backend integration

  ```markdown
# Real-Time Multi-Object Detection with WebRTC + ONNX

This project demonstrates a **real-time multi-object detection system** where:
- A **phone streams live video** via WebRTC.
- A **browser acts as a viewer**, displaying the stream.
- **Object detection** runs in either:
  - **WASM mode**: Directly in the browser with ONNX Runtime Web.
  - **Server mode**: On the backend Python server (ONNX).

Bounding boxes are overlaid in near real-time, and performance metrics are logged.

---

## 🏗 System Architecture
- **Frontend (Browser/Phone)**  
  Handles video capture, rendering, and inference visualization.  
- **Backend (Python)**  
  Runs ONNX inference, serves metrics, and provides WebSocket inference endpoint.  
- **Signaling Server (Node.js)**  
  Handles WebRTC peer connection setup and room management.
---

## Getting Started  

1. Clone the repository  
```bash
git clone https://github.com/ashdabre/LiveLensS.git
cd LiveLensS
```

1. Open http://localhost:3000 on your laptop.

2. Scan the displayed QR code with your phone.

3. Allow camera access; view live video with AI overlays.

---
### Run with Docker

### Build and start containers
```bash 
docker-compose up --build
This runs the demo in a containerized environment. The same QR code steps apply.

```

### Modes
MODE=wasm → On-device WASM inference, low CPU, no GPU required

MODE=server → Server-side inference for higher accuracy or GPU use



Deliverables
metrics.json inside backend folder  with median & P95 latency, FPS, bandwidth

1-minute Loom video showing phone stream, overlays, and metrics

Short report explaining design choices, low-resource mode, and backpressure strategy

This runs the demo in a containerized environment. The same QR code steps apply.
Modes



Video demo- https://www.loom.com/share/8c5c9360bd724cf3867ab8ee8c31869d?sid=1d99f19c-4b0f-4e9b-a6bb-5177e57956ca
