// signaling_server.js
import WebSocket, { WebSocketServer } from 'ws';

const PORT = 4000;
const wss = new WebSocketServer({ port: PORT });

const rooms = {}; // { roomName: Set of clients }

wss.on('connection', (ws) => {
  ws.room = null;
  ws.role = null;

  ws.on('message', (msg) => {
    let data;
    try { data = JSON.parse(msg); } 
    catch(e) { console.warn("Bad JSON", e); return; }

    switch(data.type) {
      case 'join':
        ws.room = data.room || 'default';
        ws.role = data.role || 'viewer';
        if (!rooms[ws.room]) rooms[ws.room] = new Set();
        rooms[ws.room].add(ws);
        console.log(`[Signaler] ${ws.role} joined room ${ws.room}`);
        break;

      case 'offer':
      case 'answer':
      case 'ice':
        // Forward to other peers in the same room
        if (!ws.room || !rooms[ws.room]) return;
        rooms[ws.room].forEach(client => {
          if (client !== ws && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(data));
          }
        });
        break;

      default:
        console.warn("Unknown message type:", data.type);
    }
  });

  ws.on('close', () => {
    if (ws.room && rooms[ws.room]) {
      rooms[ws.room].delete(ws);
      if (rooms[ws.room].size === 0) delete rooms[ws.room];
    }
    console.log(`[Signaler] Connection closed`);
  });
});

console.log(`[Signaler] WebSocket signaling server running on ws://0.0.0.0:${PORT}`);
