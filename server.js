const WebSocket = require('ws');
const express = require('express');
const http = require('http');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let broadcaster = null;
let viewers = new Set();
let controller = null;

wss.on('connection', (ws, req) => {
  ws.on('message', async (msg) => {
    let message;
    try {
      message = JSON.parse(msg);
    } catch (e) {
      return;
    }

    // 🔹 دسته‌بندی نقش کاربر
    if (message.type === "offer") {
      broadcaster = ws;
      // اطلاع به کنترلر که استریم آماده است
      if (controller && controller.readyState === WebSocket.OPEN) {
        controller.send(JSON.stringify({ type: "stream-ready" }));
      }
    }

    // 🔸 viewer جدید
    if (message.type === "answer" && broadcaster) {
      broadcaster.send(JSON.stringify({ type: "answer", data: message.data }));
    }

    // 🔹 ICE candidate بین همه تبادل شود
    if (message.type === "candidate") {
      if (ws === broadcaster) {
        viewers.forEach(v =>
          v.readyState === WebSocket.OPEN &&
          v.send(JSON.stringify({ type: "candidate", data: message.data }))
        );
      } else {
        broadcaster && broadcaster.readyState === WebSocket.OPEN &&
          broadcaster.send(JSON.stringify({ type: "candidate", data: message.data }));
      }
    }

    // 🔸 viewer جدید: در لیست ثبت و درخواست offer کند
    if (message.type === "viewer") {
      viewers.add(ws);
      if (broadcaster) {
        broadcaster.send(JSON.stringify({ type: "get-offer" }));
      }
    }

    // 🔹 کنترلر اتصال یافت
    if (message.type === "controller") {
      controller = ws;
    }

    // 🔹 کنترلر → شروع استریم
    if (message.type === "show-stream") {
      viewers.forEach(v =>
        v.readyState === WebSocket.OPEN &&
        broadcaster &&
        broadcaster.send(JSON.stringify({ type: "get-offer" }))
      );
    }

    // 🔸 کنترلر → تبلیغ شماره N
    if (message.type === "play-ad") {
      viewers.forEach(v =>
        v.readyState === WebSocket.OPEN &&
        v.send(JSON.stringify({
          type: "ad",
          number: message.ad
        }))
      );
    }

    // 🔸 کنترلر → ارسال زیرنویس
    if (message.type === "subtitle") {
      viewers.forEach(v =>
        v.readyState === WebSocket.OPEN &&
        v.send(JSON.stringify({
          type: "subtitle",
          text: message.text
        }))
      );
    }
  });

  ws.on('close', () => {
    viewers.delete(ws);
    if (ws === broadcaster) broadcaster = null;
    if (ws === controller) controller = null;
  });
});

// پورت برای اجرا
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("🚀 WebSocket server running on port", PORT);
});
