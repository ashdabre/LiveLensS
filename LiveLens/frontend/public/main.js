// main.js — fully updated with phone auto-start + dual-mode inference (WASM + server)

import { Signaler } from './signaling.js';
import { startWasmInference, stopWasmInference } from './inference_wasm.js';
import { drawDetections, clearOverlay } from './overlay.js';
import { Bench } from './bench.js';

const pcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

const apiHost = window.location.hostname;
 // frontend
const signalingUrl = `ws://${apiHost}:4000`; // signaling server

// ✅ Single clean initialization
const signaler = new Signaler(signalingUrl);

let pc = null;
let localStream = null;
let serverWs = null;
let inferenceRunning = false;
let processing = false;

// DOM
const remoteVideo = document.getElementById('remoteVideo');
const overlayCanvas = document.getElementById('overlayCanvas');
const roleSelect = document.getElementById('roleSelect');
const modeSelect = document.getElementById('modeSelect');
const startViewerBtn = document.getElementById('startViewer');
const startPhoneBtn = document.getElementById('startPhone');
const startInferenceBtn = document.getElementById('startInference');
const stopInterfaceBtn = document.getElementById('stopInterface');

// Text/status areas
const phoneStatusEl = document.getElementById('phoneStatus');
const viewerStatusEl = document.getElementById('viewerStatus');
const phoneLinkEl = document.getElementById('phoneLink');
const qrWrapEl = document.getElementById('qrWrap');

// Optional status helpers from index.html (no-ops if missing)
const safe = (fnName, ...args) => (typeof window[fnName] === 'function' ? window[fnName](...args) : void 0);
const notify = (title, msg, type='info') => safe('showNotification', title, msg, type);
const setCamStatus = (s, t) => safe('updateCameraStatus', s, t);
const setStreamStatus = (s, t) => safe('updateStreamStatus', s, t);
const setAIStatus = (s, t) => safe('updateAIStatus', s, t);

// Metrics helpers (updates your analytics panel if present)
const setMetric = (id, value) => {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
};

function resizeCanvasToVideo() {
  overlayCanvas.width = remoteVideo.videoWidth || 640;
  overlayCanvas.height = remoteVideo.videoHeight || 480;
  overlayCanvas.style.width = `${remoteVideo.clientWidth}px`;
  overlayCanvas.style.height = `${remoteVideo.clientHeight}px`;
}

window.addEventListener('resize', resizeCanvasToVideo);

// ---------- WebRTC: Viewer ----------
async function startViewer() {
  const room = (document.getElementById('roomInput')?.value || 'default').trim();
  const role = roleSelect?.value || 'viewer';

  viewerStatusEl.textContent = `Joining ${room} as ${role}`;
  await signaler.join(room, role);

  if (role === 'viewer') {
    // ✅ Build phone URL using LAN IP instead of "localhost"
    const apiHost = window.location.hostname; 
    const url = `http://${apiHost}:3000${location.pathname}?role=phone&room=${encodeURIComponent(room)}`;

    // --- Show the phone URL with copy button ---
    if (qrWrapEl) {
      qrWrapEl.innerHTML = `
        <div style="margin:8px 0;">
          <a href="${url}" target="_blank" id="phoneAutoLink">Open phone URL: ${url}</a>
          <button id="copyPhoneUrl" style="margin-left:8px;">Copy</button>
        </div>`;
      const copyBtn = document.getElementById('copyPhoneUrl');
      if (copyBtn) {
        copyBtn.onclick = async () => {
          try {
            await navigator.clipboard.writeText(url);
            notify('Copied', 'Phone URL copied to clipboard', 'success');
          } catch {
            notify('Copy failed', 'Could not copy URL', 'warning');
          }
        };
      }
    }
    if (phoneLinkEl) {
      phoneLinkEl.innerHTML =
        `Or open on your phone: <a href="${url}" target="_blank">${url}</a>`;
    }

    // --- Setup PeerConnection ---
    pc = new RTCPeerConnection(pcConfig);

    pc.ontrack = (ev) => {
      remoteVideo.srcObject = ev.streams[0];
      remoteVideo.onloadedmetadata = () => {
        remoteVideo.play().catch(() => {});
        document.querySelector('.waiting-message')?.remove();
        resizeCanvasToVideo();
        setStreamStatus('active', 'Connected');
        notify('Viewer Connected', 'Receiving remote video stream', 'success');
      };
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) signaler.send({ type: 'ice', candidate: e.candidate });
    };

    // --- Handle offer from phone ---
 // --- Handle offer ---
signaler.on('offer', async (obj) => {
  if (!obj?.sdp) return;

  if (pc.signalingState !== "stable") {
    console.warn("Ignoring offer: wrong state", pc.signalingState);
    return;
  }

  // ✅ Pass SDP directly (it already has {type, sdp})
  await pc.setRemoteDescription(obj.sdp);

  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  // Send back localDescription (already {type, sdp})
  signaler.send({ type: 'answer', sdp: pc.localDescription });
});

// --- Handle answer ---
signaler.on("answer", async (msg) => {
  if (msg?.sdp) {
    // ✅ msg.sdp is already {type: "answer", sdp: "..."}
    await pc.setRemoteDescription(msg.sdp);
  }
});



    // --- Handle ICE candidates ---
    signaler.on('ice', async (obj) => {
      try {
        if (obj?.candidate) await pc.addIceCandidate(obj.candidate);
      } catch (e) {
        console.warn(e);
      }
    });

    viewerStatusEl.textContent = `Viewer ready. Share the phone URL above.`;

  } else {
    // If this page is set to "phone" mode in the selector, we still check URL params for auto-start.
    maybeAutoStartPhone();
  }
}


