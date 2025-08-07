const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public')); // فایل‌های HTML/JS

io.on('connection', (socket) => {
    console.log('یک کاربر متصل شد:', socket.id);

    socket.on('stream', (data) => {
        // ارسال استریم به دیگر کاربران
        socket.broadcast.emit('stream', data);
    });

    socket.on('disconnect', () => {
        console.log('کاربر قطع شد:', socket.id);
    });
});

http.listen(10000, () => {
    console.log('سرور در حال اجرا است ');
});
