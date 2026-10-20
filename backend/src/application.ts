import { configureOnlineHrInvalidation,configurePrivateQualificationHrInvalidation } from './services/onlineHrInvalidation';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import 'dotenv/config';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { prisma } from './lib/prisma';
import type { BackendRuntimeRole } from './services/runtimeStartup';
import { resolveRuntimeRole } from './services/runtimeStartup';
import { assertOnlineComposedRuntime,assertOnlineQualifiedRuntime,type OnlineQualifiedRuntime, type OnlineComposedRuntime } from './services/onlineRuntimeComposition';
import {onlineRealtimeSuspendedForProtectedBootstrap} from './services/onlineReleaseAdmission';
import {protectedBootstrapReadinessProbe} from './services/onlineProtectedBootstrapAuthority';
import { runtimeHttpRequests } from './services/httpRequestLifecycle';
import { RealtimeDeliveryLifecycle } from './services/realtimeDeliveryLifecycle';
import { deploymentMaintenanceActive } from './services/deploymentMaintenance';
import { validateProductionEnvironment } from './services/productionEnvironment';
import { registerRealtimePublisher } from './services/realtimePublisher';
import { authorizeHrUser } from './services/hrAuthorizationService';
import { normalizeStructuredNumeralsMiddleware } from './middleware/normalizeStructuredNumerals';
import { errorHandler } from './middleware/errorHandler';
import { notFound } from './middleware/notFound';
import { getRecoveryRuntimeState, RECOVERY_COORDINATION_DIR, recoveryWriteGuard } from './services/recoveryRuntime';
import { executeRealtimeCallback } from './services/onlineRuntimeWork';
import { registerPartnerNotificationAccess } from './services/partnerSales/notifications/access';
import { inquiryNotificationAccess } from './services/partnerSales/notifications/inquiryDelivery';
import { resolveHrRedesignCutoverStartup } from './services/hrRedesignCutoverStartup';

// Import routes
import authRoutes from "./routes/auth";
import userRoutes from "./routes/users";
import postRoutes from "./routes/posts";
import orderRoutes from "./routes/orders";
import contractRoutes from "./routes/contracts";
import contractTemplateRoutes from "./routes/contractTemplates";
import customerRoutes from "./routes/customers";
import departmentRoutes from "./routes/departments";
import personnelRoutes from "./routes/personnel";
import dashboardRoutes from "./routes/dashboard";
import personalRoutes from "./routes/personal";
import securityRoutes from "./routes/security";
import attendanceDeviceRoutes from "./routes/attendance-device";
import sabalanCalendarRoutes from "./routes/sabalan-calendar";

// Import workspace routes
import salesRoutes from "./routes/sales";
import dispatchCreditRoutes from "./routes/dispatchCredit";
import crmRoutes from "./routes/crm";
import inventoryRoutes from "./routes/inventory";
import accountingRoutes from "./routes/accounting";
import biRoutes from "./routes/bi";
import logisticsRoutes from "./routes/logistics";
import hrRoutes from "./routes/hr";
import hrHiringRoutes from "./routes/hr-hiring";
import hrApplicantExperienceRoutes from "./routes/hr-applicant-experience";
import crossWorkspaceDutyRoutes from "./routes/hr-duties";
import workspacePermissionsRoutes from "./routes/workspace-permissions";
import permissionsRoutes from "./routes/permissions";
import productsRoutes from "./routes/products";
import servicesRoutes from "./routes/services";
import cuttingTypesRoutes from "./routes/cutting-types";
import subServicesRoutes from "./routes/sub-services";
import stairStandardLengthRoutes from "./routes/stair-standard-lengths";
import layerTypesRoutes from "./routes/layer-types";
import stoneFinishingRoutes from "./routes/stone-finishings";
import catalogExcelRoutes from "./routes/catalog-excel";
import publicContractsRoutes from "./routes/public-contracts";
import uploadsRoutes from "./routes/uploads";
import testHrHiringSmsRoutes from "./routes/test-hr-hiring-sms";
import systemRecoveryRoutes from "./routes/system-recovery";
import notificationRoutes from "./routes/notifications";
import supportTicketRoutes from "./routes/support-tickets";
import dispatchMasterDataRoutes from "./routes/dispatch-master-data";
import biometricConnectorRoutes from "./routes/biometric-connector";
import dispatchConfirmationRoutes from "./routes/dispatch-confirmation";
import shipmentQuantityRoutes from "./routes/shipment-quantities";
import dispatchCaseRoutes from "./routes/dispatch-cases";
import dispatchCutoverRoutes from "./routes/dispatch-cutover";
import shipmentStatementOperationsRoutes from "./routes/shipment-statement-operations";
import partnerTechnicalRoutes from "./routes/partner-technical";
import partnerTechnicalPolicyRoutes from "./routes/partner-technical-policy";
import partnerInquiryRoutes from "./routes/partner-inquiries";
import partnerManagementRoutes from "./routes/partner-management";
import partnerWorkspaceRoutes from "./routes/partner-workspaces";
import partnerCaseRoutes from "./routes/partner-cases";
import partnerRetailCollectionRoutes from "./routes/partner-retail-collections";
import partnerFulfillmentRoutes from "./routes/partner-fulfillment";
import partnerCorrectionRoutes from "./routes/partner-corrections";
import partnerAccountingRoutes from "./routes/partner-accounting";
import partnerReportRoutes from "./routes/partner-reports";
import partnerOperationsRoutes from "./routes/partner-operations";
import partnerActivationRoutes from "./routes/partner-activation";


