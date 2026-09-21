import { disconnectDatabase, prisma } from './lib/prisma';
import { validateProductionEnvironment } from './services/productionEnvironment';
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";
import path from "path";
import { readFile } from "fs/promises";
import { createServer } from "http";
import { Server } from "socket.io";
import { registerRealtimePublisher } from "./services/realtimePublisher";
import { authorizeHrUser } from "./services/hrAuthorizationService";
import {
  parseCookies,
  resolveAuthoritativeSession,
  SESSION_COOKIE,
} from "./services/identitySessionService";
import { normalizeStructuredNumeralsMiddleware } from './middleware/normalizeStructuredNumerals';

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
import sabalanCalendarRoutes from "./routes/sabalan-calendar";

// Import workspace routes
import salesRoutes from "./routes/sales";
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

// Import middleware
import { errorHandler } from "./middleware/errorHandler";
import { notFound } from "./middleware/notFound";
import { startAuthenticationRetentionCleanup } from "./services/authenticationRetentionService";
import { startHiringInvitationDeliveryPolling } from "./services/hrHiringDeliveryPollingService";
import { startPersonnelErasureRecovery } from "./services/hrPersonnelErasureRecovery";
import {
  getRecoveryRuntimeState,
  initializeRecoveryRuntime,
  recoveryWriteGuard,
} from "./services/recoveryRuntime";
import {
  initializeSystemRecovery,
  startSystemRecoveryMaintenance,
} from "./services/systemRecoveryLifecycle";
import { startNotificationOutboxDelivery } from "./services/notificationService";
import { startSupportTicketMaintenance } from "./services/supportTicketMaintenance";
import { startDispatchBuyerSmsDelivery } from "./services/dispatchBuyerSmsWorker";
import { startCrossWorkspaceDutyDeadlineMaintenance } from "./services/crossWorkspaceDutyModule";
import { registerPartnerNotificationAccess } from "./services/partnerSales/notifications/access";
import { inquiryNotificationAccess, startPartnerInquiryNotificationDelivery } from "./services/partnerSales/notifications/inquiryDelivery";
import { verifyHrRedesignCutover } from "./services/hrRedesignCutover";
import { resolveHrRedesignCutoverStartup } from "./services/hrRedesignCutoverStartup";
import { startPersonnelPerformanceMaintenance } from "./services/personnelPerformanceMaintenance";

initializeRecoveryRuntime();
registerPartnerNotificationAccess(inquiryNotificationAccess);
const app = express();
app.set("trust proxy", 1);
const server = createServer(app);
let isShuttingDown = false;
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

const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
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
app.use("/api/security", securityRoutes);

// Workspace-specific routes
if (!isProduction) console.log("? Registering workspace routes...");
app.use("/api/sales", salesRoutes);
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
  if (isShuttingDown) {
    res.status(503).json({ ready: false, reason: "SHUTTING_DOWN" });
    return;
  }
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
    if (!token) return next(new Error("Authentication required"));
    const session = await resolveAuthoritativeSession(prisma, token);
    if (!session) return next(new Error("Authentication required"));
    socket.data.userId = session.userId;
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
  for (const socket of io.sockets.sockets.values()) {
    void authorizeHrUser(prisma, socket.data.userId, {
      workspaceLevel: "VIEW",
      feature: { code: "PERSONNEL", level: "VIEW" },
    }).then((authorization) => {
      if (authorization.allowed) socket.emit(event, {});
    }).catch(() => undefined);
  }
});

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start only after interrupted recovery has been finalized or safely rolled back.
initializeSystemRecovery(prisma).then(async () => {
  if (hrRedesignCutoverStartup.enabled) {
    const acceptanceAttestation = JSON.parse(await readFile(hrRedesignCutoverStartup.acceptancePath!, "utf8")) as unknown;
    await verifyHrRedesignCutover(prisma, {
      acceptanceAttestation,
      sourceRevision: hrRedesignCutoverStartup.sourceRevision!,
    });
  }
  if (getRecoveryRuntimeState().mode === "NORMAL") {
    startAuthenticationRetentionCleanup(prisma);
    startHiringInvitationDeliveryPolling(prisma);
    startPersonnelErasureRecovery(prisma);
    startSystemRecoveryMaintenance(prisma);
    startNotificationOutboxDelivery(prisma, (userId, notification) => {
      io.to(`user-${userId}`).emit("notification.created", notification);
    });
    startSupportTicketMaintenance(prisma);
    startDispatchBuyerSmsDelivery(prisma);
    startCrossWorkspaceDutyDeadlineMaintenance(prisma);
    startPersonnelPerformanceMaintenance(prisma);
    startPartnerInquiryNotificationDelivery(prisma);
  }
  server.listen(PORT, () => {
    console.log(`? Server running on port ${PORT}`);
    console.log(`? Health check: http://localhost:${PORT}/api/health`);
  });
}).catch((error) => {
  console.error("Backend startup blocked:", error);
  process.exitCode = 1;
});

const shutdown = async (signal: NodeJS.Signals) => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`Received ${signal}; draining connections before shutdown.`);

  const forcedExit = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 25_000);
  forcedExit.unref();

  try {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        io.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await disconnectDatabase();
    clearTimeout(forcedExit);
    process.exit(0);
  } catch (error) {
    console.error("Graceful shutdown failed:", error);
    process.exit(1);
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

export { io };
