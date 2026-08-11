const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { setIO } = require('./io');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_dev_secret';

const initSocket = (httpServer) => {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:5173',
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Auth handshake: client sends auth.token.
  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Missing token.'));
      const decoded = jwt.verify(token, JWT_SECRET);
      socket.user = decoded;
      next();
    } catch (err) {
      next(new Error('Invalid token.'));
    }
  });

  io.on('connection', (socket) => {
    // Auto-subscribe a patient to their personal channel so the live status
    // tracker receives `patient:status` events without an extra round trip.
    if (socket.user?.role === 'patient' && socket.user?.profileId) {
      socket.join(`patient:${socket.user.profileId}`);
      socket.join(`patient:communication:${socket.user.profileId}`);
    }

    if (socket.user?.role === 'staff') {
      socket.join('staff:communication');
    }

    // Subscribe to a board's events: board:<doctorId>:<date>
    socket.on('board:subscribe', ({ doctorId, date }) => {
      if (doctorId && date) socket.join(`board:${doctorId}:${date}`);
    });
    socket.on('board:unsubscribe', ({ doctorId, date }) => {
      if (doctorId && date) socket.leave(`board:${doctorId}:${date}`);
    });

    // Subscribe to a doctor's chat channel.
    socket.on('chat:subscribe', ({ doctorId }) => {
      if (doctorId) socket.join(`doctor:${doctorId}`);
    });
    socket.on('chat:unsubscribe', ({ doctorId }) => {
      if (doctorId) socket.leave(`doctor:${doctorId}`);
    });

    socket.on('patient_staff:subscribe', ({ conversationId }) => {
      if (conversationId) socket.join(`patient_staff:${conversationId}`);
    });
    socket.on('patient_staff:unsubscribe', ({ conversationId }) => {
      if (conversationId) socket.leave(`patient_staff:${conversationId}`);
    });
  });

  setIO(io);
  return io;
};

module.exports = { initSocket };
