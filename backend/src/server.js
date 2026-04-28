require('dotenv').config();

const express = require('express');
const http = require('http');
const cors = require('cors');
const morgan = require('morgan');

const authRoutes = require('./routes/authRoutes');
const staffRoutes = require('./routes/staffRoutes');
const adminRoutes = require('./routes/adminRoutes');
const patientRoutes = require('./routes/patientRoutes');
const publicRoutes = require('./routes/publicRoutes');
const { errorHandler } = require('./middleware/errorHandler');
const { initSocket } = require('./sockets/init');
const { pool } = require('./config/db');

const app = express();

app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '5mb' }));
app.use(morgan('dev'));

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/patient', patientRoutes);

// 404
app.use((req, res) => res.status(404).json({ message: `Not found: ${req.method} ${req.path}` }));

// Centralised error handler (must be last)
app.use(errorHandler);

const PORT = parseInt(process.env.PORT, 10) || 5000;
const server = http.createServer(app);
initSocket(server);

// Verify DB connection before starting.
pool.query('SELECT 1')
  .then(() => {
    server.listen(PORT, () => {
      console.log(`✅ MediQueue API listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('❌ Failed to connect to PostgreSQL:', err.message);
    console.error('   Check your .env file (PGHOST, PGUSER, PGPASSWORD, PGDATABASE).');
    process.exit(1);
  });
