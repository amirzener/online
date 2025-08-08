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

// وضعیت‌های سیستم
let broadcaster = {
  id: null,
  socket: null
};
let viewers = new Map(); // Map of viewerId to socket
let controllers = new Map(); // Map of controllerId to socket
let isStreaming = false;
let currentAd = null;
let currentSubtitle = null;

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  // ثبت Broadcaster
  socket.on('registerBroadcaster', () => {
    broadcaster.id = socket.id;
    broadcaster.socket = socket;
    console.log(`Broadcaster registered: ${socket.id}`);
    
    // اطلاع به کنترلرها
    controllers.forEach(controller => {
      controller.emit('broadcasterAvailable');
    });
  });

  // ثبت Viewer
  socket.on('registerViewer', () => {
    viewers.set(socket.id, socket);
    console.log(`Viewer registered: ${socket.id}`);
    
    // اگر پخش فعال است، به Viewer اطلاع دهید
    if (isStreaming && broadcaster.id) {
      socket.emit('streamStarted');
    }
  });

  // ثبت Controller
  socket.on('registerController', () => {
    controllers.set(socket.id, socket);
    console.log(`Controller registered: ${socket.id}`);
    
    // اگر Broadcaster آماده است، به کنترلر اطلاع دهید
    if (broadcaster.id) {
      socket.emit('broadcasterAvailable');
    }
  });

  // شروع پخش از کنترلر
  socket.on('startStream', () => {
    if (!broadcaster.id) {
      console.log('No broadcaster available');
      return;
    }
    
    isStreaming = true;
    console.log('Stream started');
    
    // درخواست ایجاد Offer از Broadcaster
    broadcaster.socket.emit('createOffer');
    
    // اطلاع به تمام Viewerها
    viewers.forEach(viewer => {
      viewer.emit('streamStarted');
    });
  });

  // توقف پخش از کنترلر
  socket.on('stopStream', () => {
    isStreaming = false;
    console.log('Stream stopped');
    
    // اطلاع به تمام Viewerها
    viewers.forEach(viewer => {
      viewer.emit('streamStopped');
    });
  });

  // WebRTC Signaling
  socket.on('offer', (offer, targetId) => {
    const targetSocket = viewers.get(targetId) || controllers.get(targetId);
    if (targetSocket) {
      targetSocket.emit('offer', offer, socket.id);
    }
  });

  socket.on('answer', (answer, targetId) => {
    const targetSocket = broadcaster.socket || viewers.get(targetId) || controllers.get(targetId);
    if (targetSocket) {
      targetSocket.emit('answer', answer, socket.id);
    }
  });

  socket.on('candidate', (candidate, targetId) => {
    const targetSocket = broadcaster.socket || viewers.get(targetId) || controllers.get(targetId);
    if (targetSocket) {
      targetSocket.emit('candidate', candidate, socket.id);
    }
  });

  // کنترل تبلیغات
  socket.on('playAd', (adNumber) => {
    currentAd = adNumber;
    console.log(`Playing ad ${adNumber}`);
    viewers.forEach(viewer => {
      viewer.emit('adPlaying', adNumber);
    });
  });

  socket.on('stopAd', () => {
    currentAd = null;
    console.log('Ad stopped');
    viewers.forEach(viewer => {
      viewer.emit('adStopped');
    });
  });

  // مدیریت زیرنویس
  socket.on('setSubtitle', (text) => {
    currentSubtitle = text;
    console.log(`Subtitle set: ${text}`);
    viewers.forEach(viewer => {
      viewer.emit('subtitleUpdated', text);
    });
  });

  socket.on('removeSubtitle', () => {
    currentSubtitle = null;
    console.log('Subtitle removed');
    viewers.forEach(viewer => {
      viewer.emit('subtitleRemoved');
    });
  });

  // قطع ارتباط
  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    
    if (socket.id === broadcaster.id) {
      broadcaster.id = null;
      broadcaster.socket = null;
      isStreaming = false;
      console.log('Broadcaster disconnected');
      
      // اطلاع به تمام Viewerها و کنترلرها
      viewers.forEach(viewer => {
        viewer.emit('broadcasterDisconnected');
      });
      controllers.forEach(controller => {
        controller.emit('broadcasterDisconnected');
      });
    }
    
    viewers.delete(socket.id);
    controllers.delete(socket.id);
  });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
