/**
 * Holds the socket.io server instance after it is initialised in server.js,
 * so controllers can emit events without an import cycle.
 */
let io = null;

const setIO = (ioInstance) => {
  io = ioInstance;
};

const getIO = () => io;

module.exports = { setIO, getIO };
