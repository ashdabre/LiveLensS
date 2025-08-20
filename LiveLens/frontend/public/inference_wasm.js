// // frontend/public/inference_wasm.js
// Real YOLOv5n inference with onnxruntime-web (WASM)

let running = false;
let loopTimer = null;
let session = null;

const INPUT_SIZE = 320;            // YOLOv5n 320x320
const SCORE_THR = 0.35;
const NMS_IOU_THR = 0.3;
const MAX_DETS = 50;

// COCO80 labels
const COCO80 = [
  "person","bicycle","car","motorbike","aeroplane","bus","train","truck","boat","traffic light",
  "fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse","sheep","cow",
  "elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie","suitcase",
  "frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove","skateboard",
  "surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon","bowl","banana",
  "apple","sandwich","orange","broccoli","carrot","hot dog","pizza","donut","cake","chair","sofa",
  "pottedplant","bed","diningtable","toilet","tvmonitor","laptop","mouse","remote","keyboard",
  "cell phone","microwave","oven","toaster","sink","refrigerator","book","clock","vase",
  "scissors","teddy bear","hair drier","toothbrush"
];
// ---------- BACKEND FORWARDING (add this into inference_wasm.js) ----------
let BACKEND_URL = null;          // e.g. "http://localhost:5000/update"
const _sendQueue = [];           // queue of payloads to send
const _maxRetries = 3;
let _flushTimer = null;
const _flushIntervalMs = 200;    // flush queue every 200ms

export function enableBackendForwarding(url = "http://localhost:5001/update") {
  BACKEND_URL = url;
  if (!_flushTimer) {
    _flushTimer = setInterval(_flushQueue, _flushIntervalMs);
  }
}


export function disableBackendForwarding() {
  BACKEND_URL = null;
  if (_flushTimer) {
    clearInterval(_flushTimer);
    _flushTimer = null;
  }
}

function enqueuePayload(payload) {
  // attach retry count
  _sendQueue.push({ payload, retries: 0 });
}

async function _flushQueue() {
  if (!BACKEND_URL) return;
  if (_sendQueue.length === 0) return;

  // take up to a few items to send in one POST (batch)
  const batch = _sendQueue.splice(0, 4); // send up to 4 frames per request
  const body = batch.map(b => b.payload);

  try {
 console.log("Sending payload to backend:", body); // log BEFORE sending

const resp = await fetch(BACKEND_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body.length === 1 ? body[0] : { batch: body }) // support single-frame or a small batch
});

    if (!resp.ok) {
      throw new Error(`status ${resp.status}`);
    }

    // success -> do nothing (items already removed from queue)
    // optionally parse JSON if backend returns useful info
  } catch (err) {
    console.warn("Failed to send detection batch:", err);
    // requeue with retry logic
    for (const item of batch) {
      item.retries += 1;
      if (item.retries <= _maxRetries) {
        _sendQueue.unshift(item); // add back to front to retry soon
      } else {
        console.error("Dropping payload after retries:", item.payload.frame_id ?? "(no id)");
      }
    }
  }
}
// ---------- END BACKEND FORWARDING ----------

async function ensureOrt() {
  if (window.ort && session) return;
  if (!window.ort) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/ort.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  // prefer wasm backend
  ort.env.wasm.numThreads = 1; // keep CPU low; increase to 2 for faster
  // load model relative to this page
  const modelUrl = "./models/yolov5n.onnx";
  session = await ort.InferenceSession.create(modelUrl, {
    executionProviders: ["wasm"]
  });
 
}

function letterboxToSquare(imgW, imgH, dst=INPUT_SIZE) {
  // keep ratio, pad to square
  const r = Math.min(dst / imgW, dst / imgH);
  const newW = Math.round(imgW * r);
  const newH = Math.round(imgH * r);
  const padW = (dst - newW);
  const padH = (dst - newH);
  // left/top padding (even split)
  const dw = Math.floor(padW / 2);
  const dh = Math.floor(padH / 2);
  return { newW, newH, dw, dh, r };
}

