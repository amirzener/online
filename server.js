// server.js

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;
const rooms = Object.create(null);

function safeSend(ws, msgObj) {
  try {
    ws.send(JSON.stringify(msgObj));
  } catch {}
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    const { type, room: roomId = ws.roomId } = msg;

    // اگر join هست و اتاق وجود ندارد آن را بساز
    if (type === 'join') {
      const { role, room } = msg;
      if (!room) return safeSend(ws, { type: 'error', reason: 'missing room' });

      if (!rooms[room]) rooms[room] = { publisher: null, viewers: new Map() };
      ws.roomId = room;
      ws.role = role;

      const roomObj = rooms[room];

      if (role === 'publisher') {
        if (roomObj.publisher && roomObj.publisher !== ws) {
          safeSend(roomObj.publisher, { type: 'info', reason: 'new-publisher-replaced' });
          // قبلی را قطع کن
          try { roomObj.publisher.close(); } catch {}
        }
        roomObj.publisher = ws;
        safeSend(ws, { type: 'joined', role: 'publisher', room });
      } else if (role === 'viewer') {
        const viewerId = uuidv4();
        ws.viewerId = viewerId;
        roomObj.viewers.set(viewerId, ws);
        safeSend(ws, { type: 'joined', role: 'viewer', room, viewerId });
        if (roomObj.publisher) {
          safeSend(roomObj.publisher, { type: 'viewer-joined', viewerId });
        }
      }
      return;
    }

    if (!roomId || !rooms[roomId]) {
      if (type !== 'join') safeSend(ws, { type: 'error', reason: 'unknown room' });
      return;
    }
    const room = rooms[roomId];

    if (type === 'offer') {
      const { viewerId, offer } = msg;
      const viewer = room.viewers.get(viewerId);
      if (viewer) safeSend(viewer, { type: 'offer', offer, viewerId });
      return;
    }

    if (type === 'answer') {
      const { viewerId, answer } = msg;
      if (room.publisher) safeSend(room.publisher, { type: 'answer', viewerId, answer });
      return;
    }

    if (type === 'candidate') {
      const { viewerId, candidate } = msg;
      if (ws.role === 'publisher') {
        const viewer = room.viewers.get(viewerId);
        if (viewer) safeSend(viewer, { type: 'candidate', candidate, viewerId });
      } else if (ws.role === 'viewer') {
        if (room.publisher) safeSend(room.publisher, { type: 'candidate', candidate, viewerId: ws.viewerId });
      }
      return;
    }

    if (type === 'leave') {
      if (ws.role === 'viewer') {
        room.viewers.delete(ws.viewerId);
        if (room.publisher) safeSend(room.publisher, { type: 'viewer-left', viewerId: ws.viewerId });
      } else if (ws.role === 'publisher') {
        for (const [, vws] of room.viewers) safeSend(vws, { type: 'publisher-left' });
        room.publisher = null;
      }
      return;
    }

    // پیام‌های کنترل مثل تبلیغ و زیرنویس
    if (type === 'control' || type === 'subtitle') {
      for (const [, viewerWs] of room.viewers) {
        safeSend(viewerWs, msg);
      }
      return;
    }
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (!roomId || !rooms[roomId]) return;

    const room = rooms[roomId];
    if (ws.role === 'viewer') {
      room.viewers.delete(ws.viewerId);
      if (room.publisher) safeSend(room.publisher, { type: 'viewer-left', viewerId: ws.viewerId });
    } else if (ws.role === 'publisher') {
      for (const [, vws] of room.viewers) safeSend(vws, { type: 'publisher-left' });
      room.publisher = null;
    }

    // حذف اتاق اگر خالی شد
    if (!room.publisher && room.viewers.size === 0) {
      delete rooms[roomId];
    }
  });
});

// پاکسازی اتصال‌های قطع شده
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

app.get('/', (req, res) => {
  res.send('WebRTC signaling server is running');
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
