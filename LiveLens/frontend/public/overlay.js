export function clearOverlay(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
}

export function drawDetections(canvas, detections, meta) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0,0,canvas.width,canvas.height);
  ctx.lineWidth = 2;
  ctx.font = "14px Arial";
  (detections || []).forEach(d => {
    const x = d.xmin * canvas.width;
    const y = d.ymin * canvas.height;
    const w = (d.xmax - d.xmin) * canvas.width;
    const h = (d.ymax - d.ymin) * canvas.height;
    ctx.strokeStyle = "lime";
    ctx.strokeRect(x,y,w,h);
    const txt = `${d.label} ${(d.score*100).toFixed(0)}%`;
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    const tw = ctx.measureText(txt).width;
    ctx.fillRect(x, y - 18, tw + 8, 18);
    ctx.fillStyle = "white";
    ctx.fillText(txt, x+4, y - 4);
  });

  if (meta && meta.capture_ts) {
    const e2e = Date.now() - meta.capture_ts;
    ctx.fillStyle = "white";
    ctx.fillText(`E2E ${e2e} ms`, 8, canvas.height - 8);
  }
}
