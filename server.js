const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: ["https://amiralfa.ir"],
    methods: ["GET", "POST"],
    credentials: true
  },
  allowEIO3: true
});

// اتاق عمومی برای ارتباط مستقیم
const PUBLIC_ROOM = 'public-stream-room';

io.on('connection', (socket) => {
  console.log('اتصال جدید:', socket.id);

  // مدیریت اشتراک‌گذاران
  socket.on('register-broadcaster', () => {
    socket.join(PUBLIC_ROOM);
    socket.broadcast.emit('new-broadcaster');
    console.log(`Broadcaster registered: ${socket.id}`);
  });

  // مدیریت بینندگان
  socket.on('register-viewer', () => {
    socket.join(PUBLIC_ROOM);
    const broadcaster = [...io.sockets.adapter.rooms.get(PUBLIC_ROOM)].find(id => id !== socket.id);
    if (broadcaster) {
      socket.emit('broadcaster-available');
    }
  });

  // انتقال سیگنالهای WebRTC
  socket.on('signal', (data) => {
    socket.to(data.target).emit('signal', {
      sender: socket.id,
      signal: data.signal
    });
  });

  socket.on('disconnect', () => {
    console.log('قطع ارتباط:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`سرور سیگنالینگ فعال روی پورت ${PORT}`);
});
