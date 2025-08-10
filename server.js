const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 10000;

// ساختارهای داده
const onlineStats = {
    totalViewers: 0,
    currentViewers: 0,
    viewerHistory: []
};

const rooms = new Map();

// Middleware
app.use(cors({
    origin: ['https://amiralfa.ir', 'http://localhost'],
    methods: ['GET', 'POST'],
    credentials: true
}));

// WebSocket CORS headers
wss.on('headers', (headers) => {
    headers.push('Access-Control-Allow-Origin: https://amiralfa.ir');
    headers.push('Access-Control-Allow-Credentials: true');
});

// Helper functions
function safeSend(ws, msgObj) {
    try {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify(msgObj));
        }
    } catch (e) {
        console.error('Error sending message:', e);
    }
}

function updateViewerStats(viewerId, name, room, isJoining) {
    if (isJoining) {
        onlineStats.currentViewers++;
        onlineStats.totalViewers++;
        onlineStats.viewerHistory.push({
            id: viewerId,
            name: name || 'ناشناس',
            joinTime: new Date(),
            leaveTime: null,
            room: room
        });
        
        // محدود کردن حجم تاریخچه
        if (onlineStats.viewerHistory.length > 1000) {
            onlineStats.viewerHistory = onlineStats.viewerHistory.slice(-500);
        }
    } else {
        onlineStats.currentViewers--;
        const viewerRecord = onlineStats.viewerHistory.find(v => v.id === viewerId);
        if (viewerRecord) {
            viewerRecord.leaveTime = new Date();
        }
    }
}

// WebSocket Connection Handler
wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', () => ws.isAlive = true);

    ws.on('message', (raw) => {
        try {
            const msg = JSON.parse(raw.toString());
            handleMessage(ws, msg);
        } catch (e) {
            console.warn('Invalid JSON received:', raw.toString());
            safeSend(ws, { type: 'error', reason: 'invalid-json' });
        }
    });

    ws.on('close', () => {
        handleDisconnect(ws);
    });
});

function handleMessage(ws, msg) {
    const { type } = msg;

    switch (type) {
        case 'join':
            handleJoin(ws, msg);
            break;
            
        case 'offer':
        case 'answer':
        case 'candidate':
            handleWebRTCMessage(ws, msg);
            break;
            
        case 'control':
            handleControlMessage(ws, msg);
            break;
            
        case 'leave':
            handleLeave(ws, msg);
            break;
            
        default:
            safeSend(ws, { type: 'error', reason: 'unknown-type' });
    }
}

function handleJoin(ws, msg) {
    const { role, room, name } = msg;
    
    if (!room) {
        return safeSend(ws, { type: 'error', reason: 'missing-room' });
    }

    ws.roomId = room;
    ws.role = role;

    // ایجاد اتاق اگر وجود ندارد
    if (!rooms.has(room)) {
        rooms.set(room, {
            publisher: null,
            controller: null,
            viewers: new Map(),
            streamActive: false,
            currentAd: null
        });
    }

    const roomObj = rooms.get(room);

    switch (role) {
        case 'publisher':
            handlePublisherJoin(ws, room, roomObj);
            break;
            
        case 'viewer':
            handleViewerJoin(ws, room, roomObj, name);
            break;
            
        case 'controller':
            handleControllerJoin(ws, room, roomObj);
            break;
            
        default:
            safeSend(ws, { type: 'error', reason: 'invalid-role' });
    }
}

function handlePublisherJoin(ws, room, roomObj) {
    // اگر پابلیشر قبلی وجود دارد، جایگزین کن
    if (roomObj.publisher && roomObj.publisher !== ws) {
        safeSend(roomObj.publisher, { type: 'info', reason: 'new-publisher-replaced' });
        roomObj.publisher.close();
    }
    
    roomObj.publisher = ws;
    safeSend(ws, { type: 'joined', role: 'publisher', room });
    console.log(`Publisher joined room=${room}`);

    // اطلاع به کنترلر
    if (roomObj.controller) {
        safeSend(roomObj.controller, { type: 'publisher-ready' });
        if (roomObj.streamActive) {
            safeSend(roomObj.controller, { type: 'stream-started' });
        }
    }
}

