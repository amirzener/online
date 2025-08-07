const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://amiralfa.ir", "https://online-3sno.onrender.com"],
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// ذخیره اتصالات
const rooms = {};

io.on('connection', (socket) => {
  console.log('اتصال جدید:', socket.id);

  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    rooms[roomId] = socket.id;
    console.log(`کاربر به اتاق ${roomId} پیوست`);
  });

  socket.on('offer', (data) => {
    socket.to(data.roomId).emit('offer', data.offer);
  });

  socket.on('answer', (data) => {
    socket.to(data.roomId).emit('answer', data.answer);
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.roomId).emit('ice-candidate', data.candidate);
  });

  socket.on('disconnect', () => {
    console.log('کاربر قطع شد:', socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`سرور سیگنالینگ روی پورت ${PORT} اجرا می‌شود`);
});