let applicationConstructed = false;
const onlineRealtimeApplications = new WeakMap<object, Readonly<{runtime:OnlineComposedRuntime;
  database:typeof prisma;lifecycle:RealtimeDeliveryLifecycle}>>();
const privateQualificationApplications=new WeakMap<object,Readonly<{runtime:OnlineQualifiedRuntime;database:typeof prisma;lifecycle:RealtimeDeliveryLifecycle}>>();
export function assertPrivateQualificationApplicationRealtimeOwner(application:unknown,runtime:OnlineQualifiedRuntime){
 assertOnlineQualifiedRuntime(runtime,'http');
 const owner=application&&typeof application==='object'?privateQualificationApplications.get(application):undefined;
 if(!owner||owner.runtime!==runtime)throw Error('PRIVATE_QUALIFICATION_CANONICAL_APPLICATION_REQUIRED');return owner;
}
export function assertOnlineApplicationRealtimeOwner(application:unknown,runtime:OnlineComposedRuntime){
  assertOnlineComposedRuntime(runtime,'http');
  const owner=application&&typeof application==='object'?onlineRealtimeApplications.get(application):undefined;
  if(!owner||owner.runtime!==runtime)throw Error('REALTIME_CANONICAL_APPLICATION_REQUIRED');
  return owner;
}



/** Construct the canonical HTTP/Socket.IO application without starting a
 * listener, recovery, schedulers or process signal handlers. Private native
 * entries must bind the platform ownership BEFORE importing this module.
 * runtimeRole retains the ordinary candidate admission restrictions. */
export function createApplication({ runtimeRole, isShuttingDown }: {
  runtimeRole: BackendRuntimeRole;
  isShuttingDown: () => boolean;
}) {
  return createHttpApplication({ runtimeRole: resolveRuntimeRole(runtimeRole), isShuttingDown });
}

/** The original admitted composition is the only online constructor input.
 * No string role, manifest, environment flag or caller callback can mint it. */
export function createOnlineApplication({ runtime, isShuttingDown }: {
  runtime: OnlineComposedRuntime;
  isShuttingDown: () => boolean;
}) {
  const composed=assertOnlineComposedRuntime(runtime, 'http');
  const application=createHttpApplication({ runtimeRole: 'serving', isShuttingDown,
    assertAdmission: () => { assertOnlineComposedRuntime(runtime, 'http'); },
    restrictToReadiness:()=>onlineRealtimeSuspendedForProtectedBootstrap(composed.admission) });
  configureOnlineHrInvalidation(runtime,prisma);
  onlineRealtimeApplications.set(application,Object.freeze({runtime,database:prisma,lifecycle:application.realtimeDelivery}));
  return application;
}