function handleViewerJoin(ws, room, roomObj, name) {
    const viewerId = uuidv4();
    ws.viewerId = viewerId;
    roomObj.viewers.set(viewerId, ws);
    
    // آپدیت آمار
    updateViewerStats(viewerId, name, room, true);
    
    safeSend(ws, { type: 'joined', role: 'viewer', room, viewerId });
    console.log(`Viewer ${viewerId} joined room=${room}`);

    // اطلاع رسانی وضعیت جریان
    if (roomObj.streamActive) {
        safeSend(ws, { type: 'stream-started' });
    }
    if (roomObj.currentAd) {
        safeSend(ws, { type: 'play-ad', adId: roomObj.currentAd });
    }

    // اطلاع به پابلیشر
    if (roomObj.publisher) {
        safeSend(roomObj.publisher, { type: 'viewer-joined', viewerId });
    }
}

function handleControllerJoin(ws, room, roomObj) {
    // اگر کنترلر قبلی وجود دارد، جایگزین کن
    if (roomObj.controller && roomObj.controller !== ws) {
        safeSend(roomObj.controller, { type: 'info', reason: 'new-controller-replaced' });
        roomObj.controller.close();
    }
    
    roomObj.controller = ws;
    safeSend(ws, { type: 'joined', role: 'controller', room });
    console.log(`Controller joined room=${room}`);

    // اطلاع رسانی وضعیت فعلی
    if (roomObj.publisher) {
        safeSend(ws, { type: 'publisher-ready' });
        if (roomObj.streamActive) {
            safeSend(ws, { type: 'stream-started' });
        }
    }
}

function handleWebRTCMessage(ws, msg) {
    const roomId = msg.room || ws.roomId;
    if (!roomId || !rooms.has(roomId)) {
        return safeSend(ws, { type: 'error', reason: 'unknown-room' });
    }

    const roomObj = rooms.get(roomId);
    const { type } = msg;

    if (type === 'offer') {
        const { viewerId, offer } = msg;
        const viewerWs = roomObj.viewers.get(viewerId);
        if (viewerWs) {
            safeSend(viewerWs, { type: 'offer', offer, viewerId });
        } else {
            safeSend(ws, { type: 'error', reason: 'viewer-not-found', viewerId });
        }
    } 
    else if (type === 'answer') {
        const { viewerId, answer } = msg;
        if (roomObj.publisher) {
            safeSend(roomObj.publisher, { type: 'answer', viewerId, answer });
        } else {
            safeSend(ws, { type: 'error', reason: 'publisher-not-found' });
        }
    } 
    else if (type === 'candidate') {
        const { viewerId, candidate } = msg;
        if (ws.role === 'publisher') {
            const viewer = roomObj.viewers.get(viewerId);
            if (viewer) safeSend(viewer, { type: 'candidate', candidate, viewerId });
        } else if (ws.role === 'viewer' && roomObj.publisher) {
            safeSend(roomObj.publisher, { type: 'candidate', candidate, viewerId: ws.viewerId });
        }
    }
}

function handleControlMessage(ws, msg) {
    const roomId = msg.room || ws.roomId;
    if (!roomId || !rooms.has(roomId)) {
        return safeSend(ws, { type: 'error', reason: 'unknown-room' });
    }

    const roomObj = rooms.get(roomId);
    const { action } = msg;

    // بررسی وجود پابلیشر برای اکشن‌هایی که نیاز دارند
    if (!roomObj.publisher && !['stop-stream'].includes(action)) {
        return safeSend(ws, { type: 'error', reason: 'no-publisher' });
    }

    switch (action) {
        case 'start-stream':
            roomObj.streamActive = true;
            broadcastToRoom(roomObj, { type: 'stream-started' });
            break;
            
        case 'stop-stream':
            roomObj.streamActive = false;
            broadcastToRoom(roomObj, { type: 'stream-stopped' });
            break;
            
        case 'mute-audio':
            broadcastToViewers(roomObj, { type: 'mute-audio' });
            break;
            
        case 'play-ad':
            const { adId, adUrl, muteAudio } = msg;
            roomObj.currentAd = adId;
            broadcastToViewers(roomObj, { 
                type: 'play-ad', 
                adId, 
                adUrl,
                muteAudio: muteAudio || false
            });
            if (roomObj.controller) {
                safeSend(roomObj.controller, { type: 'ad-started', adId });
            }
            break;
            
        case 'resume-stream':
            roomObj.currentAd = null;
            broadcastToViewers(roomObj, { type: 'resume-stream' });
            if (roomObj.controller) {
                safeSend(roomObj.controller, { type: 'ad-stopped' });
            }
            break;
            
        case 'send-subtitle':
            broadcastToViewers(roomObj, { type: 'subtitle', text: msg.text });
            break;
            
        case 'clear-subtitle':
            broadcastToViewers(roomObj, { type: 'clear-subtitle' });
            break;
            
        default:
            safeSend(ws, { type: 'error', reason: 'unknown-action' });
    }
}