function toCHWFloat32(imageData) {
  // imageData: Uint8ClampedArray RGBA
  const { data, width, height } = imageData;
  const out = new Float32Array(3 * width * height);
  let i = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++, i++) {
      const idx = i * 4;
      const r = data[idx], g = data[idx + 1], b = data[idx + 2];
      // normalize 0..1
      out[y * width + x] = r / 255;                    // C0
      out[width * height + y * width + x] = g / 255;   // C1
      out[2 * width * height + y * width + x] = b / 255; // C2
    }
  }
  return out;
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function nms(boxes, scores, iouThr = 0.5, sigma = 0.5, scoreThr = 0.25, maxDet = 100) {
  const N = boxes.length;
  let indices = Array.from({ length: N }, (_, i) => i);
  const keep = [];

  while (indices.length > 0 && keep.length < maxDet) {
    // get highest score index
    let maxIdx = indices.reduce((best, i) => scores[i] > scores[best] ? i : best, indices[0]);
    keep.push(maxIdx);

    const newIndices = [];
    for (const j of indices) {
      if (j === maxIdx) continue;
      const overlap = iou(boxes[maxIdx], boxes[j]);

      // decay score instead of removing
      scores[j] = scores[j] * Math.exp(-(overlap * overlap) / sigma);

      if (scores[j] > scoreThr) {
        newIndices.push(j);
      }
    }
    indices = newIndices;
  }

  return keep;
}

// IoU (boxes in [x1, y1, x2, y2])
function iou(boxA, boxB) {
  const [x1A, y1A, x2A, y2A] = boxA;
  const [x1B, y1B, x2B, y2B] = boxB;

  const interX1 = Math.max(x1A, x1B);
  const interY1 = Math.max(y1A, y1B);
  const interX2 = Math.min(x2A, x2B);
  const interY2 = Math.min(y2A, y2B);

  const interW = Math.max(0, interX2 - interX1);
  const interH = Math.max(0, interY2 - interY1);
  const interArea = interW * interH;

  const areaA = (x2A - x1A) * (y2A - y1A);
  const areaB = (x2B - x1B) * (y2B - y1B);

  const union = areaA + areaB - interArea;
  return union === 0 ? 0 : interArea / union;
}



// function nonMaxSuppression(boxes, scores, iouThreshold = 0.5) {
//     const indices = scores
//         .map((score, i) => [score, i])
//         .sort((a, b) => b[0] - a[0]) // sort by score desc
//         .map(pair => pair[1]);

//     const selected = [];
//     while (indices.length > 0) {
//         const current = indices.shift();
//         selected.push(current);

//         indices = indices.filter(i => {
//             return iou(boxes[current], boxes[i]) < iouThreshold;
//         });
//     }
//     return selected;
// }


