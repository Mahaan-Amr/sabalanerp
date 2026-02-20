import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import postRoutes from './routes/posts';
import orderRoutes from './routes/orders';
import contractRoutes from './routes/contracts';
import contractTemplateRoutes from './routes/contractTemplates';
import customerRoutes from './routes/customers';
import departmentRoutes from './routes/departments';
import dashboardRoutes from './routes/dashboard';
import securityRoutes from './routes/security';

// Import workspace routes
import salesRoutes from './routes/sales';
import crmRoutes from './routes/crm';
import inventoryRoutes from './routes/inventory';
import workspacePermissionsRoutes from './routes/workspace-permissions';
import permissionsRoutes from './routes/permissions';
import productsRoutes from './routes/products';
import servicesRoutes from './routes/services';
import cuttingTypesRoutes from './routes/cutting-types';
import subServicesRoutes from './routes/sub-services';
import stairStandardLengthRoutes from './routes/stair-standard-lengths';
import layerTypesRoutes from './routes/layer-types';
import stoneFinishingRoutes from './routes/stone-finishings';
import publicContractsRoutes from './routes/public-contracts';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();
const app = express();
app.set('trust proxy', 1);
const server = createServer(app);
const isProduction = process.env.NODE_ENV === 'production';
const configuredFrontendUrl = process.env.FRONTEND_URL;

const validateProductionEnvironment = () => {
  if (!isProduction) return;

  const jwtSecret = process.env.JWT_SECRET || '';
  const hasWeakJwtSecret = jwtSecret.length < 32 || jwtSecret.includes('your-super-secret');
  const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL'];
  const missingVars = requiredVars.filter((key) => !process.env[key]);

  if (missingVars.length > 0 || hasWeakJwtSecret) {
    const details = [
      missingVars.length > 0 ? `Missing vars: ${missingVars.join(', ')}` : '',
      hasWeakJwtSecret ? 'JWT_SECRET must be at least 32 chars and not a placeholder.' : ''
    ].filter(Boolean);
    throw new Error(`Invalid production environment. ${details.join(' ')}`);
  }
};

validateProductionEnvironment();

const allowedOrigins = (configuredFrontendUrl || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const resolveCorsOrigin = () => {
  if (!isProduction) {
    return configuredFrontendUrl || 'http://localhost:3000';
  }
  return allowedOrigins;
};

const io = new Server(server, {
  cors: {
    origin: resolveCorsOrigin(),
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 5000;

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => {
    // Skip rate limiting for localhost in development
    const isLocalhost = req.ip === '127.0.0.1' ||
                       req.ip === '::1' ||
                       req.ip === '::ffff:127.0.0.1';
    const isDevelopment = process.env.NODE_ENV === 'development';
    return isLocalhost && isDevelopment;
  }
});

// Middleware
app.use(helmet());
app.use(cors({
  origin: resolveCorsOrigin(),
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(limiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/contract-templates', contractTemplateRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Workspace-specific routes
app.use('/api/security', securityRoutes);

// Workspace-specific routes
if (!isProduction) console.log('? Registering workspace routes...');
app.use('/api/sales', salesRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/workspace-permissions', workspacePermissionsRoutes);
app.use('/api/permissions', permissionsRoutes);
if (!isProduction) console.log('? Registering products routes...');
app.use('/api/products', productsRoutes);
if (!isProduction) console.log('? Registering services routes...');
app.use('/api/services', servicesRoutes);
if (!isProduction) console.log('? Registering cutting types routes...');
app.use('/api/cutting-types', cuttingTypesRoutes);
if (!isProduction) console.log('? Registering sub-services routes...');
app.use('/api/sub-services', subServicesRoutes);
if (!isProduction) console.log('? Registering stair standard length routes...');
app.use('/api/stair-standard-lengths', stairStandardLengthRoutes);
if (!isProduction) console.log('? Registering layer type routes...');
app.use('/api/layer-types', layerTypesRoutes);
if (!isProduction) console.log('? Registering stone finishing routes...');
app.use('/api/stone-finishings', stoneFinishingRoutes);
app.use('/api/public', publicContractsRoutes);
if (!isProduction) console.log('? All routes registered successfully');

// Static files for generated PDFs (contracts)
app.use('/files/contracts', express.static(path.join(process.cwd(), 'storage', 'contracts'), {
  etag: false,
  maxAge: '0',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));

// Health check
app.get('/api/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'OK',
      database: 'OK',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  } catch (error) {
    res.status(503).json({
      status: 'DEGRADED',
      database: 'DOWN',
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/ready', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false });
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  if (!isProduction) console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    if (!isProduction) console.log('User disconnected:', socket.id);
  });

  // Join room for user-specific updates
  socket.on('join-user-room', (userId: string) => {
    socket.join(`user-${userId}`);
  });

  // Leave room
  socket.on('leave-user-room', (userId: string) => {
    socket.leave(`user-${userId}`);
  });
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start server
server.listen(PORT, () => {
  console.log(`? Server running on port ${PORT}`);
  console.log(`? Health check: http://localhost:${PORT}/api/health`);
});

export { io };

