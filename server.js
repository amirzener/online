// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

// نگهداری اتاق‌ها:
// rooms[roomId] = { publisher: ws|null, viewers: Map<viewerId, ws> }
const rooms = Object.create(null);

function safeSend(ws, msgObj) {
  try {
    ws.send(JSON.stringify(msgObj));
  } catch (e) {
    // ignore
  }
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('pong', () => ws.isAlive = true);

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn('invalid json', raw.toString());
      return;
    }

    const { type } = msg;

    // join: { type: 'join', role: 'publisher'|'viewer', room: 'room-id' }
    if (type === 'join') {
      const { role, room } = msg;
      if (!room) {
        safeSend(ws, { type: 'error', reason: 'missing room' });
        return;
      }

      ws.roomId = room;
      ws.role = role;

      if (!rooms[room]) {
        rooms[room] = { publisher: null, viewers: new Map() };
      }

      if (role === 'publisher') {
        // اگر قبلا پابلیشر هست، جایگزینش کن یا reject کن
        if (rooms[room].publisher && rooms[room].publisher !== ws) {
          // اطلاع به پابلیشر قبلی که جایگزین شد
          safeSend(rooms[room].publisher, { type: 'info', reason: 'new-publisher-replaced' });
          // قطع ارتباط قبلی (اختیاری)
        }
        rooms[room].publisher = ws;
        safeSend(ws, { type: 'joined', role: 'publisher', room });
        console.log(`publisher joined room=${room}`);
      } else if (role === 'viewer') {
        const viewerId = uuidv4();
        ws.viewerId = viewerId;
        rooms[room].viewers.set(viewerId, ws);
        safeSend(ws, { type: 'joined', role: 'viewer', room, viewerId });
        console.log(`viewer ${viewerId} joined room=${room}`);

        // اگر پابلیشر وجود دارد، اطلاع بده که یک viewer جدید آمده
        const pub = rooms[room].publisher;
        if (pub) {
          safeSend(pub, { type: 'viewer-joined', viewerId });
        }
      } else {
        safeSend(ws, { type: 'error', reason: 'invalid role' });
      }

      return;
    }

    // سایر پیام‌ها باید شامل room باشند یا ws.roomId استفاده شود
    const roomId = msg.room || ws.roomId;
    if (!roomId || !rooms[roomId]) {
      safeSend(ws, { type: 'error', reason: 'unknown room' });
      return;
    }

    const roomObj = rooms[roomId];

    // offer: { type:'offer', viewerId, offer, room }
    // answer: { type:'answer', viewerId, answer, room }
    // candidate: { type:'candidate', viewerId, candidate, room }
    // leave: { type:'leave', viewerId?, room }
    if (type === 'offer') {
      // offer from publisher -> forward to specific viewer
      const { viewerId, offer } = msg;
      const viewerWs = roomObj.viewers.get(viewerId);
      if (viewerWs) {
        safeSend(viewerWs, { type: 'offer', offer, viewerId });
      } else {
        safeSend(ws, { type: 'error', reason: 'viewer-not-found', viewerId });
      }
      return;
    }

    if (type === 'answer') {
      // answer from viewer -> forward to publisher
      const { viewerId, answer } = msg;
      const pub = roomObj.publisher;
      if (pub) {
        safeSend(pub, { type: 'answer', viewerId, answer });
      } else {
        safeSend(ws, { type: 'error', reason: 'publisher-not-found' });
      }
      return;
    }

    if (type === 'candidate') {
      // candidate can be from publisher or viewer
      const { viewerId, candidate } = msg;

      if (ws.role === 'publisher') {
        // forward candidate to viewer
        const viewer = roomObj.viewers.get(viewerId);
        if (viewer) safeSend(viewer, { type: 'candidate', candidate, viewerId });
      } else if (ws.role === 'viewer') {
        // forward candidate to publisher
        const pub = roomObj.publisher;
        if (pub) safeSend(pub, { type: 'candidate', candidate, viewerId: ws.viewerId });
      }
      return;
    }

    if (type === 'leave') {
      const { viewerId } = msg;
      if (ws.role === 'viewer') {
        // viewer leaving
        const id = ws.viewerId;
        rooms[roomId].viewers.delete(id);
        const pub = rooms[roomId].publisher;
        if (pub) safeSend(pub, { type: 'viewer-left', viewerId: id });
      } else if (ws.role === 'publisher') {
        // publisher left -> notify viewers
        for (const [vid, vws] of rooms[roomId].viewers.entries()) {
          safeSend(vws, { type: 'publisher-left' });
        }
        rooms[roomId].publisher = null;
      }
      return;
    }

    // unknown type
    safeSend(ws, { type: 'error', reason: 'unknown-type' });
  });

  ws.on('close', () => {
    const roomId = ws.roomId;
    if (!roomId || !rooms[roomId]) return;

    if (ws.role === 'viewer') {
      const id = ws.viewerId;
      rooms[roomId].viewers.delete(id);
      const pub = rooms[roomId].publisher;
      if (pub) safeSend(pub, { type: 'viewer-left', viewerId: id });
      console.log(`viewer ${id} disconnected from room=${roomId}`);
    } else if (ws.role === 'publisher') {
      // publisher disconnected -> notify viewers
      for (const [vid, vws] of rooms[roomId].viewers.entries()) {
        safeSend(vws, { type: 'publisher-left' });
      }
      rooms[roomId].publisher = null;
      console.log(`publisher disconnected from room=${roomId}`);
    }

    // cleanup empty rooms
    if (rooms[roomId].publisher === null && rooms[roomId].viewers.size === 0) {
      delete rooms[roomId];
      console.log(`room ${roomId} deleted`);
    }
  });
});

// simple health endpoint
app.get('/', (req, res) => {
  res.send('WebRTC signaling server is running');
});

// ping-pong for connection liveness
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
