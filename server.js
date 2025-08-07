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
  }
});

// اتاق ثابت
const PUBLIC_ROOM = 'public-room';

io.on('connection', (socket) => {
  console.log('کاربر متصل شد:', socket.id);

  // اتصال خودکار به اتاق عمومی
  socket.join(PUBLIC_ROOM);
  console.log(`کاربر ${socket.id} به اتاق عمومی پیوست`);
  
  // ارسال تأییدیه به کلاینت
  socket.emit('stream-ready');

  // مدیریت رویدادهای WebRTC
  socket.on('offer', (offer) => {
    socket.to(PUBLIC_ROOM).emit('offer', offer);
  });

  socket.on('answer', (answer) => {
    socket.to(PUBLIC_ROOM).emit('answer', answer);
  });

  socket.on('ice-candidate', (candidate) => {
    socket.to(PUBLIC_ROOM).emit('ice-candidate', candidate);
  });

  socket.on('disconnect', () => {
    console.log('کاربر قطع ارتباط کرد:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`سرور سیگنالینگ روی پورت ${PORT} اجرا می‌شود`);
});