// Decode YOLOv5 output (N x 85): [cx,cy,w,h, obj, 80 class probs]
// Decode YOLOv5 output (N x 85): [cx,cy,w,h, obj, 80 class probs]
function decodeYolo(output, scaleMeta) {
  const [N, C] = [
    output.dims[1] ?? output.dims[0],
    output.dims[2] ?? output.dims[1]
  ];
  const data = output.data;

  const boxes = [], scores = [], classes = [];

  for (let i = 0; i < N; i++) {
    const off = i * C;
    const cx = data[off + 0];
    const cy = data[off + 1];
    const w  = data[off + 2];
    const h  = data[off + 3];
    const obj = sigmoid(data[off + 4]);
    if (obj < SCORE_THR) continue;

    let best = 0, bestScore = 0;
    for (let c = 5; c < C; c++) {
      const s = sigmoid(data[off + c]);
      if (s > bestScore) {
        bestScore = s;
        best = c - 5;
      }
    }
    const conf = obj * bestScore;
    if (conf < SCORE_THR) continue;

    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;

    boxes.push([x1, y1, x2, y2]);
    scores.push(conf);
    classes.push(best);
  }

  // 🔑 Run single NMS across all classes
const keep = nms(boxes, scores, NMS_IOU_THR, 0.5, SCORE_THR, MAX_DETS);


  const dets = [];
  for (const idx of keep) {
    let [x1, y1, x2, y2] = boxes[idx];
    const { newW, newH, dw, dh } = scaleMeta;

    // remove padding
    x1 = Math.max(0, x1 - dw);
    y1 = Math.max(0, y1 - dh);
    x2 = Math.max(0, x2 - dw);
    y2 = Math.max(0, y2 - dh);

    // clamp
    x1 = Math.min(Math.max(x1, 0), newW);
    y1 = Math.min(Math.max(y1, 0), newH);
    x2 = Math.min(Math.max(x2, 0), newW);
    y2 = Math.min(Math.max(y2, 0), newH);

    // normalize
    const nx1 = x1 / newW;
    const ny1 = y1 / newH;
    const nx2 = x2 / newW;
    const ny2 = y2 / newH;

    if (scores[idx] < SCORE_THR) continue;

    dets.push({
      label: COCO80[classes[idx]] ?? `cls${classes[idx]}`,
      score: scores[idx],
      xmin: nx1,
      ymin: ny1,
      xmax: nx2,
      ymax: ny2
    });
  }

  return dets;
}


export async function startWasmInference(videoEl, onDetections) {
  await ensureOrt();
  running = true;

  // Prepare working canvas (letterbox to 320x320)
  const work = document.createElement("canvas");
  work.width = INPUT_SIZE; work.height = INPUT_SIZE;
  const wctx = work.getContext("2d");

  const runLoop = async () => {
    if (!running) return;
    if (videoEl.readyState >= 2) {
      const vw = videoEl.videoWidth || 640;
      const vh = videoEl.videoHeight || 480;

      // letterbox
      const { newW, newH, dw, dh, r } = letterboxToSquare(vw, vh, INPUT_SIZE);
      wctx.clearRect(0,0,INPUT_SIZE,INPUT_SIZE);
      wctx.fillStyle = "black";
      wctx.fillRect(0,0,INPUT_SIZE,INPUT_SIZE);
      wctx.drawImage(videoEl, 0, 0, vw, vh, dw, dh, newW, newH);

      const img = wctx.getImageData(0,0,INPUT_SIZE,INPUT_SIZE);
      const chw = toCHWFloat32(img);
      const input = new ort.Tensor("float32", chw, [1,3,INPUT_SIZE,INPUT_SIZE]);

      const feeds = {};
      const inputName = session.inputNames[0];
      feeds[inputName] = input;

      const t0 = performance.now();
      const results = await session.run(feeds);
      const outName = session.outputNames[0];
      const out = results[outName]; // shape (1,25200,85) or (25200,85)

      // decode + NMS
      const dets = decodeYolo(out, { newW, newH, dw, dh });

      const meta = { frame_id: `${Date.now()}`, capture_ts: Date.now() };
onDetections(meta, dets);
// enqueue for backend if enabled; backend expects a single-frame JSON with frame metadata & detections
if (BACKEND_URL) {
  const payload = {
    frame_id: meta.frame_id,
    capture_ts: meta.capture_ts,
    recv_ts: Date.now(),         // when browser enqueues it
    inference_ts: Date.now(),    // you can use a more accurate timestamp if you measured inference time
    detections: dets
  };
  enqueuePayload(payload);
  

}
      // console.debug("Infer time", (performance.now()-t0).toFixed(1), "ms");
    }
    // ~12 FPS target
    loopTimer = setTimeout(runLoop, 80);
  };
  runLoop();
  return true;
}

export function stopWasmInference() {
  running = false;
  if (loopTimer) clearTimeout(loopTimer);
}



// call once when starting the app / page
enableBackendForwarding("http://localhost:5001/update");

