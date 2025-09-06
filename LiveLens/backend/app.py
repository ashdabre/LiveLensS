# app.py
import os
import io
import time
import json
import base64
import asyncio
from aiohttp import web
from PIL import Image
import numpy as np

# ---------- ONNX Model Setup ----------
try:
    import onnxruntime as ort
    providers = ["CPUExecutionProvider"]
    sess = ort.InferenceSession(os.environ.get("MODEL_PATH", "models/yolov5n.onnx"), providers=providers)
    input_name = sess.get_inputs()[0].name
    output_name = sess.get_outputs()[0].name
    print("Loaded ONNX model")
except Exception as e:
    print("ONNX load failed or not present, using dummy detections:", e)
    sess = None
    input_name = output_name = None

# ---------- Inference Parameters ----------
INPUT_SIZE = 320
SCORE_THR = 0.25
NMS_IOU_THR = 0.45
MAX_DETS = 50

# ---------- COCO Classes ----------
COCO80 = [
    "person","bicycle","car","motorbike","aeroplane","bus","train","truck","boat","traffic light",
    "fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow",
    "elephant","bear","zebra","giraffe","backpack","umbrella","handbag","suitcase",
    "frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard",
    "surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana",
    "apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","sofa",
    "pottedplant","bed","diningtable","toilet","tvmonitor","laptop","mouse","remote","keyboard",
    "cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase",
    "scissors","teddy bear","hair drier","toothbrush"
]

# ---------- Recent Frames ----------
RECENT_FRAMES = []
MAX_RECENT = 100

# ---------- Helper Functions ----------
def letterbox(img, new_size=INPUT_SIZE, color=(0,0,0)):
    w, h = img.size
    r = min(new_size / w, new_size / h)
    nw, nh = int(w * r), int(h * r)
    dw, dh = (new_size - nw) // 2, (new_size - nh) // 2
    out = Image.new("RGB", (new_size, new_size), color)
    out.paste(img.resize((nw, nh), Image.BILINEAR), (dw, dh))
    return out, (nw, nh, dw, dh)

def to_chw_float(img_pil):
    arr = np.asarray(img_pil).astype(np.float32) / 255.0
    chw = np.transpose(arr, (2,0,1))
    return np.expand_dims(chw, 0)

def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))

def iou_xyxy(a, b):
    x1 = max(a[0], b[0]); y1 = max(a[1], b[1])
    x2 = min(a[2], b[2]); y2 = min(a[3], b[3])
    inter = max(0, x2-x1) * max(0, y2-y1)
    areaA = max(0, a[2]-a[0]) * max(0, a[3]-a[1])
    areaB = max(0, b[2]-b[0]) * max(0, b[3]-b[1])
    union = areaA + areaB - inter
    return 0.0 if union <= 0 else inter / union

def nms(boxes, scores, iou_thr, max_dets):
    if len(boxes) == 0: return []
    idxs = list(np.argsort(-np.array(scores)))
    keep = []
    while idxs and len(keep) < max_dets:
        i = idxs.pop(0)
        keep.append(i)
        idxs = [j for j in idxs if iou_xyxy(boxes[i], boxes[j]) <= iou_thr]
    return keep

def decode_yolo(out, scale_meta):
    if out.ndim == 3: out = out[0]
    N, C = out.shape
    boxes, scores, clses = [], [], []

    for i in range(N):
        cx, cy, w, h = out[i, 0:4]
        obj = sigmoid(out[i, 4])
        if obj < SCORE_THR: continue
        cls_probs = sigmoid(out[i, 5:])
        c = int(np.argmax(cls_probs))
        conf = obj * cls_probs[c]
        if conf < SCORE_THR: continue
        x1, y1, x2, y2 = cx-w/2, cy-h/2, cx+w/2, cy+h/2
        boxes.append([x1, y1, x2, y2])
        scores.append(float(conf))
        clses.append(c)

    if not boxes: return []
    boxes = np.array(boxes, dtype=np.float32)
    scores = np.array(scores, dtype=np.float32)
    keep = nms(boxes.tolist(), scores.tolist(), NMS_IOU_THR, MAX_DETS)
    boxes, scores = boxes[keep], scores[keep]
    clses = [clses[k] for k in keep]

    nw, nh, dw, dh = scale_meta
    dets = []
    for (x1, y1, x2, y2), s, c in zip(boxes, scores, clses):
        x1, y1, x2, y2 = x1-dw, y1-dh, x2-dw, y2-dh
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(nw, x2), min(nh, y2)
        dets.append({
            "label": COCO80[c] if 0 <= c < len(COCO80) else f"cls{c}",
            "score": float(s),
            "xmin": float(x1/nw), "ymin": float(y1/nh),
            "xmax": float(x2/nw), "ymax": float(y2/nh)
        })
    return dets

# ---------- aiohttp app ----------
app = web.Application()

# ---------- CORS middleware ----------
@web.middleware
async def simple_cors_middleware(request, handler):
    if request.method == 'OPTIONS':
        resp = web.Response(status=200)
        resp.headers['Access-Control-Allow-Origin'] = '*'
        resp.headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS'
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
        return resp
    resp = await handler(request)
    resp.headers['Access-Control-Allow-Origin'] = '*'
    return resp

