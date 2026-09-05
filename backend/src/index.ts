import { disconnectDatabase, prisma } from './lib/prisma';
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
import { validatePerformanceVaultEnvironment } from "./services/personnelPerformancePayloadStore";
import { startPersonnelPerformanceMaintenance } from "./services/personnelPerformanceMaintenance";

initializeRecoveryRuntime();
registerPartnerNotificationAccess(inquiryNotificationAccess);
const app = express();
app.set("trust proxy", 1);
const server = createServer(app);
let isShuttingDown = false;
const isProduction = process.env.NODE_ENV === "production";
const configuredFrontendUrl = process.env.FRONTEND_URL;

const validateProductionEnvironment = () => {
  if (!isProduction) return;

  const jwtSecret = process.env.JWT_SECRET || "";
  const hasWeakJwtSecret =
    jwtSecret.length < 32 || jwtSecret.includes("your-super-secret");
  const requiredVars = [
    "DATABASE_URL",
    "JWT_SECRET",
    "FRONTEND_URL",
    "PUBLIC_APP_URL",
    "WEB_PUSH_VAPID_SUBJECT",
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "SMS_IR_API_KEY",
    "SMS_IR_HIRING_INVITATION_TEMPLATE_ID",
    "SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS",
    "SMS_IR_HIRING_CORRECTION_TEMPLATE_ID",
    "SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS",
    "SMS_IR_HIRING_OFFER_TEMPLATE_ID",
    "SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS",
    "SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID",
    "SMS_IR_DISPATCH_EXIT_TEMPLATE_ID",
    "SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID",
    "PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID",
    "PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64",
  ];
  const missingVars = requiredVars.filter((key) => !process.env[key]);
  const hiringTemplateId =
    process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_ID || "";
  const hasInvalidHiringTemplate =
    hiringTemplateId !== "343360" ||
    process.env.SMS_IR_HIRING_CORRECTION_TEMPLATE_ID !== "763918" ||
    process.env.SMS_IR_HIRING_OFFER_TEMPLATE_ID !== "894291";
  const hiringTemplateParameters = (
    process.env.SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS || ""
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const hasInvalidHiringTemplateParameters =
    hiringTemplateParameters.length !== 1 ||
    hiringTemplateParameters[0] !== "CODE";
  const correctionTemplateParameters = (process.env.SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const offerTemplateParameters = (process.env.SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS || '').split(',').map((value) => value.trim()).filter(Boolean);
  const hasInvalidHiringCorrectionParameters = correctionTemplateParameters.join(',') !== 'DETAILS,CODE';
  const hasInvalidHiringOfferParameters = offerTemplateParameters.join(',') !== 'CODE';
  const hasInvalidSmsEnvironment =
    process.env.SMS_IR_ENVIRONMENT !== "production";
  const dispatchTemplateIds = [
    process.env.SMS_IR_DISPATCH_CONFIRM_OTP_TEMPLATE_ID || "",
    process.env.SMS_IR_DISPATCH_EXIT_TEMPLATE_ID || "",
    process.env.SMS_IR_DISPATCH_EXIT_MANUAL_RETRY_TEMPLATE_ID || "",
  ];
  const hasInvalidDispatchTemplates =
    dispatchTemplateIds.some((value) => !/^\d+$/.test(value) || Number(value) <= 0) ||
    new Set(dispatchTemplateIds).size !== dispatchTemplateIds.length;
  let hasInvalidPublicAppUrl = false;
  try {
    const publicAppUrl = new URL(process.env.PUBLIC_APP_URL || "");
    hasInvalidPublicAppUrl = publicAppUrl.protocol !== "https:";
  } catch {
    hasInvalidPublicAppUrl = true;
  }
  let hasInvalidPerformanceVault = false;
  try {
    validatePerformanceVaultEnvironment(process.env);
  } catch {
    hasInvalidPerformanceVault = true;
  }

  if (
    missingVars.length > 0 ||
    hasWeakJwtSecret ||
    hasInvalidHiringTemplate ||
    hasInvalidHiringTemplateParameters ||
    hasInvalidHiringCorrectionParameters ||
    hasInvalidHiringOfferParameters ||
    hasInvalidSmsEnvironment ||
    hasInvalidDispatchTemplates ||
    hasInvalidPublicAppUrl ||
    hasInvalidPerformanceVault
  ) {
    const details = [
      missingVars.length > 0 ? `Missing vars: ${missingVars.join(", ")}` : "",
      hasWeakJwtSecret
        ? "JWT_SECRET must be at least 32 chars and not a placeholder."
        : "",
      hasInvalidHiringTemplate
        ? "Hiring SMS template IDs must be exactly invitation=343360, correction=763918, offer=894291."
        : "",
      hasInvalidHiringTemplateParameters
        ? "SMS_IR_HIRING_INVITATION_TEMPLATE_PARAMETERS must be exactly CODE."
        : "",
      hasInvalidHiringCorrectionParameters
        ? "SMS_IR_HIRING_CORRECTION_TEMPLATE_PARAMETERS must be exactly DETAILS,CODE."
        : "",
      hasInvalidHiringOfferParameters
        ? "SMS_IR_HIRING_OFFER_TEMPLATE_PARAMETERS must be exactly CODE."
        : "",
      hasInvalidSmsEnvironment ? "SMS_IR_ENVIRONMENT must be production." : "",
      hasInvalidDispatchTemplates
        ? "Dispatch SMS template IDs must be distinct approved positive numeric values."
        : "",
      hasInvalidPublicAppUrl
        ? "PUBLIC_APP_URL must be a valid HTTPS origin used for the fixed applicant entry page."
        : "",
      hasInvalidPerformanceVault
        ? "Personnel performance encryption key id and exact 32-byte base64 key must be production-ready."
        : "",
    ].filter(Boolean);
    throw new Error(`Invalid production environment. ${details.join(" ")}`);
  }
};

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
    startPartnerInquiryNotificationDelivery(prisma);
    startPersonnelPerformanceMaintenance(prisma);
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
