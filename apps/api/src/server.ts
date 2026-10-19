import express from 'express';
import http from 'http';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { ENV } from './config/env.js';
import { db } from './config/database.js';
import { errorHandler } from './middleware/errorHandler.js';
import { initSocketIO } from './sockets/index.js';

import cookieParser from 'cookie-parser';
import compression from 'compression';

// Route imports
import authRoutes from './modules/auth/authRoutes.js';
import inviteRoutes from './modules/invites/inviteRoutes.js';
import userRoutes from './modules/users/userRoutes.js';
import taskRoutes from './modules/tasks/taskRoutes.js';
import attendanceRoutes from './modules/attendance/attendanceRoutes.js';
import certificateRoutes from './modules/certificates/certificateRoutes.js';
import chatRoutes from './modules/chat/chatRoutes.js';
import trackerRoutes from './modules/tracker/trackerRoutes.js';
import calendarRoutes from './modules/calendar/calendarRoutes.js';
import automationRoutes from './modules/automations/automationsRoutes.js';
import exportRoutes from './modules/exports/exportRoutes.js';
import notificationRoutes from './modules/notifications/notificationsRoutes.js';

const app = express();
const server = http.createServer(app);

// Security & Middlewares
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);
const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = [
      ENV.CLIENT_ORIGIN,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5000',
      'http://127.0.0.1:5000',
    ];
    if (allowed.some((a) => a && origin.startsWith(a.replace(/\/$/, '')))) {
      return callback(null, true);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(compression());
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Uploads static directory
const uploadDir = path.resolve(process.cwd(), ENV.UPLOAD_DIR);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}
app.use('/uploads', express.static(uploadDir));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/invites', inviteRoutes);
app.use('/api/users', userRoutes);

app.use('/api/tasks', taskRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/tracker', trackerRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/exports', exportRoutes);
app.use('/api/notifications', notificationRoutes);

// Health check
app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    env: ENV.NODE_ENV,
  });
});

// Static frontend serving in production or when client dist exists
const distCandidates = [
  path.resolve(process.cwd(), '../web/dist'),
  path.resolve(process.cwd(), 'apps/web/dist'),
];
const clientDist = distCandidates.find((d) => fs.existsSync(d) && fs.existsSync(path.join(d, 'index.html')));

if (clientDist) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Ensure unmatched API routes return clean JSON 404 instead of HTML or 405
app.all('/api/*', (_req, res) => {
  res.status(404).json({ message: 'API route not found' });
});

// Error handling middleware
app.use(errorHandler);

// Initialize WebSockets
initSocketIO(server);

import { initScheduler } from './modules/automations/scheduler.js';

// Boot database & server
export async function startServer() {
  try {
    console.log('[Database] Checking schema and migrations...');
    // Ensure migrations are up to date
    await db.migrate.latest({
      directory: path.resolve(process.cwd(), 'src/db/migrations'),
    });
    console.log('[Database] Migrations up to date.');

    // Seed database if empty
    const userCount = await db('users').count('id as count').first();
    if (!userCount || Number(userCount.count) === 0) {
      console.log('[Database] Seeding initial admin from specification...');
      await db.seed.run({
        directory: path.resolve(process.cwd(), 'src/db/seeds'),
      });
      console.log('[Database] Seed completed successfully.');
    }

    // Initialize scheduler
    initScheduler();

    server.listen(ENV.PORT, () => {
      console.log(`====================================================`);
      console.log(`Command Center for Software Hub 2.0 API Server`);
      console.log(`Running on: http://localhost:${ENV.PORT}`);
      console.log(`WebSockets enabled on port: ${ENV.PORT}`);
      console.log(`====================================================`);
    });
  } catch (error) {
    console.error('[Server Boot Error]', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server };