// ---------- WebRTC: Phone ----------
async function startPhone() {
  const room = (document.getElementById('roomInput')?.value || 'default').trim();
  await signaler.join(room, 'phone');

  try {
    // Rear camera preferred
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false
    });
    phoneStatusEl.textContent = 'Camera permission granted.';
    setCamStatus('active', 'Active');
    notify('Camera Started', 'Phone camera is now streaming', 'success');
  } catch (e) {
    phoneStatusEl.textContent = 'Camera permission denied or no camera.';
    setCamStatus('inactive', 'Error');
    notify('Camera Error', e?.message || 'Permission denied', 'warning');
    return;
  }

  pc = new RTCPeerConnection(pcConfig);
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

  pc.onicecandidate = (e) => {
    if (e.candidate) signaler.send({ type: 'ice', candidate: e.candidate });
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  signaler.send({ type: 'offer', sdp: pc.localDescription });

  signaler.on('answer', async (obj) => {
    if (obj?.sdp) await pc.setRemoteDescription(new RTCSessionDescription(obj.sdp));
  });

  signaler.on('ice', async (obj) => {
    try { if (obj?.candidate) await pc.addIceCandidate(obj.candidate); } catch (e) { console.warn(e); }
  });

  phoneStatusEl.textContent = 'Camera started and offer sent.';
}

// ---------- Inference ----------
let fpsSamples = [];
let lastFrameTs = 0;

function resetMetrics() {
  fpsSamples = [];
  lastFrameTs = 0;
  setMetric('framesValue', '0');
  setMetric('latencyValue', '—');
  setMetric('objectsValue', '0');
  setMetric('accuracyValue', '—');
}

function updateFps(now) {
  if (lastFrameTs) {
    const dt = now - lastFrameTs;
    const fps = 1000 / dt;
    fpsSamples.push(fps);
    if (fpsSamples.length > 20) fpsSamples.shift();
    const avg = fpsSamples.reduce((a,b)=>a+b,0) / fpsSamples.length;
    setMetric('framesValue', Math.round(avg));
  }
  lastFrameTs = now;
}