app.middlewares.append(simple_cors_middleware)

# ---------- REST endpoints ----------
async def count(request):
    print(f"/count requested | Total frames in memory: {len(RECENT_FRAMES)}")
    return web.json_response({"count": len(RECENT_FRAMES)})

async def recent(request):
    n = int(request.query.get("n", 10))
    recent_data = RECENT_FRAMES[-n:]
    print(f"/recent requested | Returning {len(recent_data)} frames")
    pretty_json = json.dumps({"recent": recent_data}, indent=2)
    return web.Response(text=pretty_json, content_type="application/json")

async def update(request):
    try:
        data = await request.json()
    except Exception as e:
        return web.json_response({"status":"error","message":"invalid json: "+str(e)}, status=400)

    frames = []
    if isinstance(data, dict) and "batch" in data and isinstance(data["batch"], list):
        frames = data["batch"]
    elif isinstance(data, list):
        frames = data
    elif isinstance(data, dict):
        frames = [data]
    else:
        return web.json_response({"status":"error","message":"unsupported payload"}, status=400)

    for f in frames:
        print("Received frame:", f.get("frame_id"), "detections:", len(f.get("detections", [])))
        RECENT_FRAMES.append(f)
        if len(RECENT_FRAMES) > MAX_RECENT:
            RECENT_FRAMES.pop(0)

    print(f"/update processed {len(frames)} frame(s) | Total in memory: {len(RECENT_FRAMES)}")
    pretty_json = json.dumps({"status":"ok","stored": len(frames)}, indent=2)
    return web.Response(text=pretty_json, content_type="application/json")

app.router.add_get("/count", count)
app.router.add_get("/recent", recent)
app.router.add_post("/update", update)
app.router.add_options("/update", lambda request: web.Response(status=200))

# ---------- WebSocket inference ----------
async def ws_handler(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    print("Client connected to inference WS")

    try:
        async for msg in ws:
            if msg.type != web.WSMsgType.TEXT:
                continue

            try:
                data = json.loads(msg.data)
            except Exception:
                continue

            if data.get("op") != "infer":
                continue

            frame_id = data.get("frame_id")
            capture_ts = data.get("capture_ts")
            img_b64 = data.get("image", "")
            if "," in img_b64:
                img_b64 = img_b64.split(",", 1)[1]

            detections = []
            recv_ts = int(time.time() * 1000)
            inf_ts = recv_ts

            if img_b64:
                try:
                    img = Image.open(io.BytesIO(base64.b64decode(img_b64))).convert("RGB")

                    if sess:  # Real ONNX inference
                        box_img, scale_meta = letterbox(img, INPUT_SIZE)
                        x = to_chw_float(box_img)
                        ort_inputs = {input_name: x}
                        out = sess.run([output_name], ort_inputs)[0]
                        detections = decode_yolo(out, scale_meta)
                        inf_ts = int(time.time() * 1000)
                    else:  # Dummy detection fallback
                        detections = [{"label": "person", "score": 0.88, "xmin": 0.2, "ymin": 0.1, "xmax": 0.45, "ymax": 0.7}]
                        inf_ts = int(time.time() * 1000)

                except Exception as e:
                    print("Image decode/inference failed:", e)

            # Compute actual mean confidence as accuracy
            accuracy = float(np.mean([d["score"] for d in detections])) if detections else 0.0

            payload = {
                "frame_id": frame_id,
                "capture_ts": capture_ts,
                "recv_ts": recv_ts,
                "inference_ts": inf_ts,
                "latency": recv_ts - capture_ts,
                "accuracy": accuracy,
                "detections": detections
            }

            # Store recent frames
            RECENT_FRAMES.append(payload)
            if len(RECENT_FRAMES) > MAX_RECENT:
                RECENT_FRAMES.pop(0)

            print(f"WS frame stored: {frame_id} | {len(detections)} detections | Total frames in memory: {len(RECENT_FRAMES)}")

            # Send back to client
            await ws.send_str(json.dumps(payload, indent=2))

    finally:
        await ws.close()
        print("Client disconnected from inference WS")

    return ws


app.router.add_get("/ws", ws_handler)
METRICS_FILE = "metrics.json"
SAVE_INTERVAL = 2.0  # seconds

async def save_metrics_periodically():
    while True:
        try:
            snapshot = {
                "recent": RECENT_FRAMES,
                "count": len(RECENT_FRAMES),
                "timestamp": int(time.time() * 1000)
            }

            with open(METRICS_FILE, "w") as f:
                json.dump(snapshot, f, indent=2)

            print(f"[metrics.json updated] {len(RECENT_FRAMES)} frames saved")

        except Exception as e:
            print("Error saving metrics.json:", e)

        await asyncio.sleep(SAVE_INTERVAL)


# Start background metrics task
async def start_background_tasks(app):
    app["metrics_task"] = asyncio.create_task(save_metrics_periodically())

async def cleanup_background_tasks(app):
    app["metrics_task"].cancel()
    await app["metrics_task"]

app.on_startup.append(start_background_tasks)
app.on_cleanup.append(cleanup_background_tasks)



# ---------- Run server ----------
if __name__ == "__main__":
    print("Starting server on port 5001 (WS + /update + /count + /recent)")
    web.run_app(app, port=5001)