function broadcastToRoom(roomObj, msg) {
    if (roomObj.controller) {
        safeSend(roomObj.controller, msg);
    }
    broadcastToViewers(roomObj, msg);
}

function broadcastToViewers(roomObj, msg) {
    for (const [id, viewer] of roomObj.viewers) {
        safeSend(viewer, msg);
    }
}

function handleLeave(ws, msg) {
    const roomId = ws.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    const roomObj = rooms.get(roomId);

    switch (ws.role) {
        case 'viewer':
            handleViewerLeave(ws, roomObj);
            break;
            
        case 'publisher':
            handlePublisherLeave(roomObj);
            break;
            
        case 'controller':
            roomObj.controller = null;
            console.log(`Controller left room=${roomId}`);
            break;
    }

    cleanupRoom(roomId);
}

function handleViewerLeave(ws, roomObj) {
    const viewerId = ws.viewerId;
    roomObj.viewers.delete(viewerId);
    
    // آپدیت آمار
    updateViewerStats(viewerId, null, null, false);
    
    if (roomObj.publisher) {
        safeSend(roomObj.publisher, { type: 'viewer-left', viewerId });
    }
    console.log(`Viewer ${viewerId} left room=${ws.roomId}`);
}

function handlePublisherLeave(roomObj) {
    broadcastToRoom(roomObj, { type: 'publisher-left' });
    
    roomObj.publisher = null;
    roomObj.streamActive = false;
    roomObj.currentAd = null;
    console.log(`Publisher left room`);
}

function handleDisconnect(ws) {
    const roomId = ws.roomId;
    if (!roomId || !rooms.has(roomId)) return;

    const roomObj = rooms.get(roomId);

    switch (ws.role) {
        case 'viewer':
            handleViewerDisconnect(ws, roomObj);
            break;
            
        case 'publisher':
            handlePublisherDisconnect(roomObj);
            break;
            
        case 'controller':
            roomObj.controller = null;
            console.log(`Controller disconnected from room=${roomId}`);
            break;
    }

    cleanupRoom(roomId);
}

function handleViewerDisconnect(ws, roomObj) {
    const viewerId = ws.viewerId;
    roomObj.viewers.delete(viewerId);
    
    // آپدیت آمار
    updateViewerStats(viewerId, null, null, false);
    
    if (roomObj.publisher) {
        safeSend(roomObj.publisher, { type: 'viewer-left', viewerId });
    }
    console.log(`Viewer ${viewerId} disconnected from room=${ws.roomId}`);
}

function handlePublisherDisconnect(roomObj) {
    broadcastToRoom(roomObj, { type: 'publisher-left' });
    
    roomObj.publisher = null;
    roomObj.streamActive = false;
    roomObj.currentAd = null;
    console.log('Publisher disconnected');
}

function cleanupRoom(roomId) {
    if (!rooms.has(roomId)) return;

    const roomObj = rooms.get(roomId);
    
    if (!roomObj.publisher && !roomObj.controller && roomObj.viewers.size === 0) {
        rooms.delete(roomId);
        console.log(`Room ${roomId} deleted`);
    }
}

// API Endpoints
app.get('/stats', (req, res) => {
    res.json({
        currentViewers: onlineStats.currentViewers,
        totalViewers: onlineStats.totalViewers,
        viewerHistory: onlineStats.viewerHistory.map(viewer => ({
            ...viewer,
            joinTime: viewer.joinTime.toISOString(),
            leaveTime: viewer.leaveTime ? viewer.leaveTime.toISOString() : null
        }))
    });
});

app.get('/', (req, res) => {
    res.send('WebRTC Signaling Server is running');
});

// Health check for WebSocket connections
setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) return ws.terminate();
        ws.isAlive = false;
        ws.ping(null, false, true);
    });
}, 30000);

// Start server
server.listen(PORT, () => {
    console.log(`Signaling server listening on port ${PORT}`);
});
