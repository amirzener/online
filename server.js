// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

// ساختار اتاق‌ها:
// rooms[roomId] = { 
//   publisher: ws|null, 
//   controller: ws|null,
//   viewers: Map<viewerId, ws>, 
//   streamActive: false, 
//   currentAd: null 
// }
const rooms = Object.create(null);

function safeSend(ws, msgObj) {
  try {
    ws.send(JSON.stringify(msgObj));
  } catch (e) {
    console.error('Error sending message:', e);
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
      console.warn('Invalid JSON received:', raw.toString());
      return;
    }

    const { type } = msg;

    // پیام join: { type: 'join', role: 'publisher'|'viewer'|'controller', room: 'room-id' }
    if (type === 'join') {
      const { role, room } = msg;
      if (!room) {
        safeSend(ws, { type: 'error', reason: 'missing room' });
        return;
      }

      ws.roomId = room;
      ws.role = role;

      if (!rooms[room]) {
        rooms[room] = { 
          publisher: null, 
          controller: null,
          viewers: new Map(), 
          streamActive: false, 
          currentAd: null 
        };
      }

      if (role === 'publisher') {
        // اگر پابلیشر قبلی وجود دارد، جایگزین کن
        if (rooms[room].publisher && rooms[room].publisher !== ws) {
          safeSend(rooms[room].publisher, { type: 'info', reason: 'new-publisher-replaced' });
          rooms[room].publisher.close();
        }
        rooms[room].publisher = ws;
        safeSend(ws, { type: 'joined', role: 'publisher', room });
        console.log(`Publisher joined room=${room}`);

        // به کنترلر اطلاع بده که پابلیشر آماده است
        if (rooms[room].controller) {
          safeSend(rooms[room].controller, { type: 'publisher-ready' });
        }
      } 
      else if (role === 'viewer') {
        const viewerId = uuidv4();
        ws.viewerId = viewerId;
        rooms[room].viewers.set(viewerId, ws);
        safeSend(ws, { type: 'joined', role: 'viewer', room, viewerId });
        console.log(`Viewer ${viewerId} joined room=${room}`);

        // اگر استریم فعال است، به ویوور جدید اطلاع بده
        if (rooms[room].streamActive) {
          safeSend(ws, { type: 'stream-started' });
        }
        // اگر آگهی در حال پخش است، به ویوور جدید اطلاع بده
        if (rooms[room].currentAd) {
          safeSend(ws, { type: 'play-ad', adId: rooms[room].currentAd });
        }

        // به پابلیشر اطلاع بده که ویوور جدید آمده
        if (rooms[room].publisher) {
          safeSend(rooms[room].publisher, { type: 'viewer-joined', viewerId });
        }
      }
      else if (role === 'controller') {
        // فقط یک کنترلر می‌تواند در هر اتاق باشد
        if (rooms[room].controller && rooms[room].controller !== ws) {
          safeSend(rooms[room].controller, { type: 'info', reason: 'new-controller-replaced' });
          rooms[room].controller.close();
        }
        rooms[room].controller = ws;
        safeSend(ws, { type: 'joined', role: 'controller', room });
        console.log(`Controller joined room=${room}`);

        // اگر پابلیشر وجود دارد، وضعیت آن را به کنترلر اطلاع دهید
        if (rooms[room].publisher) {
          safeSend(ws, { type: 'publisher-ready' });
          if (rooms[room].streamActive) {
            safeSend(ws, { type: 'stream-started' });
          }
        }
      } 
      else {
        safeSend(ws, { type: 'error', reason: 'invalid role' });
      }
      return;
    }

    // سایر پیام‌ها باید شامل room باشند
    const roomId = msg.room || ws.roomId;
    if (!roomId || !rooms[roomId]) {
      safeSend(ws, { type: 'error', reason: 'unknown room' });
      return;
    }

    const roomObj = rooms[roomId];

    // پیام‌های WebRTC
    if (type === 'offer') {
      // offer از پابلیشر -> ارسال به ویوور خاص
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
      // answer از ویوور -> ارسال به پابلیشر
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
      // candidate می‌تواند از پابلیشر یا ویوور باشد
      const { viewerId, candidate } = msg;

      if (ws.role === 'publisher') {
        // ارسال candidate به ویوور
        const viewer = roomObj.viewers.get(viewerId);
        if (viewer) safeSend(viewer, { type: 'candidate', candidate, viewerId });
      } else if (ws.role === 'viewer') {
        // ارسال candidate به پابلیشر
        const pub = roomObj.publisher;
        if (pub) safeSend(pub, { type: 'candidate', candidate, viewerId: ws.viewerId });
      }
      return;
    }

    // پیام‌های کنترل
   if (type === 'control') {
  const { action } = msg;
  const pub = roomObj.publisher;
  
  if (!pub && action !== 'stop-stream') {
    safeSend(ws, { type: 'error', reason: 'no-publisher' });
    return;
  }
  
  if (action === 'start-stream') {
    roomObj.streamActive = true;
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'stream-started' });
    }
    if (roomObj.controller) {
      safeSend(roomObj.controller, { type: 'stream-started' });
    }
  } 
  else if (action === 'stop-stream') {
    roomObj.streamActive = false;
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'stream-stopped' });
    }
    if (roomObj.controller) {
      safeSend(roomObj.controller, { type: 'stream-stopped' });
    }
  }
  else if (action === 'mute-audio') {
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'mute-audio' });
    }
  }
  else if (action === 'play-ad') {
    const { adId, adUrl, muteAudio } = msg;
    roomObj.currentAd = adId;
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { 
        type: 'play-ad', 
        adId, 
        adUrl,
        muteAudio: muteAudio || false
      });
    }
    if (roomObj.controller) {
      safeSend(roomObj.controller, { type: 'ad-started', adId });
    }
  }
  else if (action === 'resume-stream') {
    roomObj.currentAd = null;
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'resume-stream' });
    }
    if (roomObj.controller) {
      safeSend(roomObj.controller, { type: 'ad-stopped' });
    }
  }
  else if (action === 'send-subtitle') {
    const { text } = msg;
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'subtitle', text });
    }
  }
  else if (action === 'clear-subtitle') {
    for (const [vid, vws] of roomObj.viewers.entries()) {
      safeSend(vws, { type: 'clear-subtitle' });
    }
  }
  return;
}
    // پیام leave
    if (type === 'leave') {
      const { viewerId } = msg;
      if (ws.role === 'viewer') {
        // ویوور خارج می‌شود
        const id = ws.viewerId;
        roomObj.viewers.delete(id);
        const pub = roomObj.publisher;
        if (pub) safeSend(pub, { type: 'viewer-left', viewerId: id });
      } else if (ws.role === 'publisher') {
        // پابلیشر خارج می‌شود -> به ویوورها و کنترلر اطلاع بده
        for (const [vid, vws] of roomObj.viewers.entries()) {
          safeSend(vws, { type: 'publisher-left' });
        }
        if (roomObj.controller) {
          safeSend(roomObj.controller, { type: 'publisher-left' });
        }
        roomObj.publisher = null;
        roomObj.streamActive = false;
        roomObj.currentAd = null;
      } else if (ws.role === 'controller') {
        // کنترلر خارج می‌شود
        roomObj.controller = null;
      }
      return;
    }

    // پیام ناشناخته
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
      console.log(`Viewer ${id} disconnected from room=${roomId}`);
    } 
    else if (ws.role === 'publisher') {
      // پابلیشر قطع شد -> به ویوورها و کنترلر اطلاع بده
      for (const [vid, vws] of rooms[roomId].viewers.entries()) {
        safeSend(vws, { type: 'publisher-left' });
      }
      if (rooms[roomId].controller) {
        safeSend(rooms[roomId].controller, { type: 'publisher-left' });
      }
      rooms[roomId].publisher = null;
      rooms[roomId].streamActive = false;
      rooms[roomId].currentAd = null;
      console.log(`Publisher disconnected from room=${roomId}`);
    }
    else if (ws.role === 'controller') {
      rooms[roomId].controller = null;
      console.log(`Controller disconnected from room=${roomId}`);
    }

    // پاک کردن اتاق‌های خالی
    if (rooms[roomId].publisher === null && 
        rooms[roomId].controller === null && 
        rooms[roomId].viewers.size === 0) {
      delete rooms[roomId];
      console.log(`Room ${roomId} deleted`);
    }
  });
});

// بررسی سلامت اتصالات
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping(() => {});
  });
}, 30000);

// روت ساده برای بررسی سلامت سرور
app.get('/', (req, res) => {
  res.send('WebRTC Signaling Server is running');
});

server.listen(PORT, () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
