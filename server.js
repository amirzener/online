const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*" }
});

let broadcasterId = null;
const viewers = new Map();
const controllers = new Map();

io.on('connection', socket => {
  console.log('User connected:', socket.id);

  socket.on('registerBroadcaster', () => {
    broadcasterId = socket.id;
    console.log('Broadcaster registered:', broadcasterId);
    // به همه کنترلرها اطلاع بده
    controllers.forEach(ctrl => ctrl.emit('broadcasterAvailable'));
  });

  socket.on('registerViewer', () => {
    viewers.set(socket.id, socket);
    console.log('Viewer registered:', socket.id);
    // به Broadcaster اطلاع بده viewer جدید هست
    if (broadcasterId) {
      io.to(broadcasterId).emit('newViewer', socket.id);
    }
  });

  socket.on('registerController', () => {
    controllers.set(socket.id, socket);
    console.log('Controller registered:', socket.id);
    // اگه Broadcaster هست، به کنترلر اطلاع بده
    if (broadcasterId) {
      socket.emit('broadcasterAvailable');
    }
  });

  socket.on('startStream', () => {
    console.log('Controller requested startStream');
    if (broadcasterId) {
      io.to(broadcasterId).emit('createOffer');
      // به همه viewer ها اطلاع بده پخش شروع شد
      viewers.forEach(v => v.emit('streamStarted'));
    }
  });

  socket.on('stopStream', () => {
    console.log('Controller requested stopStream');
    // به همه viewer ها اطلاع بده پخش متوقف شد
    viewers.forEach(v => v.emit('streamStopped'));
  });

  // سیگنالینگ WebRTC
  socket.on('offer', (offer, viewerId) => {
    io.to(viewerId).emit('offer', offer, socket.id);
  });

  socket.on('answer', (answer, broadcasterId) => {
    io.to(broadcasterId).emit('answer', answer, socket.id);
  });

  socket.on('candidate', (candidate, targetId) => {
    io.to(targetId).emit('candidate', candidate, socket.id);
  });

  // کنترل تبلیغات
  socket.on('playAd', (adNumber) => {
    console.log('Play ad:', adNumber);
    viewers.forEach(v => v.emit('adPlaying', adNumber));
  });

  socket.on('stopAd', () => {
    console.log('Stop ad');
    viewers.forEach(v => v.emit('adStopped'));
  });

  // کنترل زیرنویس
  socket.on('setSubtitle', (text) => {
    console.log('Set subtitle:', text);
    viewers.forEach(v => v.emit('subtitleUpdated', text));
  });

  socket.on('removeSubtitle', () => {
    console.log('Remove subtitle');
    viewers.forEach(v => v.emit('subtitleRemoved'));
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    if (socket.id === broadcasterId) {
      broadcasterId = null;
      console.log('Broadcaster disconnected');
      viewers.forEach(v => v.emit('broadcasterDisconnected'));
      controllers.forEach(c => c.emit('broadcasterDisconnected'));
    }
    viewers.delete(socket.id);
    controllers.delete(socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
