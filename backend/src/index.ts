import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import 'dotenv/config';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { PrismaClient } from '@prisma/client';
import { parseCookies, resolveAuthoritativeSession, SESSION_COOKIE } from './services/identitySessionService';

// Import routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import postRoutes from './routes/posts';
import orderRoutes from './routes/orders';
import contractRoutes from './routes/contracts';
import contractTemplateRoutes from './routes/contractTemplates';
import customerRoutes from './routes/customers';
import departmentRoutes from './routes/departments';
import personnelRoutes from './routes/personnel';
import dashboardRoutes from './routes/dashboard';
import personalRoutes from './routes/personal';
import securityRoutes from './routes/security';
import sabalanCalendarRoutes from './routes/sabalan-calendar';

// Import workspace routes
import salesRoutes from './routes/sales';
import crmRoutes from './routes/crm';
import inventoryRoutes from './routes/inventory';
import accountingRoutes from './routes/accounting';
import biRoutes from './routes/bi';
import logisticsRoutes from './routes/logistics';
import hrRoutes from './routes/hr';
import hrHiringRoutes from './routes/hr-hiring';
import workspacePermissionsRoutes from './routes/workspace-permissions';
import permissionsRoutes from './routes/permissions';
import productsRoutes from './routes/products';
import servicesRoutes from './routes/services';
import cuttingTypesRoutes from './routes/cutting-types';
import subServicesRoutes from './routes/sub-services';
import stairStandardLengthRoutes from './routes/stair-standard-lengths';
import layerTypesRoutes from './routes/layer-types';
import stoneFinishingRoutes from './routes/stone-finishings';
import catalogExcelRoutes from './routes/catalog-excel';
import publicContractsRoutes from './routes/public-contracts';
import uploadsRoutes from './routes/uploads';
import testHrHiringSmsRoutes from './routes/test-hr-hiring-sms';

// Import middleware
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { startAuthenticationRetentionCleanup } from './services/authenticationRetentionService';

const prisma = new PrismaClient();
startAuthenticationRetentionCleanup(prisma);
const app = express();
app.set('trust proxy', 1);
const server = createServer(app);
const isProduction = process.env.NODE_ENV === 'production';
const configuredFrontendUrl = process.env.FRONTEND_URL;

const validateProductionEnvironment = () => {
  if (!isProduction) return;

  const jwtSecret = process.env.JWT_SECRET || '';
  const hasWeakJwtSecret = jwtSecret.length < 32 || jwtSecret.includes('your-super-secret');
  const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL', 'PUBLIC_APP_URL', 'SMS_IR_API_KEY', 'SMS_IR_HIRING_INVITATION_TEMPLATE_ID', 'SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS'];
  const missingVars = requiredVars.filter((key) => !process.env[key]);
  const hiringTemplateId = process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_ID || '';
  const genericTemplateId = process.env.SMS_IR_TEMPLATE_ID || '135816';
  const hasInvalidHiringTemplate = !/^\d+$/.test(hiringTemplateId) || Number(hiringTemplateId) <= 0 || hiringTemplateId === genericTemplateId;
  const hiringTemplateParameters = (process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const hasInvalidHiringTemplateParameters = hiringTemplateParameters.length !== 1 || hiringTemplateParameters[0] !== 'Code';
  const hasInvalidSmsEnvironment = process.env.SMS_IR_ENVIRONMENT !== 'production';
  let hasInvalidPublicAppUrl = false;
  try {
    const publicAppUrl = new URL(process.env.PUBLIC_APP_URL || '');
    hasInvalidPublicAppUrl = publicAppUrl.protocol !== 'https:';
  } catch {
    hasInvalidPublicAppUrl = true;
  }

  if (missingVars.length > 0 || hasWeakJwtSecret || hasInvalidHiringTemplate || hasInvalidHiringTemplateParameters || hasInvalidSmsEnvironment || hasInvalidPublicAppUrl) {
    const details = [
      missingVars.length > 0 ? `Missing vars: ${missingVars.join(', ')}` : '',
      hasWeakJwtSecret ? 'JWT_SECRET must be at least 32 chars and not a placeholder.' : '',
      hasInvalidHiringTemplate ? 'SMS_IR_HIRING_INVITATION_TEMPLATE_ID must be a dedicated positive numeric template ID and must not equal SMS_IR_TEMPLATE_ID.' : '',
      hasInvalidHiringTemplateParameters ? 'SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS must be exactly Code.' : '',
      hasInvalidSmsEnvironment ? 'SMS_IR_ENVIRONMENT must be production.' : '',
      hasInvalidPublicAppUrl ? 'PUBLIC_APP_URL must be a valid HTTPS origin used for the fixed applicant entry page.' : ''
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
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors({
  origin: resolveCorsOrigin(),
  credentials: true
}));
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/posts', postRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/contracts', contractRoutes);
app.use('/api/contract-templates', contractTemplateRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/personnel', personnelRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/personal', personalRoutes);
app.use('/api/sabalan-calendar', sabalanCalendarRoutes);

// Workspace-specific routes
app.use('/api/security', securityRoutes);

// Workspace-specific routes
if (!isProduction) console.log('? Registering workspace routes...');
app.use('/api/sales', salesRoutes);
app.use('/api/crm', crmRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/accounting', accountingRoutes);
app.use('/api/bi', biRoutes);
app.use('/api/logistics', logisticsRoutes);
app.use('/api/hr', hrRoutes);
app.use('/api/hr-hiring', hrHiringRoutes);
app.use('/api/workspace-permissions', workspacePermissionsRoutes);
app.use('/api/permissions', permissionsRoutes);
app.use('/api/catalog-excel', catalogExcelRoutes);
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
app.use('/api/uploads', uploadsRoutes);
app.use('/api/public', publicContractsRoutes);
if (process.env.NODE_ENV === 'test' && process.env.HR_HIRING_E2E === 'true') {
  app.use('/api/test/hr-hiring-sms', testHrHiringSmsRoutes);
}
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

app.use('/files/accounting-contracts', express.static(path.join(process.cwd(), 'storage', 'accounting-contracts'), {
  etag: false,
  maxAge: '0',
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  }
}));

app.use('/files/uploads/images', express.static(path.join(process.cwd(), 'uploads', 'images'), {
  etag: false,
  maxAge: '1h'
}));

app.get('/favicon.ico', (_req, res) => {
  res.status(204).end();
});

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

// Socket.io connections use the same authoritative, revocable session cookie as HTTP.
io.use(async (socket, next) => {
  try {
    const token = parseCookies(socket.handshake.headers.cookie)[SESSION_COOKIE];
    if (!token) return next(new Error('Authentication required'));
    const session = await resolveAuthoritativeSession(prisma, token);
    if (!session) return next(new Error('Authentication required'));
    socket.data.userId = session.userId;
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});

// Socket.io connection handling
io.on('connection', (socket) => {
  if (!isProduction) console.log('User connected:', socket.id);
  socket.join(`user-${socket.data.userId}`);

  socket.on('disconnect', () => {
    if (!isProduction) console.log('User disconnected:', socket.id);
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
