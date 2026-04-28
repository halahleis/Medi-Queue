import { io } from 'socket.io-client';

let socket = null;

export const getSocket = () => {
  const token = localStorage.getItem('mq_token');
  if (!token) return null;
  if (!socket) {
    socket = io({
      path: '/socket.io',
      auth: { token },
      autoConnect: true,
      reconnection: true,
    });
  }
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};