/** Canonical implementation, distinct opaque qualification wrapper. */
export function createPrivateQualificationApplication({runtime,isShuttingDown}:{runtime:OnlineQualifiedRuntime;isShuttingDown:()=>boolean}){
 assertOnlineQualifiedRuntime(runtime,'http');
 const application=createHttpApplication({runtimeRole:'private-qualification',isShuttingDown,
  assertAdmission:()=>{assertOnlineQualifiedRuntime(runtime,'http');}});
 configurePrivateQualificationHrInvalidation(runtime,prisma);
 privateQualificationApplications.set(application,Object.freeze({runtime,database:prisma,lifecycle:application.realtimeDelivery}));
 return application;
}

function createHttpApplication({ runtimeRole, isShuttingDown, assertAdmission,restrictToReadiness }: {
  runtimeRole: BackendRuntimeRole | 'serving' | 'private-qualification';
  isShuttingDown: () => boolean;
  assertAdmission?: () => void;
  restrictToReadiness?:()=>boolean;
}) {
  assertAdmission?.();
  if (applicationConstructed) throw new Error('APPLICATION_ALREADY_CONSTRUCTED');
  // HTTP completion and realtime publication are process-owned singletons.
  // Failed construction also closes this incarnation; there is no reset path.
  applicationConstructed = true;
  let externalAdmissionClosed=false;
  const closeExternalAdmission=()=>{externalAdmissionClosed=true;};
  registerPartnerNotificationAccess(inquiryNotificationAccess);
  const app = express();
  app.set("trust proxy", 1);
  const server = createServer(app);
  const isProduction = process.env.NODE_ENV === "production";
  const configuredFrontendUrl = process.env.FRONTEND_URL;

  validateProductionEnvironment();
  const hrRedesignCutoverStartup = isProduction
    ? resolveHrRedesignCutoverStartup(process.env)
    : { enabled: false, acceptancePath: null, sourceRevision: null };

  const allowedOrigins = (configuredFrontendUrl || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const resolveCorsOrigin = () => {
    if (!isProduction) {
      return configuredFrontendUrl || "http://localhost:3000";
    }
    return allowedOrigins;
  };

  const io = new Server(server, {
    cors: {
      origin: resolveCorsOrigin(),
      methods: ["GET", "POST"],
      credentials: true,
    },
  });
  const accepting = () => {
    if (isShuttingDown() || runtimeRole === 'candidate' || getRecoveryRuntimeState().mode !== 'NORMAL'
      || deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) return false;
    try { assertAdmission?.(); return true; } catch { return false; }
  };
  const realtimeDelivery = new RealtimeDeliveryLifecycle(prisma, () => io.sockets.sockets.values(), async userId => {
    const authorization = await authorizeHrUser(prisma, userId, {
      workspaceLevel: 'VIEW', feature: { code: 'PERSONNEL', level: 'VIEW' },
    });
    return authorization.allowed;
  }, accepting, executeRealtimeCallback);

  if (assertAdmission) io.engine.use((request, _response, next) => {
    // Keep existing Engine.IO connections while admitted callbacks finish.
    const continuing=!!new URL(request.url||'/', 'http://private.invalid').searchParams.get('sid');
    if ((!continuing&&externalAdmissionClosed)||!accepting()) { next(new Error('ONLINE_RUNTIME_NOT_ACCEPTING')); return; }
    next();
  });

  // Middleware
  app.use(helmet());
  app.use((req, res, next) => {
    if (assertAdmission) {
      try { assertAdmission(); } catch {
        res.status(503).json({ success: false, error: 'ONLINE_RELEASE_ADMISSION_UNPROVEN',
          message: 'این نسخه فعلاً آمادهٔ پاسخ‌گویی نیست؛ کمی بعد دوباره تلاش کنید.' });
        return;
      }
    }
    const probe = req.path === '/api/health' || req.path === '/api/ready';
    // Protected bootstrap exposes only read-only startup probes. In particular
    // it cannot inherit System Recovery/logout maintenance exceptions.
    if(restrictToReadiness?.()&&!protectedBootstrapReadinessProbe(req.method,req.path)){
      res.status(503).json({success:false,error:'ONLINE_PROTECTED_BOOTSTRAP_PRIVATE'});return;
    }
    if (!probe && (externalAdmissionClosed || isShuttingDown() || runtimeRole === 'candidate')) {
      res.status(503).json({ success: false, error: externalAdmissionClosed || isShuttingDown() ? 'RUNTIME_DRAINING' : 'CANDIDATE_NOT_ACTIVE',
        message: 'سامانه در حال آماده‌سازی نسخه است؛ کمی بعد دوباره تلاش کنید.' });
      return;
    }
    next();
  });
  app.use(runtimeHttpRequests.middleware);
  app.use(
    cors({
      origin: resolveCorsOrigin(),
      credentials: true,
    }),
  );
  app.use(morgan("combined"));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(normalizeStructuredNumeralsMiddleware);
  app.use(recoveryWriteGuard);

  // Routes
  app.use("/api/system-recovery", systemRecoveryRoutes);
  app.use("/api/auth", authRoutes);
  app.use("/api/notifications", notificationRoutes);
  app.use("/api/support-tickets", supportTicketRoutes);
  app.use("/api/dispatch-master-data", dispatchMasterDataRoutes);
  app.use("/api/biometric-connector", biometricConnectorRoutes);
  app.use("/api/dispatch-confirmation", dispatchConfirmationRoutes);
  app.use("/api/shipment-quantities", shipmentQuantityRoutes);
  app.use("/api/dispatch-cases", dispatchCaseRoutes);
  app.use("/api/dispatch-cutover", dispatchCutoverRoutes);
  app.use("/api/shipment-statement-operations", shipmentStatementOperationsRoutes);
  app.use("/api/partner/technical", partnerTechnicalRoutes);
  app.use("/api/partner/management/technical-policy", partnerTechnicalPolicyRoutes);
  app.use("/api/partner/inquiries", partnerInquiryRoutes);
  app.use("/api/partner/management", partnerManagementRoutes);
  app.use("/api/partner/workspaces", partnerWorkspaceRoutes);
  app.use("/api/partner/cases", partnerCaseRoutes);
  app.use("/api/partner/retail-collections", partnerRetailCollectionRoutes);
  app.use("/api/partner/fulfillment", partnerFulfillmentRoutes);
  app.use("/api/partner/corrections", partnerCorrectionRoutes);
  app.use("/api/partner/accounting", partnerAccountingRoutes);
  app.use("/api/partner/reports", partnerReportRoutes);
  app.use("/api/partner/operations", partnerOperationsRoutes);
  app.use("/api/partner/activation", partnerActivationRoutes);
  app.use("/api/users", userRoutes);
  app.use("/api/posts", postRoutes);
  app.use("/api/orders", orderRoutes);
  app.use("/api/contracts", contractRoutes);
  app.use("/api/contract-templates", contractTemplateRoutes);
  app.use("/api/customers", customerRoutes);
  app.use("/api/departments", departmentRoutes);
  app.use("/api/personnel", personnelRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/personal", personalRoutes);
  app.use("/api/sabalan-calendar", sabalanCalendarRoutes);

  // Workspace-specific routes
  app.use("/api/attendance-device", attendanceDeviceRoutes);
app.use("/api/security", securityRoutes);

  // Workspace-specific routes
  if (!isProduction) console.log("? Registering workspace routes...");
  app.use("/api/sales", salesRoutes);
  app.use("/api/dispatch-credit", dispatchCreditRoutes);
  app.use("/api/crm", crmRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/accounting", accountingRoutes);
  app.use("/api/bi", biRoutes);
  app.use("/api/logistics", logisticsRoutes);
  app.use("/api/hr", hrRoutes);
  app.use("/api/hr-duties", crossWorkspaceDutyRoutes);
  app.use("/api/duties", crossWorkspaceDutyRoutes);
  app.use("/api/hr-hiring", hrApplicantExperienceRoutes);
  app.use("/api/hr-hiring", hrHiringRoutes);
  app.use("/api/workspace-permissions", workspacePermissionsRoutes);
  app.use("/api/permissions", permissionsRoutes);
  app.use("/api/catalog-excel", catalogExcelRoutes);
  if (!isProduction) console.log("? Registering products routes...");
  app.use("/api/products", productsRoutes);
  if (!isProduction) console.log("? Registering services routes...");
  app.use("/api/services", servicesRoutes);
  if (!isProduction) console.log("? Registering cutting types routes...");
  app.use("/api/cutting-types", cuttingTypesRoutes);
  if (!isProduction) console.log("? Registering sub-services routes...");
  app.use("/api/sub-services", subServicesRoutes);
  if (!isProduction) console.log("? Registering stair standard length routes...");
  app.use("/api/stair-standard-lengths", stairStandardLengthRoutes);
  if (!isProduction) console.log("? Registering layer type routes...");
  app.use("/api/layer-types", layerTypesRoutes);
  if (!isProduction) console.log("? Registering stone finishing routes...");
  app.use("/api/stone-finishings", stoneFinishingRoutes);
  app.use("/api/uploads", uploadsRoutes);
  app.use("/api/public", publicContractsRoutes);
  if (process.env.NODE_ENV === "test" && process.env.HR_HIRING_E2E === "true") {
    app.use("/api/test/hr-hiring-sms", testHrHiringSmsRoutes);
  }
  if (!isProduction) console.log("? All routes registered successfully");

  // Static files for generated PDFs (contracts)
  app.use(
    "/files/contracts",
    express.static(path.join(process.cwd(), "storage", "contracts"), {
      etag: false,
      maxAge: "0",
      setHeaders: (res) => {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      },
    }),
  );

  app.use(
    "/files/accounting-contracts",
    express.static(path.join(process.cwd(), "storage", "accounting-contracts"), {
      dotfiles: "deny",
      etag: false,
      maxAge: "0",
      setHeaders: (res) => {
        res.setHeader(
          "Cache-Control",
          "no-store, no-cache, must-revalidate, proxy-revalidate",
        );
        res.setHeader("Pragma", "no-cache");
        res.setHeader("Expires", "0");
        res.setHeader("Surrogate-Control", "no-store");
      },
    }),
  );

  app.use(
    "/files/uploads/images",
    express.static(path.join(process.cwd(), "uploads", "images"), {
      etag: false,
      maxAge: "1h",
    }),
  );

  app.get("/favicon.ico", (_req, res) => {
    res.status(204).end();
  });

  // Health check
  app.get("/api/health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({
        status: "OK",
        database: "OK",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    } catch (error) {
      res.status(503).json({
        status: "DEGRADED",
        database: "DOWN",
        timestamp: new Date().toISOString(),
      });
    }
  });

  app.get("/api/ready", async (req, res) => {
    if (externalAdmissionClosed || isShuttingDown()) {
      res.status(503).json({ ready: false, reason: "SHUTTING_DOWN" });
      return;
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ready: true, runtimeRole });
    } catch (error) {
      res.status(503).json({ ready: false });
    }
  });

  // Socket.io connections use the same authoritative, revocable session cookie as HTTP.
  io.use(async (socket, next) => {
    if (externalAdmissionClosed || !accepting()) return next(new Error('Runtime is not accepting connections'));
    try {
      await realtimeDelivery.authenticate(socket);
      if (!accepting()) { socket.disconnect(true); return next(new Error('Runtime is draining')); }
      next();
    } catch {
      next(new Error("Authentication required"));
    }
  });

  // Socket.io connection handling
  io.on("connection", (socket) => {
    if (!isProduction) console.log("User connected:", socket.id);
    socket.join(`user-${socket.data.userId}`);

    socket.on("disconnect", () => {
      if (!isProduction) console.log("User disconnected:", socket.id);
    });
  });

  registerRealtimePublisher((event) => {
    void realtimeDelivery.invalidate(event).catch(() => console.error('REALTIME_INVALIDATION_FAILED'));
  });

  // Error handling middleware
  app.use(notFound);
  app.use(errorHandler);
  runtimeHttpRequests.install(app);

  return { app, server, io, realtimeDelivery, hrRedesignCutoverStartup, closeExternalAdmission };
}
