import express from 'express';
import mongoose from 'mongoose';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { Server } from 'socket.io';
import authRoutes from './routes/auth.js';
import busRoutes from './routes/bus.js';
import driverRoutes from './routes/driver.js';
import tripRoutes from './routes/trip.js';
import locationRoutes from './routes/location.js';
import publicRoutes from './routes/public.js';
import incidentRoutes from './routes/incidents.js';
import transitRoutes from './routes/transit.js';
import routingRoutes from './routes/routing.js';
import passengerRoutes from './routes/passenger.js';
import adminRoutes from './routes/admin.js';
import assistantRoutes from './routes/assistant.js';
import { setupSocket } from './socket.js';
import { setIO } from './services/realtime.js';
import { runMigrations } from './migrations.js';
import * as liveTracker from './services/liveTracker.js';

dotenv.config();

// Web origins allowed to call the API (comma-separated CORS_ORIGINS). Mobile apps send no Origin header,
// so CORS doesn't affect them. Without CORS_ORIGINS (local development) any http://localhost:<port> is allowed.
const allowedOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
  : [/^http:\/\/(localhost|127\.0\.0\.1):\d+$/];

const app = express();
// Behind Render's proxy: needed so req.ip is the real client (used by rate limiting).
app.set('trust proxy', 1);
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: allowedOrigins }));
// Driver registration carries document photos (base64), so it gets a larger body limit.
app.use('/api/auth/driver/register', express.json({ limit: '20mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
// Express 5 leaves req.body undefined when a request has no body (e.g. POST /drivers/:id/approve).
app.use((req, res, next) => { req.body ??= {}; next(); });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/buses', busRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/locations', locationRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/incidents', incidentRoutes);
app.use('/api/transit', transitRoutes);
app.use('/api/routing', routingRoutes);
app.use('/api/passenger', passengerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/assistant', assistantRoutes);

// Health check (also pinged by a cron job to keep the free server awake)
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', message: 'Server is running' });
});

app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// Errors (malformed JSON, oversized bodies, bad ObjectIds, unexpected failures)
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'Request too large' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON' });
  if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid id' });
  console.error(err);
  res.status(500).json({ message: 'Server error' });
});

setIO(io);
setupSocket(io);

// MongoDB connection (exported so tests can wait for startup to finish)
export const ready = mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/transport_tracking')
  .then(async () => {
    console.log('MongoDB connected successfully');
    await runMigrations();
    liveTracker.start();
  })
  .catch((error) => {
    console.error('MongoDB connection error:', error);
  });

const PORT = process.env.PORT || 5000;

httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export { app, httpServer, io };
