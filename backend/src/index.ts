import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import rateLimit from 'express-rate-limit';

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

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
  origin: process.env.FRONTEND_URL || "http://localhost:3000",
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
console.log('🔧 Registering workspace routes...');
app.use('/api/sales', salesRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/workspace-permissions', workspacePermissionsRoutes);
app.use('/api/permissions', permissionsRoutes);
console.log('🔧 Registering products routes...');
app.use('/api/products', productsRoutes);
console.log('🔧 Registering services routes...');
app.use('/api/services', servicesRoutes);
console.log('🔧 Registering cutting types routes...');
app.use('/api/cutting-types', cuttingTypesRoutes);
console.log('🔧 Registering sub-services routes...');
app.use('/api/sub-services', subServicesRoutes);
console.log('🔧 Registering stair standard length routes...');
app.use('/api/stair-standard-lengths', stairStandardLengthRoutes);
console.log('🔧 Registering layer type routes...');
app.use('/api/layer-types', layerTypesRoutes);
console.log('🔧 Registering stone finishing routes...');
app.use('/api/stone-finishings', stoneFinishingRoutes);
console.log('✅ All routes registered successfully');

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
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
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
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

export { io };
