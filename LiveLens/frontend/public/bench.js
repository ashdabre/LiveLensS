export class Bench {
  constructor({ video, overlay, wsUrl }) {
    this.video = video;
    this.overlay = overlay;
    this.wsUrl = wsUrl;
    this.records = [];
  }

  async run({ duration = 30 } = {}) {
    this.records = [];
    const start = Date.now();
    const endAt = start + duration*1000;
    console.log("Bench: start. Run inference (server or wasm) and let it run for", duration, "seconds.");
    await new Promise(r => setTimeout(r, duration*1000));
    alert("Bench completed; please use the browser console to extract metrics or use the download link created by the viewer UI.");
    return null;
  }
}
