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
let broadcaster = null;
let viewers = [];
let adPlaying = null;
let subtitle = null;
let isLive = false;

io.on('connection', (socket) => {
  console.log('یک کاربر متصل شد:', socket.id);

  // مدیریت اتصال Broadcaster (ارسال کننده)
  socket.on('broadcaster', () => {
    broadcaster = socket.id;
    console.log('Broadcaster متصل شد:', broadcaster);
    socket.emit('broadcasterAcknowledged');
    
    // اگر کنترلر منتظر است، به او اطلاع دهیم
    io.emit('streamReady');
  });

  // مدیریت اتصال Viewer (تماشاچی)
  socket.on('viewer', () => {
    viewers.push(socket.id);
    console.log('Viewer متصل شد:', socket.id);
    
    // اگر پخش زنده فعال است، به تماشاچی اطلاع دهیم
    if (isLive && broadcaster) {
      socket.emit('streamStarted');
    }
  });

  // مدیریت اتصال Controller (کنترلر)
  socket.on('controller', () => {
    console.log('Controller متصل شد:', socket.id);
    
    // اگر Broadcaster آماده است، به کنترلر اطلاع دهیم
    if (broadcaster) {
      socket.emit('streamReady');
    }
  });

  // درخواست شروع پخش زنده از کنترلر
  socket.on('startStream', () => {
    if (!broadcaster) {
      console.log('هیچ Broadcasterی برای شروع پخش زنده وجود ندارد');
      return;
    }
    
    isLive = true;
    console.log('پخش زنده شروع شد');
    
    // به Broadcaster درخواست ایجاد offer بدهید
    io.to(broadcaster).emit('requestOffer');
    
    // به تمام تماشاچیان اطلاع دهید
    io.emit('streamStarted');
  });

  // توقف پخش زنده از کنترلر
  socket.on('stopStream', () => {
    isLive = false;
    console.log('پخش زنده متوقف شد');
    io.emit('streamStopped');
  });

  // دریافت offer از Broadcaster
  socket.on('offerFromBroadcaster', (offer) => {
    console.log('Offer دریافت شد از Broadcaster');
    
    // ارسال offer به تمام تماشاچیان
    viewers.forEach(viewerId => {
      io.to(viewerId).emit('offer', broadcaster, offer);
    });
  });

  // دریافت answer از Viewer
  socket.on('answerFromViewer', (viewerId, answer) => {
    console.log('Answer دریافت شد از Viewer:', viewerId);
    io.to(broadcaster).emit('answerFromViewer', answer);
  });

  // مدیریت ICE Candidates از Broadcaster
  socket.on('candidateFromBroadcaster', (candidate) => {
    viewers.forEach(viewerId => {
      io.to(viewerId).emit('candidate', candidate);
    });
  });

  // مدیریت ICE Candidates از Viewer
  socket.on('candidateFromViewer', (candidate) => {
    if (broadcaster) {
      io.to(broadcaster).emit('candidateFromViewer', candidate);
    }
  });

  // کنترل تبلیغات
  socket.on('playAd', (adNumber) => {
    adPlaying = adNumber;
    console.log(`تبلیغ ${adNumber} در حال پخش`);
    io.emit('adPlaying', adNumber);
  });

  socket.on('stopAd', () => {
    adPlaying = null;
    console.log('تبلیغ متوقف شد');
    io.emit('adStopped');
  });

  // مدیریت زیرنویس
  socket.on('setSubtitle', (text) => {
    subtitle = text;
    console.log('زیرنویس تنظیم شد:', text);
    io.emit('subtitleUpdated', text);
  });

  socket.on('removeSubtitle', () => {
    subtitle = null;
    console.log('زیرنویس حذف شد');
    io.emit('subtitleRemoved');
  });

  // مدیریت قطع ارتباط
  socket.on('disconnect', () => {
    console.log('کاربر قطع شد:', socket.id);
    
    if (socket.id === broadcaster) {
      broadcaster = null;
      isLive = false;
      console.log('Broadcaster قطع شد');
      io.emit('broadcasterDisconnected');
    }
    
    viewers = viewers.filter(viewer => viewer !== socket.id);
  });
});

// راه‌اندازی سرور
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`سرور در حال اجرا روی پورت ${PORT}`);
});
