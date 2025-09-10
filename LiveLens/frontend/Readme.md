# Frontend – WebRTC Object Detection

This folder contains the **browser-based client** for real-time video streaming and inference visualization.

## Features
- Join as **Viewer** (browser) or **Phone** (mobile camera).
- Stream video from a phone camera to a browser using **WebRTC**.
- Select inference mode:
  - **WASM mode**: Runs object detection directly in the browser using ONNX Runtime Web.
  - **Server mode**: Sends frames to the backend for inference.
- Overlay bounding boxes on detected objects in real-time.
- Start/Stop inference dynamically with buttons.
- Generates a **phone link or QR code** so mobile can join the same room.

## Key Files
- `main.js` → Core logic for roles, inference, overlay handling.
- `overlay.js` → Canvas drawing for bounding boxes.
- `signaling.js` → WebRTC signaling (via backend).
- `inference_wasm.js` → Browser-side WASM inference.
- `index.html` → UI for Viewer and Phone roles.

## How to Run (Frontend Only)
1. Install dependencies:
   ```bash
   npm install
