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
let isStreaming = false;

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Broadcaster connection
  socket.on('registerBroadcaster', () => {
    broadcaster = socket.id;
    console.log('Broadcaster registered:', broadcaster);
    io.emit('broadcasterAvailable');
  });

  // Viewer connection
  socket.on('registerViewer', () => {
    viewers.push(socket.id);
    console.log('Viewer registered:', socket.id);
    if (broadcaster && isStreaming) {
      socket.emit('streamStarted');
    }
  });

  // Controller connection
  socket.on('registerController', () => {
    console.log('Controller registered:', socket.id);
    if (broadcaster) {
      socket.emit('broadcasterReady');
    }
  });

  // Start stream from controller
  socket.on('startStream', () => {
    if (!broadcaster) {
      console.log('No broadcaster available');
      return;
    }
    isStreaming = true;
    io.to(broadcaster).emit('createOffer');
    io.emit('streamStarted');
    console.log('Stream started');
  });

  // Stop stream from controller
  socket.on('stopStream', () => {
    isStreaming = false;
    io.emit('streamStopped');
    console.log('Stream stopped');
  });

  // WebRTC Signaling
  socket.on('offer', (offer, targetId) => {
    socket.to(targetId).emit('offer', offer, socket.id);
  });

  socket.on('answer', (answer, targetId) => {
    socket.to(targetId).emit('answer', answer, socket.id);
  });

  socket.on('candidate', (candidate, targetId) => {
    socket.to(targetId).emit('candidate', candidate, socket.id);
  });

  // Ads control
  socket.on('playAd', (adNumber) => {
    io.emit('adPlaying', adNumber);
  });

  socket.on('stopAd', () => {
    io.emit('adStopped');
  });

  // Disconnection
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.id === broadcaster) {
      broadcaster = null;
      isStreaming = false;
      io.emit('broadcasterDisconnected');
    }
    viewers = viewers.filter(viewer => viewer !== socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