async function startInference() {
  if (!remoteVideo.srcObject) {
    alert('Start viewer (receive the phone stream) before starting inference.');
    return;
  }

  // Toggle behavior
  if (inferenceRunning) {
    inferenceRunning = false;
    viewerStatusEl.textContent = 'Stopping inference';
    setAIStatus('inactive', 'Inactive');
    clearOverlay(overlayCanvas);
    stopWasmInference();
    if (serverWs) { serverWs.close(); serverWs = null; }
    notify('AI Stopped', 'Inference stopped', 'info');
    return;
  }

  resetMetrics();
  inferenceRunning = true;
  resizeCanvasToVideo();
  clearOverlay(overlayCanvas);
  const mode = modeSelect?.value || 'wasm';
  viewerStatusEl.textContent = `Starting inference (${mode})`;
  setAIStatus('active', 'Processing');

  if (mode === 'wasm') {
    await startWasmInference(remoteVideo, (meta, detections) => {
      // meta: { frame_id, capture_ts }, detections: [{label, score, xmin, ymin, xmax, ymax}, ...]
      drawDetections(overlayCanvas, detections, meta);
      setMetric('objectsValue', String(detections?.length || 0));
      // crude latency: time from capture to now
      if (meta?.capture_ts) setMetric('latencyValue', `${Math.max(0, Date.now() - meta.capture_ts)}ms`);
      updateFps(performance.now());
    });
    notify('AI Processing', 'WASM inference running in browser', 'success');
    return;
  }

  // Server mode over WS (expects { op: 'infer', img: <dataURL> } / replies with { detections, ... })
  serverWs = new WebSocket(`ws://${location.hostname}:5001/ws`);
  serverWs.onopen = () => { viewerStatusEl.textContent = 'Server WS open'; };
  serverWs.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    drawDetections(overlayCanvas, msg.detections || [], msg);
    setMetric('objectsValue', String((msg.detections || []).length));
    if (msg?.capture_ts) setMetric('latencyValue', `${Math.max(0, Date.now() - msg.capture_ts)}ms`);
    updateFps(performance.now());
    processing = false;
  };
  serverWs.onerror = (e) => console.warn('server ws err', e);

  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = 320;
  captureCanvas.height = 240;
  const ctx = captureCanvas.getContext('2d');

  const captureLoop = async () => {
    if (!inferenceRunning) return;
    if (remoteVideo.readyState < 2) { setTimeout(captureLoop, 100); return; }

    ctx.drawImage(remoteVideo, 0, 0, captureCanvas.width, captureCanvas.height);
    if (serverWs && serverWs.readyState === 1 && serverWs.bufferedAmount < 1_000_000 && !processing) {
      const b64 = captureCanvas.toDataURL('image/jpeg', 0.6);
      const payload = {
        op: 'infer',
        frame_id: `${Date.now()}-${(Math.random()*1000)|0}`,
        capture_ts: Date.now(),
        img: b64
      };
      try { serverWs.send(JSON.stringify(payload)); processing = true; }
      catch (e) { console.warn('send failed', e); processing = false; }
    }

    setTimeout(captureLoop, 85);
  };

  captureLoop();
  notify('AI Processing', 'Server inference streaming frames', 'success');
}

// ---------- Stop / Cleanup ----------
function stopInterface() {
  try {
    inferenceRunning = false;
    stopWasmInference();
  } catch {}
  if (serverWs) { try { serverWs.close(); } catch {} serverWs = null; }

  try {
    if (pc) { pc.ontrack = null; pc.onicecandidate = null; pc.close(); }
  } catch {}
  pc = null;

  // Stop local and remote tracks
  try {
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); }
    localStream = null;
  } catch {}
  try {
    if (remoteVideo.srcObject) {
      remoteVideo.srcObject.getTracks().forEach(t => t.stop());
      remoteVideo.srcObject = null;
    }
  } catch {}

  clearOverlay(overlayCanvas);
  resetMetrics();
  phoneStatusEl.textContent = '';
  viewerStatusEl.textContent = '';

  setStreamStatus('disconnected', 'Disconnected');
  setAIStatus('inactive', 'Inactive');
  setCamStatus('standby', 'Standby');

  notify('Interface Stopped', 'All systems stopped and reset', 'info');
}

window.addEventListener('beforeunload', stopInterface);

// ---------- Auto-start on phone URL ----------
function maybeAutoStartPhone() {
  const params = new URLSearchParams(window.location.search);
  const urlRole = params.get('role');
  const urlRoom = params.get('room');
  if (urlRoom && document.getElementById('roomInput')) {
    document.getElementById('roomInput').value = urlRoom;
  }
  if (urlRole === 'phone') {
    if (roleSelect) roleSelect.value = 'phone';
    // Immediately ask for camera permission & start stream
    startPhone();
  }
}

// ---------- Wire buttons (override any prior handlers) ----------
startViewerBtn.onclick = startViewer;
startPhoneBtn.onclick = startPhone;
startInferenceBtn.onclick = startInference;
stopInterfaceBtn.onclick = stopInterface;

// ---------- Bench (optional, as in your original) ----------
const bench = new Bench({ video: remoteVideo, overlay: overlayCanvas, wsUrl: `ws://${location.hostname}:5001/ws` });
window.runBench = (opts) => bench.run(opts);

// Kick off phone auto-start if the URL says so
maybeAutoStartPhone();
