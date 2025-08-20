// signaling.js
export class Signaler {
  constructor(url = null) {
    // Pick URL: passed one, or ENV, or default to Docker backend service
    this.url =
      url ||
      (typeof process !== "undefined" && process.env.SIGNALING_URL) ||
      `ws://${signalingHost}:4000`;

    this.ws = null;
    this.handlers = {};
    this.connect();
  }

  connect() {
    console.log(`[Signaler] Connecting to ${this.url} ...`);
    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => console.log("[Signaler] Connected ✅");

    this.ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg.type && this.handlers[msg.type]) {
          this.handlers[msg.type].forEach((fn) => fn(msg));
        }
      } catch (e) {
        console.warn("[Signaler] Bad signal message", e);
      }
    };

    this.ws.onclose = () => {
      console.log("[Signaler] Closed ❌, reconnecting in 1s...");
      setTimeout(() => this.connect(), 1000);
    };

    this.ws.onerror = (err) => {
      console.error("[Signaler] WebSocket error:", err.message);
    };
  }

  on(type, cb) {
    if (!this.handlers[type]) this.handlers[type] = [];
    this.handlers[type].push(cb);
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    } else {
      console.warn("[Signaler] Tried to send but socket not open", obj);
    }
  }

  join(room, role = "viewer") {
    return new Promise((resolve) => {
      const tryJoin = () => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.send({ type: "join", room, role });
          console.log(`[Signaler] Joined room: ${room} as ${role}`);
          resolve();
        } else {
          setTimeout(tryJoin, 100);
        }
      };
      tryJoin();
    });
  }
}
