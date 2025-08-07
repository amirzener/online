const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());

// Store connected devices
const devices = new Map();

io.on('connection', (socket) => {
  console.log('New connection:', socket.id);
  
  // Device registration
  socket.on('register', (deviceId) => {
    devices.set(deviceId, socket.id);
    console.log(`Device registered: ${deviceId}`);
  });
  
  // Screen data streaming
  socket.on('screen-data', (data) => {
    // Broadcast to all viewers of this device
    socket.broadcast.emit(`screen-${data.deviceId}`, data.frame);
  });
  
  // Audio data streaming
  socket.on('audio-data', (data) => {
    // Broadcast to all viewers of this device
    socket.broadcast.emit(`audio-${data.deviceId}`, data.chunk);
  });
  
  // Cleanup on disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    for (let [deviceId, socketId] of devices) {
      if (socketId === socket.id) {
        devices.delete(deviceId);
        console.log(`Device unregistered: ${deviceId}`);
      }
    }
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
