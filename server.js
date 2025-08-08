const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: ["https://amiralfa.ir"],
    methods: ["GET", "POST"]
  }
});

let broadcaster = null;
let viewers = [];
let adPlaying = null;
let subtitle = null;
let isLive = false;

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  socket.on('broadcaster', () => {
    broadcaster = socket.id;
    socket.broadcast.emit('broadcaster');
    console.log('broadcaster connected:', broadcaster);
  });

  socket.on('viewer', () => {
    viewers.push(socket.id);
    if (broadcaster) {
      socket.emit('broadcaster');
    }
    console.log('viewer connected:', socket.id);
  });

  socket.on('controller', () => {
    console.log('controller connected:', socket.id);
    if (broadcaster) {
      socket.emit('streamReady');
    }
  });

  socket.on('offer', (id, message) => {
    socket.to(id).emit('offer', socket.id, message);
  });

  socket.on('answer', (id, message) => {
    socket.to(id).emit('answer', socket.id, message);
  });

  socket.on('candidate', (id, message) => {
    socket.to(id).emit('candidate', socket.id, message);
  });

  socket.on('startStream', () => {
    isLive = true;
    io.emit('streamStarted');
    console.log('Stream started by controller');
  });

  socket.on('stopStream', () => {
    isLive = false;
    io.emit('streamStopped');
    console.log('Stream stopped by controller');
  });

  socket.on('playAd', (adNumber) => {
    adPlaying = adNumber;
    io.emit('adPlaying', adNumber);
    console.log(`Ad ${adNumber} playing`);
  });

  socket.on('stopAd', () => {
    adPlaying = null;
    io.emit('adStopped');
    console.log('Ad stopped');
  });

  socket.on('setSubtitle', (text) => {
    subtitle = text;
    io.emit('subtitleUpdated', text);
    console.log('Subtitle updated:', text);
  });

  socket.on('removeSubtitle', () => {
    subtitle = null;
    io.emit('subtitleRemoved');
    console.log('Subtitle removed');
  });

  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    if (socket.id === broadcaster) {
      broadcaster = null;
      io.emit('broadcasterDisconnected');
      console.log('broadcaster disconnected');
    }
    viewers = viewers.filter(viewer => viewer !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
