"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// backend/src/services/deploymentGates.ts
function completeProtectedPrivateQualificationPrerequisite(value, expected) {
  const row = value;
  return !!row && typeof row === "object" && !Array.isArray(row) && Object.keys(row).length === 6 && ["format", "releaseId", "manifestSha256", "qualificationCheckpointSha256", "publicTrafficQualified", "qualificationReports"].every((key) => Object.prototype.hasOwnProperty.call(row, key)) && row.format === "sabalan-protected-private-qualification-prerequisite/v1" && row.publicTrafficQualified === false && row.releaseId === expected.releaseId && row.manifestSha256 === expected.manifestSha256 && row.qualificationCheckpointSha256 === expected.qualificationCheckpointSha256 && /^[a-f0-9]{64}$/.test(row.qualificationCheckpointSha256) && row.qualificationReports && typeof row.qualificationReports === "object" && !Array.isArray(row.qualificationReports) && Object.keys(row.qualificationReports).length === 5 && Object.keys(expected.qualificationReports).length === 5 && ["compatible-migrations", "coherent-independent-restore", "browser-24-hours", "single-worker-and-completion", "current-domain"].every((scope) => Object.prototype.hasOwnProperty.call(row.qualificationReports, scope) && /^[a-f0-9]{64}$/.test(row.qualificationReports[scope]) && row.qualificationReports[scope] === expected.qualificationReports[scope]);
}
function completeOnlinePrivateQualificationPrerequisite(value, expected) {
  const row = value;
  if (!row || typeof row !== "object" || Array.isArray(row) || Object.keys(row).sort().join(",") !== ["format", "releaseId", "manifestSha256", "checkpointSha256", "captureId", "publicTrafficQualified", "qualificationReports"].sort().join(",")) return false;
  if (row.format !== "sabalan-online-private-qualification-prerequisite/v1" || row.publicTrafficQualified !== false || row.checkpointSha256 !== expected.checkpointSha256 || row.captureId !== expected.captureId || !/^[a-f0-9]{64}$/.test(row.checkpointSha256) || !/^[a-f0-9]{64}$/.test(row.captureId)) return false;
  return completeProtectedPrivateQualificationPrerequisite(
    {
      format: "sabalan-protected-private-qualification-prerequisite/v1",
      releaseId: row.releaseId,
      manifestSha256: row.manifestSha256,
      qualificationCheckpointSha256: row.checkpointSha256,
      publicTrafficQualified: row.publicTrafficQualified,
      qualificationReports: row.qualificationReports
    },
    { ...expected, qualificationCheckpointSha256: expected.checkpointSha256 }
  );
}
var init_deploymentGates = __esm({
  "backend/src/services/deploymentGates.ts"() {
    "use strict";
  }
});

// backend/src/services/onlineCheckpointDirectory.ts
var init_onlineCheckpointDirectory = __esm({
  "backend/src/services/onlineCheckpointDirectory.ts"() {
    "use strict";
  }
});

// backend/src/services/deploymentCheckpointPolicy.ts
var hasHealthyIndependentCheckpointDrill;
var init_deploymentCheckpointPolicy = __esm({
  "backend/src/services/deploymentCheckpointPolicy.ts"() {
    "use strict";
    init_onlineCheckpointDirectory();
    hasHealthyIndependentCheckpointDrill = (artifact) => {
      const drill = artifact.lastDrill;
      const digest5 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
      if (!drill || drill.format !== "sabalan-independent-checkpoint-drill/v1" || drill.status !== "HEALTHY" || drill.phase !== "COMPLETE" || drill.packageType !== "COMPLETE" || drill.checkpointId !== artifact.id || drill.releaseId !== artifact.releaseId || !digest5(artifact.checksum) || drill.checksum !== artifact.checksum || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || drill.size !== artifact.size || !digest5(artifact.sourceMachineUuidSha256) || drill.sourceMachineUuidSha256 !== artifact.sourceMachineUuidSha256 || !digest5(drill.recoveryMachineUuidSha256) || drill.recoveryMachineUuidSha256 === drill.sourceMachineUuidSha256 || !digest5(artifact.sourceKernelBootIdSha256) || drill.sourceKernelBootIdSha256 !== artifact.sourceKernelBootIdSha256 || !digest5(drill.recoveryKernelBootIdSha256) || drill.recoveryKernelBootIdSha256 === drill.sourceKernelBootIdSha256 || typeof drill.operationId !== "string" || !drill.operationId.startsWith(`drill-${artifact.id}-`) || !/^\d+$/.test(drill.operationId.slice(`drill-${artifact.id}-`.length)) || !drill.startedAt || !drill.completedAt || !Number.isFinite(Date.parse(drill.startedAt)) || !Number.isFinite(Date.parse(drill.completedAt)) || Date.parse(drill.completedAt) < Date.parse(drill.startedAt)) return false;
      return drill.stagedPostgresRestore === true && drill.stagedSqliteIntegrity === true && drill.verifiedFiles === true && drill.verifiedApplicationPayloads === true && drill.verifiedBusinessData === true;
    };
  }
});

// backend/src/services/onlineReleaseSupportWindow.ts
function snapshotOnlineSupportWindow(row) {
  const validDate = (value) => value instanceof Date && Number.isFinite(value.getTime());
  const fail9 = () => {
    throw new Error("ONLINE_RELEASE_SUPPORT_WINDOW_UNPROVEN");
  };
  if (!validDate(row.now) || !["READY", "SERVING", "RETAINED"].includes(String(row.phase))) return fail9();
  if (row.phase === "RETAINED") {
    if (!validDate(row.retiredAt) || !validDate(row.browserSupportUntil) || row.retiredAt.getTime() > row.now.getTime() || row.browserSupportUntil.getTime() < row.retiredAt.getTime() + 864e5 || row.browserSupportUntil.getTime() <= row.now.getTime()) fail9();
  } else if (row.retiredAt !== null || row.browserSupportUntil !== null) fail9();
  return Object.freeze({
    phase: row.phase,
    observedDatabaseAt: row.now.toISOString(),
    retiredAt: row.retiredAt instanceof Date ? row.retiredAt.toISOString() : null,
    browserSupportUntil: row.browserSupportUntil instanceof Date ? row.browserSupportUntil.toISOString() : null
  });
}
var init_onlineReleaseSupportWindow = __esm({
  "backend/src/services/onlineReleaseSupportWindow.ts"() {
    "use strict";
  }
});

// backend/src/services/deploymentMaintenance.ts
var import_node_fs, import_node_path, DEPLOYMENT_MAINTENANCE_FILE, maintenancePath, deploymentMaintenanceActive;
var init_deploymentMaintenance = __esm({
  "backend/src/services/deploymentMaintenance.ts"() {
    "use strict";
    import_node_fs = __toESM(require("node:fs"));
    import_node_path = __toESM(require("node:path"));
    DEPLOYMENT_MAINTENANCE_FILE = "deployment-maintenance.json";
    maintenancePath = (coordinationDir) => import_node_path.default.join(coordinationDir, DEPLOYMENT_MAINTENANCE_FILE);
    deploymentMaintenanceActive = (coordinationDir) => {
      try {
        import_node_fs.default.lstatSync(maintenancePath(coordinationDir));
        return true;
      } catch (error) {
        return error?.code !== "ENOENT";
      }
    };
  }
});

// backend/src/services/httpRequestLifecycle.ts
var HttpRequestLifecycle, runtimeWriteAdmission, bindRuntimeHttpWriteAdmission, runtimeHttpRequests;
var init_httpRequestLifecycle = __esm({
  "backend/src/services/httpRequestLifecycle.ts"() {
    "use strict";
    HttpRequestLifecycle = class {
      constructor(canAdmitWrite = () => true, acquireOwnership) {
        this.canAdmitWrite = canAdmitWrite;
        this.acquireOwnership = acquireOwnership;
        this.active = /* @__PURE__ */ new Set();
        this.observedRequest = false;
        this.requests = /* @__PURE__ */ new WeakMap();
        this.installed = /* @__PURE__ */ new WeakSet();
        this.middleware = (req, res, next) => {
          this.observedRequest = true;
          const pathname = req.originalUrl.split("?")[0];
          if (pathname === "/api/health" || pathname === "/api/ready") return next();
          const work = {
            responseDone: false,
            mutation: !["GET", "HEAD", "OPTIONS"].includes(req.method),
            writeAdmitted: this.canAdmitWrite(),
            writes: 0,
            handlers: /* @__PURE__ */ new Set(),
            onFinish: /* @__PURE__ */ new Set()
          };
          this.requests.set(req, work);
          this.active.add(work);
          const done = () => {
            work.responseDone = true;
            this.releaseIfDone(work);
          };
          res.once("finish", () => {
            work.responseDone = true;
            for (const callback of [...work.onFinish]) callback();
            this.releaseIfDone(work);
          });
          res.once("close", done);
          if (!this.acquireOwnership) return next();
          const admission = Symbol();
          work.handlers.add(admission);
          void Promise.resolve().then(() => this.acquireOwnership(req)).then((ownership) => {
            work.ownership = ownership;
            if (!req.aborted && !res.destroyed) {
              if (ownership.run) ownership.run(() => next());
              else next();
            }
          }, next).then(() => {
            work.handlers.delete(admission);
            this.releaseIfDone(work);
          }, (error) => {
            try {
              next(error);
            } finally {
              work.handlers.delete(admission);
              this.releaseIfDone(work);
            }
          });
        };
      }
      assertBeforeFirstRequest() {
        if (this.observedRequest) throw new Error("HTTP_OWNERSHIP_ALREADY_OBSERVED");
      }
      /** Bind the same lifecycle already captured by uploads/audit routes.
       * Binding is startup-only and cannot replace ownership or promote a runtime
       * after even a probe has been served. There is no unbind/reset path. */
      bindOwnership(acquire) {
        if (this.acquireOwnership) throw new Error("HTTP_OWNERSHIP_ALREADY_BOUND");
        this.assertBeforeFirstRequest();
        if (typeof acquire !== "function") throw new Error("HTTP_OWNERSHIP_BINDING_INVALID");
        this.acquireOwnership = acquire;
      }
      releaseIfDone(work) {
        if (!work.responseDone || work.handlers.size !== 0 || work.releasing || work.ownershipFailed) return;
        if (!work.ownership) {
          this.active.delete(work);
          return;
        }
        work.releasing = true;
        void Promise.resolve().then(() => work.ownership.release()).then(() => {
          this.active.delete(work);
        }, () => {
          work.ownershipFailed = true;
        });
      }
      /** Reserve future response-event writes when registering the event, before
       * recovery can close admission and observe an apparently drained GET. */
      reserveWrite(req) {
        const work = this.requests.get(req);
        if (!work) return { run: async (execute) => execute(), cancel: () => {
        } };
        if (!(work.mutation && work.writeAdmitted) && !this.canAdmitWrite()) {
          throw Object.assign(new Error("\u0633\u0627\u0645\u0627\u0646\u0647 \u062F\u0631 \u062D\u0627\u0644 \u062A\u0647\u06CC\u0647\u0654 \u067E\u0634\u062A\u06CC\u0628\u0627\u0646 \u0627\u0633\u062A\u061B \u06A9\u0645\u06CC \u0628\u0639\u062F \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F."), {
            code: "RECOVERY_WRITE_ADMISSION_CLOSED",
            status: 503,
            statusCode: 503,
            isOperational: true
          });
        }
        const ownedCallback = work.ownership?.reserve?.();
        const token = Symbol();
        work.handlers.add(token);
        work.writes += 1;
        this.active.add(work);
        let consumed = false;
        const release = () => {
          work.writes -= 1;
          work.handlers.delete(token);
          ownedCallback?.release();
          this.releaseIfDone(work);
        };
        return {
          run: async (execute) => {
            if (consumed) throw new Error("HTTP_WRITE_RESERVATION_CONSUMED");
            consumed = true;
            try {
              return await (ownedCallback ? ownedCallback.run(execute) : work.ownership?.run ? work.ownership.run(execute) : execute());
            } finally {
              release();
            }
          },
          cancel: () => {
            if (!consumed) {
              consumed = true;
              release();
            }
          }
        };
      }
      async trackWork(req, run) {
        return this.reserveWrite(req).run(run);
      }
      invoke(handler, receiver, parameters, req, res, next) {
        const work = this.requests.get(req);
        if (!work) {
          try {
            const result = handler.apply(receiver, [...parameters, next]);
            return result !== null && result !== void 0 && typeof result.then === "function" ? Promise.resolve(result).catch(next) : result;
          } catch (error) {
            next(error);
            return;
          }
        }
        const token = Symbol();
        work.handlers.add(token);
        let returned = false;
        let promise = false;
        let advanced = false;
        const release = () => {
          work.onFinish.delete(onFinish);
          work.handlers.delete(token);
          this.releaseIfDone(work);
        };
        const onFinish = () => {
          if (returned && !promise) release();
        };
        work.onFinish.add(onFinish);
        const proceed = (error) => {
          advanced = true;
          try {
            next(error);
          } finally {
            if (returned && !promise) release();
          }
        };
        try {
          const execute = () => handler.apply(receiver, [...parameters, proceed]);
          const result = work.ownership?.run ? work.ownership.run(execute) : execute();
          returned = true;
          promise = result !== null && result !== void 0 && typeof result.then === "function";
          if (promise) {
            return Promise.resolve(result).then(release, (error) => {
              try {
                next(error);
              } finally {
                release();
              }
            });
          }
          if (advanced || res.writableEnded) release();
          return result;
        } catch (error) {
          try {
            next(error);
          } finally {
            release();
          }
        }
      }
      /** Call after all routes/error middleware are registered, before listen. */
      install(application) {
        if (!Array.isArray(application._router?.stack)) {
          throw new Error("HTTP_ROUTER_LAYOUT_UNSUPPORTED");
        }
        const visit = (router) => {
          for (const layer of router._router?.stack || router.stack || []) {
            if (this.installed.has(layer)) continue;
            this.installed.add(layer);
            if (layer.route) {
              visit(layer.route);
              continue;
            }
            if (layer.handle.stack) {
              visit(layer.handle);
              continue;
            }
            const owner = this;
            const handler = layer.handle;
            if (handler.length > 4) continue;
            layer.handle = handler.length === 4 ? function(error, req, res, next) {
              return owner.invoke(handler, this, [error, req, res], req, res, next);
            } : function(req, res, next) {
              return owner.invoke(handler, this, [req, res], req, res, next);
            };
          }
        };
        visit(application);
      }
      async wait(timeoutMs, writesOnly) {
        const deadline = Date.now() + timeoutMs;
        const pending2 = () => [...this.active].some((work) => !writesOnly || work.mutation || work.writes > 0);
        while (pending2() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
        if (pending2()) throw new Error("HTTP_REQUEST_DRAIN_TIMEOUT");
      }
      waitForDrain(timeoutMs) {
        return this.wait(timeoutMs, false);
      }
      waitForWriteDrain(timeoutMs) {
        return this.wait(timeoutMs, true);
      }
    };
    bindRuntimeHttpWriteAdmission = (admission) => {
      if (runtimeWriteAdmission) throw new Error("HTTP_WRITE_ADMISSION_ALREADY_BOUND");
      runtimeWriteAdmission = admission;
    };
    runtimeHttpRequests = new HttpRequestLifecycle(() => runtimeWriteAdmission?.() === true);
  }
});

// backend/src/services/recoveryCoordinationState.ts
function validate(value) {
  if (!value || !["NORMAL", "READ_ONLY", "MAINTENANCE"].includes(value.mode) || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt)) || value.operationId !== void 0 && typeof value.operationId !== "string" || value.message !== void 0 && typeof value.message !== "string") throw invalid();
  return value;
}
var import_node_fs2, import_node_path2, import_node_crypto, invalid, RecoveryCoordinationState;
var init_recoveryCoordinationState = __esm({
  "backend/src/services/recoveryCoordinationState.ts"() {
    "use strict";
    import_node_fs2 = __toESM(require("node:fs"));
    import_node_path2 = __toESM(require("node:path"));
    import_node_crypto = require("node:crypto");
    invalid = () => Object.assign(new Error("RECOVERY_COORDINATION_INVALID"), { code: "RECOVERY_COORDINATION_INVALID" });
    RecoveryCoordinationState = class {
      constructor(directory) {
        this.directory = directory;
        this.file = import_node_path2.default.join(directory, "state.json");
      }
      readStrict() {
        const stat = import_node_fs2.default.lstatSync(this.file);
        if (!stat.isFile() || stat.size > 8192) throw invalid();
        return validate(JSON.parse(import_node_fs2.default.readFileSync(this.file, "utf8")));
      }
      read() {
        try {
          return this.readStrict();
        } catch {
          return { mode: "MAINTENANCE", message: "Recovery coordination is unavailable.", updatedAt: (/* @__PURE__ */ new Date()).toISOString() };
        }
      }
      initialize() {
        import_node_fs2.default.mkdirSync(this.directory, { recursive: true });
        try {
          this.readStrict();
        } catch (error) {
          if (error?.code !== "ENOENT") throw invalid();
          let descriptor;
          try {
            descriptor = import_node_fs2.default.openSync(this.file, "wx", 384);
          } catch (creation) {
            if (creation?.code === "EEXIST") {
              this.readStrict();
              return;
            }
            throw creation;
          }
          try {
            import_node_fs2.default.writeFileSync(descriptor, JSON.stringify({ mode: "NORMAL", updatedAt: (/* @__PURE__ */ new Date()).toISOString() }));
            import_node_fs2.default.fsyncSync(descriptor);
          } finally {
            import_node_fs2.default.closeSync(descriptor);
          }
          this.syncDirectory();
        }
      }
      write(mode, operationId, message) {
        const state = validate({ mode, operationId, message, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
        const serialized = JSON.stringify(state);
        if (Buffer.byteLength(serialized) > 8192) throw invalid();
        import_node_fs2.default.mkdirSync(this.directory, { recursive: true });
        const temporary = import_node_path2.default.join(this.directory, `.state-${(0, import_node_crypto.randomUUID)()}.tmp`);
        const descriptor = import_node_fs2.default.openSync(temporary, "wx", 384);
        try {
          try {
            import_node_fs2.default.writeFileSync(descriptor, serialized);
            import_node_fs2.default.fsyncSync(descriptor);
          } finally {
            import_node_fs2.default.closeSync(descriptor);
          }
          import_node_fs2.default.renameSync(temporary, this.file);
          this.syncDirectory();
        } finally {
          import_node_fs2.default.rmSync(temporary, { force: true });
        }
        return state;
      }
      syncDirectory() {
        if (process.platform === "win32") return;
        const descriptor = import_node_fs2.default.openSync(this.directory, "r");
        try {
          import_node_fs2.default.fsyncSync(descriptor);
        } finally {
          import_node_fs2.default.closeSync(descriptor);
        }
      }
    };
  }
});

// backend/src/services/recoveryOperationAdmission.ts
var RecoveryOperationAdmission;
var init_recoveryOperationAdmission = __esm({
  "backend/src/services/recoveryOperationAdmission.ts"() {
    "use strict";
    RecoveryOperationAdmission = class {
      constructor() {
        this.active = false;
        this.closing = false;
        this.completed = /* @__PURE__ */ new Set();
      }
      acquire() {
        if (this.active || this.closing) return false;
        this.active = true;
        return true;
      }
      release() {
        this.active = false;
        for (const complete of this.completed) complete();
        this.completed.clear();
      }
      async drain(timeoutMs) {
        this.closing = true;
        if (!this.active) return;
        let timer;
        let complete = () => void 0;
        try {
          await new Promise((resolve, reject) => {
            complete = resolve;
            this.completed.add(complete);
            timer = setTimeout(() => reject(new Error("RECOVERY_OPERATION_DRAIN_TIMEOUT")), timeoutMs);
          });
        } finally {
          if (timer) clearTimeout(timer);
          this.completed.delete(complete);
        }
      }
    };
  }
});

// backend/src/services/onlineRuntimeScope.ts
var init_onlineRuntimeScope = __esm({
  "backend/src/services/onlineRuntimeScope.ts"() {
    "use strict";
  }
});

// backend/src/services/protectedFileAdoptionState.ts
var init_protectedFileAdoptionState = __esm({
  "backend/src/services/protectedFileAdoptionState.ts"() {
    "use strict";
  }
});

// backend/src/services/runtimeNativeAuthority.ts
var init_runtimeNativeAuthority = __esm({
  "backend/src/services/runtimeNativeAuthority.ts"() {
    "use strict";
    init_onlineRuntimeScope();
    init_protectedFileAdoptionState();
  }
});

// backend/src/services/runtimeControlOwnership.ts
var init_runtimeControlOwnership = __esm({
  "backend/src/services/runtimeControlOwnership.ts"() {
    "use strict";
    init_runtimeNativeAuthority();
  }
});

// backend/src/services/runtimeWorkContext.ts
var init_runtimeWorkContext = __esm({
  "backend/src/services/runtimeWorkContext.ts"() {
    "use strict";
  }
});

// backend/src/services/runtimeLeasedWorkContext.ts
var init_runtimeLeasedWorkContext = __esm({
  "backend/src/services/runtimeLeasedWorkContext.ts"() {
    "use strict";
    init_runtimeWorkContext();
  }
});

// backend/src/services/runtimeWorkBoundary.ts
var init_runtimeWorkBoundary = __esm({
  "backend/src/services/runtimeWorkBoundary.ts"() {
    "use strict";
    init_httpRequestLifecycle();
    init_runtimeLeasedWorkContext();
  }
});

// backend/src/services/recoveryRuntime.ts
var import_path, RECOVERY_ROOT, RECOVERY_COORDINATION_DIR, coordinationState, recoveryOperations, getRecoveryRuntimeState;
var init_recoveryRuntime = __esm({
  "backend/src/services/recoveryRuntime.ts"() {
    "use strict";
    import_path = __toESM(require("path"));
    init_deploymentMaintenance();
    init_httpRequestLifecycle();
    init_recoveryCoordinationState();
    init_recoveryOperationAdmission();
    init_runtimeControlOwnership();
    init_runtimeWorkBoundary();
    init_onlineRuntimeScope();
    init_runtimeNativeAuthority();
    RECOVERY_ROOT = process.env.RECOVERY_STORAGE_DIR || import_path.default.join(process.cwd(), "storage", "recovery");
    RECOVERY_COORDINATION_DIR = process.env.RECOVERY_COORDINATION_DIR || import_path.default.join(RECOVERY_ROOT, "coordination");
    coordinationState = new RecoveryCoordinationState(RECOVERY_COORDINATION_DIR);
    recoveryOperations = new RecoveryOperationAdmission();
    getRecoveryRuntimeState = () => {
      return coordinationState.read();
    };
    bindRuntimeHttpWriteAdmission(() => getRecoveryRuntimeState().mode === "NORMAL" && !deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR));
  }
});

// backend/src/services/onlineMigrationPlan.ts
function fail(code) {
  throw Object.assign(new Error(code), { code });
}
function identifier(value) {
  if (typeof value !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/.test(value)) fail("ONLINE_MIGRATION_IDENTIFIER_INVALID");
  return `"${value}"`;
}
function columnType(value) {
  const numeric = /^numeric\((\d+),(\d+)\)$/.exec(value);
  if (numeric) {
    const [, precision, scale] = numeric.map(Number);
    if (precision >= 1 && precision <= 1e3 && scale >= 0 && scale <= precision) return value;
  }
  if (["text", "integer", "bigint", "boolean", "jsonb", "timestamp with time zone"].includes(value)) return value;
  return fail("ONLINE_MIGRATION_COLUMN_TYPE_UNSUPPORTED");
}
function exactKeys(value, allowed) {
  if (!value || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key)) || allowed.some((key) => !(key in value))) fail("ONLINE_MIGRATION_PLAN_INVALID");
}
function compileOnlineExpansion(input) {
  exactKeys(input, ["format", "migrationName", "operations"]);
  if (input.format !== "sabalan-online-expansion/v1" || !/^\d{14}_[a-z0-9_]{1,100}$/.test(input.migrationName) || !Array.isArray(input.operations) || !input.operations.length || input.operations.length > 100) fail("ONLINE_MIGRATION_PLAN_INVALID");
  const names = /* @__PURE__ */ new Set();
  const statements = [];
  const operations2 = input.operations.map((operation) => {
    if (!operation || !["add-nullable-column", "mirror-column"].includes(operation.kind)) fail("ONLINE_MIGRATION_OPERATION_UNSUPPORTED");
    exactKeys(operation, operation.kind === "mirror-column" ? ["kind", "table", "column", "sourceColumn", "type"] : ["kind", "table", "column", "type"]);
    const table = identifier(operation.table), column = identifier(operation.column), type = columnType(operation.type);
    if (names.has(`${operation.table}.${operation.column}`)) fail("ONLINE_MIGRATION_DUPLICATE_COLUMN");
    names.add(`${operation.table}.${operation.column}`);
    statements.push(`ALTER TABLE "public".${table} ADD COLUMN ${column} ${type}`);
    if (operation.kind === "mirror-column") {
      const source = identifier(operation.sourceColumn);
      if (source === column) fail("ONLINE_MIGRATION_DUPLICATE_COLUMN");
      const name = identifier(mirrorName(input.migrationName, operation.table, operation.column));
      statements.push(`CREATE FUNCTION "public".${name}() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.${source} IS NULL THEN NEW.${source} := NEW.${column};
    ELSIF NEW.${column} IS NULL THEN NEW.${column} := NEW.${source};
    ELSIF NEW.${column} IS DISTINCT FROM NEW.${source} THEN RAISE EXCEPTION 'ONLINE_MIRROR_CONFLICT'; END IF;
  ELSE
    IF NEW.${source} IS DISTINCT FROM OLD.${source} AND NEW.${column} IS DISTINCT FROM OLD.${column}
      AND NEW.${source} IS DISTINCT FROM NEW.${column} THEN RAISE EXCEPTION 'ONLINE_MIRROR_CONFLICT';
    ELSIF NEW.${column} IS DISTINCT FROM OLD.${column} THEN NEW.${source} := NEW.${column};
    ELSIF NEW.${source} IS DISTINCT FROM OLD.${source} OR NEW.${column} IS NULL THEN NEW.${column} := NEW.${source}; END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public`);
      statements.push(`CREATE TRIGGER ${name} BEFORE INSERT OR UPDATE ON "public".${table} FOR EACH ROW EXECUTE FUNCTION "public".${name}()`);
      const nonnull = identifier(mirrorName(input.migrationName, operation.table, operation.column).replace("online_mirror_", "online_guard_"));
      statements.push(`CREATE FUNCTION "public".${nonnull}() RETURNS trigger AS $$
BEGIN
  IF NEW.${column} IS NULL THEN RAISE EXCEPTION 'ONLINE_MIRROR_NULL_UNSUPPORTED'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = pg_catalog, public`);
      statements.push(`CREATE TRIGGER ${nonnull} BEFORE UPDATE OF ${column} ON "public".${table} FOR EACH ROW EXECUTE FUNCTION "public".${nonnull}()`);
      return { kind: operation.kind, table: operation.table, column: operation.column, sourceColumn: operation.sourceColumn, type };
    }
    return { kind: operation.kind, table: operation.table, column: operation.column, type };
  });
  const plan = { format: input.format, migrationName: input.migrationName, operations: operations2 };
  const mirrorColumns = /* @__PURE__ */ new Set();
  for (const operation of operations2) {
    if (operation.kind !== "mirror-column") continue;
    for (const name of [operation.column, operation.sourceColumn]) {
      const key = `${operation.table}.${name}`;
      if (mirrorColumns.has(key) || name === operation.sourceColumn && names.has(key)) fail("ONLINE_MIGRATION_MIRROR_OVERLAP");
      mirrorColumns.add(key);
    }
  }
  const sql = `-- Generated bounded online expansion: ${input.migrationName}
${statements.join(";\n\n")};
`;
  return { plan, operationSha256: hash(JSON.stringify(plan)), sql, sqlSha256: hash(sql), statements };
}
async function assertOwner(tx, owner, phase) {
  if (deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR)) fail("ONLINE_MIGRATION_PROTECTED_BOUNDARY");
  const rows = await tx.$queryRaw`SELECT "id" FROM "deployment_operations"
    WHERE "id" = ${owner.deploymentId} AND "leaseToken" = ${owner.leaseToken} AND "activeKey" = 'production'
      AND "leaseExpiresAt" > clock_timestamp() + interval '20 seconds' FOR SHARE`;
  if (rows.length !== 1) fail("ONLINE_MIGRATION_LEASE_LOST");
  const releases = await tx.$queryRaw`SELECT "id" FROM "online_releases"
    WHERE "id"=${owner.releaseId} AND "deploymentId"=${owner.deploymentId} AND "phase"=${phase} FOR SHARE`;
  if (releases.length !== 1) {
    fail("ONLINE_MIGRATION_RELEASE_NOT_OWNED");
  }
}
async function applyOnlineExpansion(database2, owner, input, actualSqlBytes) {
  return database2.$transaction((tx) => applyOwnedExpansion(tx, owner, input, actualSqlBytes), { timeout: 15e3, maxWait: 1e3 });
}
async function applyOwnedExpansion(tx, owner, input, actualSqlBytes) {
  const compiled = compileOnlineExpansion(input);
  if (!actualSqlBytes.equals(Buffer.from(compiled.sql))) fail("ONLINE_MIGRATION_SQL_IDENTITY_MISMATCH");
  await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '10000ms', true)`;
  const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
  if (!locks[0]?.owned) fail("ONLINE_MIGRATION_ALREADY_RUNNING");
  await assertOwner(tx, owner, "EXPANDING");
  const step = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: { releaseId: owner.releaseId, stepId: input.migrationName } } });
  if (!step || step.phase !== "expand" || step.operationSha256 !== compiled.operationSha256 || step.sourceMigrationName !== input.migrationName || compileOnlineExpansion(step.operationJson).operationSha256 !== compiled.operationSha256) {
    fail("ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH");
  }
  const history2 = await tx.$queryRaw`SELECT checksum, finished_at FROM "_prisma_migrations"
    WHERE migration_name = ${input.migrationName} AND rolled_back_at IS NULL`;
  if (history2.length) {
    if (history2.length !== 1 || !history2[0].finished_at || history2[0].checksum !== compiled.sqlSha256 || step.state !== "COMPLETE") {
      fail("ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY");
    }
    await assertExpansionSchema(tx, compiled);
    return { applied: false, checksum: compiled.sqlSha256 };
  }
  if (step.state !== "PENDING") fail("ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY");
  for (const operation of input.operations) {
    const tables = await tx.$queryRaw`SELECT
      c.relkind = 'r' AND c.relpersistence = 'p' AND NOT EXISTS(
        SELECT 1 FROM pg_inherits i WHERE i.inhparent = c.oid OR i.inhrelid = c.oid) AS supported
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = ${operation.table}`;
    if (tables.length !== 1 || !tables[0].supported) fail("ONLINE_MIGRATION_TABLE_UNSUPPORTED");
    const triggers = await tx.$queryRaw`SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT t.tgisinternal`;
    if (triggers.length) fail("ONLINE_MIGRATION_EXISTING_TRIGGER_UNPROVEN");
    if (operation.kind !== "mirror-column") continue;
    const columns = await tx.$queryRaw`
      SELECT format_type(a.atttypid, a.atttypmod) AS type, a.attgenerated::text AS generated, a.attidentity::text AS identity, a.atthasdef AS hasdefault, a.attnotnull AS notnull
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${operation.table} AND a.attname = ${operation.sourceColumn} AND NOT a.attisdropped`;
    if (columns.length !== 1 || columns[0].generated !== "" || columns[0].identity !== "" || columns[0].hasdefault || !columns[0].notnull || columns[0].type !== operation.type) fail("ONLINE_MIGRATION_SOURCE_TYPE_MISMATCH");
  }
  const [started] = await tx.$queryRaw`SELECT clock_timestamp()::text AS value`;
  for (const statement of compiled.statements) await tx.$executeRawUnsafe(statement);
  await assertExpansionSchema(tx, compiled);
  await assertOwner(tx, owner, "EXPANDING");
  const appended = await tx.$executeRaw`WITH finished AS MATERIALIZED (SELECT clock_timestamp() AS value)
    INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
    SELECT ${(0, import_node_crypto2.randomUUID)()}, ${compiled.sqlSha256}, finished.value, ${input.migrationName}, ${started.value}::timestamptz, 1
    FROM finished WHERE finished.value >= ${started.value}::timestamptz`;
  if (appended !== 1) fail("ONLINE_MIGRATION_CLOCK_REQUIRES_RECOVERY");
  await tx.onlineMigrationStep.update({ where: { id: step.id }, data: {
    state: "COMPLETE",
    completedAt: /* @__PURE__ */ new Date(),
    progressJson: { sqlSha256: compiled.sqlSha256 }
  } });
  return { applied: true, checksum: compiled.sqlSha256 };
}
async function backfillMirroredColumn(database2, owner, stepId, plan, batchSize = 200) {
  return database2.$transaction((tx) => backfillOwnedMirror(tx, owner, stepId, plan, batchSize), { timeout: 5e3, maxWait: 1e3 });
}
async function verifyAppliedOnlineExpansion(database2, owner, input) {
  const compiled = compileOnlineExpansion(input);
  return database2.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('lock_timeout','1000ms',true),set_config('statement_timeout','2000ms',true)`;
    await assertOwner(tx, owner, "BACKFILLING");
    const step = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: { releaseId: owner.releaseId, stepId: input.migrationName } } });
    if (!step || step.phase !== "expand" || step.state !== "COMPLETE" || step.sourceMigrationName !== input.migrationName || step.operationSha256 !== compiled.operationSha256 || compileOnlineExpansion(step.operationJson).operationSha256 !== compiled.operationSha256) {
      fail("ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH");
    }
    const history2 = await tx.$queryRaw`SELECT checksum FROM "_prisma_migrations"
   WHERE migration_name=${input.migrationName} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    if (history2.length !== 1 || history2[0].checksum !== compiled.sqlSha256) fail("ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY");
    await assertExpansionSchema(tx, compiled);
    await assertOwner(tx, owner, "BACKFILLING");
    return { migrationName: input.migrationName, checksum: compiled.sqlSha256, readOnlyVerification: true };
  }, { timeout: 5e3, maxWait: 1e3 });
}
async function backfillOwnedMirror(tx, owner, stepId, plan, batchSize = 200) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) fail("ONLINE_BACKFILL_BATCH_INVALID");
  const operation = plan.operation;
  const table = identifier(operation.table), column = identifier(operation.column), source = identifier(operation.sourceColumn);
  const operationSha256 = mirroredBackfillOperationSha256(plan);
  await tx.$queryRaw`SELECT set_config('lock_timeout', '1000ms', true), set_config('statement_timeout', '2000ms', true)`;
  const locks = await tx.$queryRaw`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;
  if (!locks[0]?.owned) fail("ONLINE_MIGRATION_ALREADY_RUNNING");
  await assertOwner(tx, owner, "BACKFILLING");
  const step = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: { releaseId: owner.releaseId, stepId } } });
  if (!step || step.phase !== "backfill" || step.operationSha256 !== operationSha256 || mirroredBackfillOperationSha256(step.operationJson) !== operationSha256) fail("ONLINE_MIGRATION_STEP_IDENTITY_MISMATCH");
  if (!["PENDING", "RUNNING", "COMPLETE"].includes(step.state)) fail("ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY");
  const expansion = await tx.onlineMigrationStep.findUnique({ where: { releaseId_stepId: {
    releaseId: owner.releaseId,
    stepId: plan.expansionMigrationName
  } } });
  if (!expansion || expansion.phase !== "expand" || expansion.state !== "COMPLETE") fail("ONLINE_BACKFILL_EXPANSION_NOT_PROVEN");
  const compiled = compileOnlineExpansion(expansion.operationJson);
  if (compiled.plan.migrationName !== plan.expansionMigrationName || expansion.sourceMigrationName !== plan.expansionMigrationName || compiled.operationSha256 !== expansion.operationSha256 || !compiled.plan.operations.some((candidate) => JSON.stringify(candidate) === JSON.stringify({
    kind: operation.kind,
    table: operation.table,
    column: operation.column,
    sourceColumn: operation.sourceColumn,
    type: operation.type
  }))) fail("ONLINE_BACKFILL_EXPANSION_NOT_PROVEN");
  const history2 = await tx.$queryRaw`SELECT checksum FROM "_prisma_migrations"
    WHERE migration_name = ${plan.expansionMigrationName} AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  if (history2.length !== 1 || history2[0].checksum !== compiled.sqlSha256) fail("ONLINE_MIGRATION_LEDGER_REQUIRES_RECOVERY");
  await assertExpansionSchema(tx, compiled);
  if (step.state === "COMPLETE") {
    const rows = await tx.$queryRawUnsafe(`SELECT EXISTS(
      SELECT 1 FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source}) AS pending`);
    if (rows[0].pending) fail("ONLINE_BACKFILL_COMPLETION_DRIFT");
    return { updated: 0, complete: true };
  }
  const updated = await tx.$queryRawUnsafe(`WITH batch AS (
    SELECT ctid FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source} ORDER BY ctid
    LIMIT ${batchSize} FOR UPDATE SKIP LOCKED)
    UPDATE "public".${table} AS target SET ${column} = target.${source} FROM batch WHERE target.ctid = batch.ctid RETURNING 1 AS changed`);
  const pending2 = await tx.$queryRawUnsafe(`SELECT EXISTS(
    SELECT 1 FROM "public".${table} WHERE ${column} IS DISTINCT FROM ${source}) AS pending`);
  const prior = step.progressJson?.updatedRows ?? 0;
  if (!Number.isSafeInteger(prior) || prior < 0 || !Number.isSafeInteger(prior + updated.length)) fail("ONLINE_BACKFILL_PROGRESS_INVALID");
  await assertOwner(tx, owner, "BACKFILLING");
  await tx.onlineMigrationStep.update({ where: { id: step.id }, data: {
    state: pending2[0].pending ? "RUNNING" : "COMPLETE",
    completedAt: pending2[0].pending ? null : /* @__PURE__ */ new Date(),
    progressJson: { updatedRows: prior + updated.length }
  } });
  return { updated: updated.length, complete: !pending2[0].pending };
}
async function assertExpansionSchema(tx, compiled) {
  for (const operation of compiled.plan.operations) {
    await tx.$executeRawUnsafe(`LOCK TABLE "public".${identifier(operation.table)} IN ROW EXCLUSIVE MODE`);
    const columns = await tx.$queryRaw`
      SELECT a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type, a.attgenerated::text AS generated,
        a.attidentity::text AS identity, a.atthasdef AS hasdefault, a.attnotnull AS notnull,
        c.relkind='r' AND c.relpersistence='p' AND NOT EXISTS(
          SELECT 1 FROM pg_inherits i WHERE i.inhparent=c.oid OR i.inhrelid=c.oid) AS supported
      FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT a.attisdropped
        AND (a.attname=${operation.column} OR a.attname=${operation.kind === "mirror-column" ? operation.sourceColumn : operation.column})`;
    if (columns.length !== (operation.kind === "mirror-column" ? 2 : 1) || columns.some((column) => !column.supported || column.type !== operation.type || column.generated !== "" || column.identity !== "" || column.hasdefault || column.name === operation.column && column.notnull || operation.kind === "mirror-column" && column.name === operation.sourceColumn && !column.notnull)) {
      fail("ONLINE_MIGRATION_SCHEMA_DRIFT");
    }
    if (operation.kind === "mirror-column") await assertMirrorTrigger(tx, compiled, operation);
    const triggerNames = await tx.$queryRaw`SELECT t.tgname AS name FROM pg_trigger t
      JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=${operation.table} AND NOT t.tgisinternal`;
    const expectedNames = compiled.plan.operations.filter((candidate) => candidate.table === operation.table && candidate.kind === "mirror-column").flatMap((candidate) => {
      const name = mirrorName(compiled.plan.migrationName, candidate.table, candidate.column);
      return [name, name.replace("online_mirror_", "online_guard_")];
    }).sort();
    if (JSON.stringify(triggerNames.map((trigger) => trigger.name).sort()) !== JSON.stringify(expectedNames)) fail("ONLINE_MIGRATION_EXISTING_TRIGGER_UNPROVEN");
  }
}
async function assertMirrorTrigger(tx, compiled, operation) {
  await assertGeneratedTrigger(tx, compiled, operation, false);
  await assertGeneratedTrigger(tx, compiled, operation, true);
}
async function assertGeneratedTrigger(tx, compiled, operation, nonnull) {
  const triggerName = nonnull ? mirrorName(compiled.plan.migrationName, operation.table, operation.column).replace("online_mirror_", "online_guard_") : mirrorName(compiled.plan.migrationName, operation.table, operation.column);
  const trigger = await tx.$queryRaw`
    SELECT p.prosrc AS body, t.tgenabled::text AS enabled, t.tgtype::int AS type, t.tgnargs::int AS arguments, t.tgqual IS NULL AS qualified,
      p.proname=${triggerName} AND p.pronamespace=n.oid AND NOT p.prosecdef AND p.provolatile='v'
        AND p.proconfig=ARRAY['search_path=pg_catalog, public']::text[] AND l.lanname='plpgsql'
        AND NOT t.tgisinternal AND t.tgconstraint=0
        AND t.tgattr::text=CASE WHEN ${nonnull} THEN (SELECT a.attnum::text FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname=${operation.column}) ELSE '' END AS "expectedFunction"
    FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_proc p ON p.oid = t.tgfoid JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname = 'public' AND c.relname = ${operation.table} AND t.tgname = ${triggerName}`;
  const functionSql = compiled.statements.find((statement) => statement.startsWith(`CREATE FUNCTION "public".${identifier(triggerName)}`));
  const expectedBody = functionSql?.split("$$")[1]?.trim();
  if (trigger.length !== 1 || !expectedBody || trigger[0].body.trim() !== expectedBody || trigger[0].enabled !== "O" || trigger[0].type !== (nonnull ? 19 : 23) || trigger[0].arguments !== 0 || !trigger[0].qualified || !trigger[0].expectedFunction) fail("ONLINE_BACKFILL_MIRROR_DRIFT");
}
function mirroredBackfillOperationSha256(plan) {
  exactKeys(plan, ["format", "expansionMigrationName", "operation"]);
  if (plan.format !== "sabalan-mirror-backfill/v1" || plan.operation?.kind !== "mirror-column") fail("ONLINE_MIGRATION_PLAN_INVALID");
  const compiled = compileOnlineExpansion({
    format: "sabalan-online-expansion/v1",
    migrationName: plan.expansionMigrationName,
    operations: [plan.operation]
  });
  return hash(JSON.stringify({ format: plan.format, expansionMigrationName: plan.expansionMigrationName, operation: compiled.plan.operations[0] }));
}
var import_node_crypto2, hash, mirrorName;
var init_onlineMigrationPlan = __esm({
  "backend/src/services/onlineMigrationPlan.ts"() {
    "use strict";
    import_node_crypto2 = require("node:crypto");
    init_deploymentMaintenance();
    init_recoveryRuntime();
    hash = (value) => (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex");
    mirrorName = (migration, table, column) => `online_mirror_${hash(`${migration}:${table}:${column}`).slice(0, 24)}`;
  }
});

// backend/src/services/onlineRealtimeBridgeIdentity.ts
function canonicalRealtimeTargets(input) {
  if (!input.length || input.length > 1024) throw Error("REALTIME_TARGET_CENSUS_UNPROVEN");
  const sorted = input.map((value) => {
    if (!/^[a-f0-9]{64}$/.test(value.runtimeId) || !/^[a-f0-9]{64}$/.test(value.nonceSha256) || !/^[A-Za-z0-9_-]{8,128}$/.test(value.releaseId) || !/^sha256:[a-f0-9]{64}$/.test(value.imageIdentity)) throw Error("REALTIME_TARGET_IDENTITY_INVALID");
    return Object.freeze({ runtimeId: value.runtimeId, nonceSha256: value.nonceSha256, releaseId: value.releaseId, imageIdentity: value.imageIdentity });
  }).sort((a, b) => a.runtimeId < b.runtimeId ? -1 : a.runtimeId > b.runtimeId ? 1 : 0);
  if (new Set(sorted.map((value) => value.runtimeId)).size !== sorted.length) throw Error("REALTIME_TARGET_CENSUS_DUPLICATE");
  return Object.freeze({ targets: Object.freeze(sorted), sha256: sha(sorted) });
}
function realtimeCommandId(batchId, target) {
  if (!/^[a-f0-9]{64}$/.test(batchId)) throw Error("REALTIME_BATCH_ID_INVALID");
  return sha(["sabalan-realtime-target/v2", batchId, target.runtimeId, target.nonceSha256]);
}
var import_node_crypto3, sha;
var init_onlineRealtimeBridgeIdentity = __esm({
  "backend/src/services/onlineRealtimeBridgeIdentity.ts"() {
    "use strict";
    import_node_crypto3 = require("node:crypto");
    sha = (value) => (0, import_node_crypto3.createHash)("sha256").update(JSON.stringify(value)).digest("hex");
  }
});

// backend/src/services/runtimeBoundaryJournal.ts
function runtimeNativePostgresApplicationName(runtimeId) {
  if (!hashPattern.test(runtimeId)) fail2("RUNTIME_BOUNDARY_SCOPE_INVALID");
  return `sabalan-rt-${(0, import_node_crypto4.createHash)("sha256").update(runtimeId, "ascii").digest("hex").slice(0, 48)}`;
}
var import_node_crypto4, hashPattern, fail2;
var init_runtimeBoundaryJournal = __esm({
  "backend/src/services/runtimeBoundaryJournal.ts"() {
    "use strict";
    import_node_crypto4 = require("node:crypto");
    hashPattern = /^[a-f0-9]{64}$/;
    fail2 = (code) => {
      throw Object.assign(new Error(code), { code });
    };
  }
});

// backend/src/services/onlinePhysicalCheckpointEvidence.ts
function rawBytes(v, maximum = 8 * 1024 * 1024, allowEmpty = false) {
  if (typeof v !== "string" || v.length > maximum * 4 / 3 + 4) fail3();
  const b = Buffer.from(v, "base64");
  if (!b.length && !allowEmpty || b.length > maximum || b.toString("base64") !== v) fail3();
  return { bytes: b, sha256: (0, import_node_crypto5.createHash)("sha256").update(b).digest("hex") };
}
function raw(v, maximum = 8 * 1024 * 1024) {
  const result = rawBytes(v, maximum);
  return { ...result, value: JSON.parse(result.bytes.toString()) };
}
function birth(v) {
  if (!v || !Number.isSafeInteger(v.pid) || v.pid < 1 || !/^[1-9][0-9]*$/.test(v.startTicks) || !/^pid:\[[1-9][0-9]*\]$/.test(v.pidNamespace) || !/^[a-f0-9-]{36}$/.test(v.bootId)) fail3();
}
function assertOriginalLiveWalCoverage(value, point, database2, captureId) {
  if (!value || value.format !== "sabalan-original-live-wal-coverage/v1" || value.phase !== "LIVE_ORIGINAL_OWNER" || value.finalIntervalCompletion !== false || value.captureId !== captureId || !same(value.sourceDatabase, database2) || !Number.isSafeInteger(value.timeline) || value.timeline < 1 || value.timeline !== point.timeline || !Number.isFinite(Date.parse(value.observedAt)) || !Array.isArray(value.closedWindows) || value.closedWindows.length < 1 || value.closedWindows.length > 4096) fail3();
  birth(value.originalOwner);
  let end;
  for (const window of value.closedWindows) {
    const start = lsn(window.startLsn), next = lsn(window.endLsn);
    if (start >= next || end !== void 0 && start > end) fail3();
    const request = raw(window.requestRawBase64, 1024 * 1024), certificate = raw(window.certificateRawBase64, 1024 * 1024).value;
    const seal = raw(window.sealRawBase64, 1024 * 1024), closure = raw(window.closureRawBase64, 1024 * 1024);
    if (seal.value.format !== "sabalan-wal-seal/v1" || seal.value.phase !== "SEALED" || seal.value.captureSha256 !== closure.sha256 || closure.value.phase !== "COMPLETE" || closure.value.nativeReaped !== true || closure.value.databaseQuiet !== true || closure.value.nativeStatus !== 0 || closure.value.startLsn !== window.startLsn || closure.value.endLsn !== window.endLsn || closure.value.source?.systemIdentifier !== database2.systemIdentifier || closure.value.source?.timeline !== value.timeline) fail3();
    const r = request.value, d = certificate.decision;
    if (r.format !== "sabalan-original-wal-window-verification-request/v1" || !digest(r.challenge) || !digest(r.windowSha256) || r.sourceIdentity?.systemIdentifier !== database2.systemIdentifier || r.sourceIdentity?.timeline !== value.timeline || !Array.isArray(r.objects) || r.objects.length < 1 || r.objects.length > 16 || r.objects.some((o) => typeof o.name !== "string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(o.name) || !Number.isSafeInteger(o.bytes) || o.bytes < 1 || !digest(o.sha256)) || r.windowSha256 !== seal.sha256 || !same(r.objects, seal.value.objects?.map((o) => ({ name: o.name, bytes: o.encryptedBytes, sha256: o.encryptedSha256 }))) || certificate.format !== "sabalan-signed-original-wal-window-verification/v1" || d?.format !== "sabalan-original-wal-window-verification/v1" || d.requestSha256 !== hash2(r) || d.challenge !== r.challenge || d.windowSha256 !== r.windowSha256 || !digest(d.independentTokenSha256) || !same(d.sourceIdentity, r.sourceIdentity) || !same(d.objects, r.objects) || !Number.isFinite(Date.parse(d.issuedAt)) || !Number.isFinite(Date.parse(d.expiresAt)) || Date.parse(d.expiresAt) <= Date.parse(d.issuedAt) || Date.parse(d.expiresAt) - Date.parse(d.issuedAt) > 6e5 || typeof certificate.signature !== "string" || Buffer.from(certificate.signature, "base64").length !== 64 || Buffer.from(certificate.signature, "base64").toString("base64") !== certificate.signature) fail3();
    if (!Number.isFinite(Date.parse(window.acceptedAt)) || Date.parse(window.acceptedAt) < Date.parse(d.issuedAt) || Date.parse(window.acceptedAt) >= Date.parse(d.expiresAt) || Date.parse(window.acceptedAt) > Date.parse(value.observedAt) || seal.value.range?.startLsn !== window.startLsn || seal.value.range?.endLsn !== window.endLsn) fail3();
    end = end === void 0 || next > end ? next : end;
  }
  const successor = value.successor, active = raw(successor?.activeRawBase64, 65536).value;
  if (!successor || !Number.isSafeInteger(successor.originalDockerPid) || successor.originalDockerPid < 1 || !Number.isSafeInteger(successor.originalPid) || successor.originalPid < 1 || active.phase !== "ACTIVE" || active.pid !== successor.originalPid || active.source?.systemIdentifier !== database2.systemIdentifier || active.source?.timeline !== value.timeline || !digest(active.configurationSha256)) fail3();
  birth({ ...active, pid: successor.originalPid });
  const segment = successor.segmentBytes;
  if (!Number.isSafeInteger(segment) || segment < 1048576 || segment > 1073741824 || (BigInt(segment) & BigInt(segment) - 1n) !== 0n) fail3();
  if (value.coveredFromLsn !== value.closedWindows[0].startLsn || !Number.isSafeInteger(successor.sender?.pid) || successor.sender.pid < 1 || successor.sender.state !== "streaming" || !Number.isFinite(Date.parse(successor.sender.backendStart)) || lsn(successor.startLsn) / BigInt(segment) * BigInt(segment) > end || lsn(successor.endLsn) <= lsn(successor.startLsn) || lsn(value.coveredFromLsn) > lsn(point.lsn) || end < lsn(point.requiredWalEndLsn) || lsn(value.coveredThroughLsn) < lsn(point.requiredWalEndLsn) || lsn(value.coveredThroughLsn) > lsn(successor.sender.flushLsn) || lsn(value.coveredThroughLsn) > lsn(successor.endLsn)) fail3();
  return value;
}
function assertOriginalIndependentPhysicalPoint(source, expected) {
  const report = raw(source.physicalRestoreRawBase64, 32 * 1024 * 1024).value, metadata = source.checkpointMetadata;
  const sameCompose = report.format === "sabalan-original-same-compose-online-physical-restore/v1";
  if (!sameCompose && report.format !== "sabalan-original-independent-online-physical-restore/v1" || report.continuousWalQualified !== false || !digest(report.sealedManifestSha256) || !digest(report.plaintextManifestSha256) || !digest(report.cipherInventorySha256) || !same(report.sourceDatabase, expected.deploymentTargetDatabase) || (sameCompose ? report.sourceHost?.machineUuidSha256 !== metadata.sourceMachineUuidSha256 || report.sourceHost?.kernelBootIdSha256 !== metadata.sourceKernelBootIdSha256 : report.sourceMachineUuidSha256 !== metadata.sourceMachineUuidSha256 || report.sourceKernelBootIdSha256 !== metadata.sourceKernelBootIdSha256) || !sameCompose && (!digest(report.recoveryMachineUuidSha256) || report.recoveryMachineUuidSha256 === report.sourceMachineUuidSha256 || !digest(report.recoveryKernelBootIdSha256) || report.recoveryKernelBootIdSha256 === report.sourceKernelBootIdSha256) || !Number.isFinite(Date.parse(report.startedAt)) || !Number.isFinite(Date.parse(report.completedAt)) || Date.parse(report.completedAt) < Date.parse(report.startedAt) || metadata.physicalPoint?.sealedManifestSha256 !== report.sealedManifestSha256 || metadata.physicalPoint?.plaintextManifestSha256 !== report.plaintextManifestSha256 || metadata.physicalPoint?.cipherInventorySha256 !== report.cipherInventorySha256 || !same(metadata.physicalPoint?.restorePoint, report.restorePoint)) fail3();
  if (sameCompose) {
    for (const host of [report.sourceHost, report.replayHost, report.rsaHost]) if (!host || !same(Object.keys(host).sort(), ["kernelBootIdSha256", "machineUuidSha256"]) || !Object.values(host).every(digest)) fail3();
    if (report.rsaHost.machineUuidSha256 === report.sourceHost.machineUuidSha256 || Object.prototype.hasOwnProperty.call(report, "recoveryMachineUuidSha256") || Object.prototype.hasOwnProperty.call(report, "recoveryKernelBootIdSha256")) fail3();
    const i = report.restoredIncarnation, r = report.originalSerialRestoration;
    if (i?.format !== "sabalan-original-serial-restored-incarnation/v1" || i.project !== "sabalanerp-local" || i.service !== "postgres" || !digest(i.containerId) || !/^sha256:[a-f0-9]{64}$/.test(i.image) || !Number.isFinite(Date.parse(i.startedAt)) || !Number.isSafeInteger(i.epoch) || i.epoch < 1 || i.productionAdmission !== false || !/^[a-f0-9]{32}$/.test(i.operation) || !/^[1-9][0-9]*$/.test(i.systemIdentifier) || r?.originalClusterRestored !== true || r.operation !== i.operation || !Array.isArray(r.originalControllers) || r.originalControllers.length < 1 || r.originalControllers.some((v) => v.code !== 0 || v.signal !== null || v.stdoutEof !== true || v.stderrEof !== true || v.observationFault !== false)) fail3();
    const application = report.originalApplicationReport, original2 = raw(application?.rawBase64, 32 * 1024 * 1024);
    if (application.sha256 !== original2.sha256 || application.bytes !== original2.bytes.length || Object.prototype.hasOwnProperty.call(original2.value, "restoredIncarnation") || original2.value.format !== report.format || original2.value.pass !== true || original2.value.phase !== "COMPLETE" || !same(original2.value.replayHost, report.replayHost) || !same(original2.value.rsaHost, report.rsaHost)) fail3();
  }
  const layout = report.layout, replay = report.replay, point = report.restorePoint;
  if (!layout || layout.format !== "sabalan-original-independent-online-layout/v1" || layout.captureId !== expected.captureId || !same({ ...layout.restorePoint, timeline: point.timeline }, point) || layout.coverage?.timeline !== point.timeline || layout.sourceDatabase?.systemIdentifier !== expected.deploymentTargetDatabase.systemIdentifier || layout.sourceDatabase?.database !== expected.deploymentTargetDatabase.name || String(layout.sourceDatabase?.databaseOid) !== expected.deploymentTargetDatabase.oid || !Array.isArray(layout.restoredFileCuts) || layout.restoredFileCuts.length !== 9 || new Set(layout.restoredFileCuts.map((v) => v.name)).size !== 9 || !digest(layout.sqlite?.sha256) || !Number.isSafeInteger(layout.sqlite.bytes) || layout.sqlite.bytes < 1 || !digest(layout.physicalBase?.backupManifestSha256) || !Number.isSafeInteger(layout.physicalBase.files) || layout.physicalBase.files < 1 || !layout.coordinationHistory || !digest(layout.coordinationHistory.sha256)) fail3();
  if (typeof point?.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(point.name) || !Number.isSafeInteger(point.timeline) || point.timeline < 1 || replay?.inRecovery !== false || replay.systemIdentifier !== expected.deploymentTargetDatabase.systemIdentifier || replay.sourceDatabaseOid !== expected.deploymentTargetDatabase.oid || lsn(replay.lastReplayLsn) < lsn(point.lsn) || lsn(replay.lastReplayLsn) > lsn(point.requiredWalEndLsn)) fail3();
  const commands = report.originalPgCommands;
  if (!Array.isArray(commands) || !["pg_verifybackup", "pg_waldump", "pg_controldata"].every((role) => commands.filter((v) => v.role === role).length === 1) || commands.some((v) => !Number.isSafeInteger(v.originalPid) || v.originalPid < 1 || v.returncode !== 0 || v.signal !== null || rawBytes(v.stdoutRawBase64, 1024 * 1024, true).sha256 !== v.stdoutSha256)) fail3();
  const decrypt = report.decryption;
  if (decrypt?.format !== "sabalan-original-independent-online-components/v1" || decrypt.sealedSha256 !== report.sealedManifestSha256 || decrypt.manifestSha256 !== report.plaintextManifestSha256 || decrypt.fullGcmAuthenticated !== true || decrypt.independentRsaDecryptVerified !== true || !Array.isArray(decrypt.components) || decrypt.components.length < 15 || decrypt.components.some((v) => !digest(v.sha256) || !digest(v.cipherSha256) || !Number.isSafeInteger(v.bytes) || v.bytes < 0 || !Number.isSafeInteger(v.cipherBytes) || v.cipherBytes < 1)) fail3();
  assertOriginalLiveWalCoverage(source.liveWalCoverage, point, expected.deploymentTargetDatabase, expected.captureId);
  return report;
}
var import_node_crypto5, fail3, canonical, same, digest, hash2, lsn;
var init_onlinePhysicalCheckpointEvidence = __esm({
  "backend/src/services/onlinePhysicalCheckpointEvidence.ts"() {
    "use strict";
    import_node_crypto5 = require("node:crypto");
    fail3 = () => {
      throw Error("ONLINE_PHYSICAL_CHECKPOINT_UNPROVEN");
    };
    canonical = (v) => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])])) : v;
    same = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
    digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    hash2 = (v) => (0, import_node_crypto5.createHash)("sha256").update(JSON.stringify(canonical(v))).digest("hex");
    lsn = (v) => {
      if (typeof v !== "string" || !/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/.test(v)) fail3();
      const [a, b] = v.split("/");
      return BigInt("0x" + a) * 0x100000000n + BigInt("0x" + b);
    };
  }
});

// backend/src/services/deploymentCheckpointMetadataIdentity.ts
function fail4() {
  throw Error("DEPLOYMENT_CANONICAL_CHECKPOINT_METADATA_UNPROVEN");
}
function readCanonicalCheckpointMetadata(sidecar) {
  const value = sidecar, metadata = value?.canonicalMetadata;
  if (!value || typeof value !== "object" || Array.isArray(value) || !metadata || typeof metadata !== "object" || Array.isArray(metadata) || "canonicalMetadata" in metadata || "canonicalMetadataSha256" in metadata || typeof value.canonicalMetadataSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.canonicalMetadataSha256) || hash3(metadata) !== value.canonicalMetadataSha256) fail4();
  const transport = /* @__PURE__ */ new Set(["metadataPath", "localPath", "archivePath", "canonicalMetadata", "canonicalMetadataSha256"]);
  for (const key of Object.keys(value)) if (!transport.has(key) && (!(key in metadata) || hash3(value[key]) !== hash3(metadata[key]))) fail4();
  for (const key of Object.keys(metadata)) {
    if (transport.has(key)) {
      if (key in value && hash3(value[key]) !== hash3(metadata[key])) fail4();
    } else if (!(key in value) || hash3(value[key]) !== hash3(metadata[key])) fail4();
  }
  return { metadata: JSON.parse(JSON.stringify(metadata)), sha256: value.canonicalMetadataSha256 };
}
var import_node_crypto6, canonical2, hash3;
var init_deploymentCheckpointMetadataIdentity = __esm({
  "backend/src/services/deploymentCheckpointMetadataIdentity.ts"() {
    "use strict";
    import_node_crypto6 = require("node:crypto");
    canonical2 = (value) => Array.isArray(value) ? value.map(canonical2) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical2(value[key])])) : value;
    hash3 = (value) => (0, import_node_crypto6.createHash)("sha256").update(JSON.stringify(canonical2(value))).digest("hex");
  }
});

// backend/src/services/onlineImageExecutionBinding.ts
function requireProof(value) {
  if (!value) throw Error("ONLINE_IMAGE_EXECUTION_BINDING_UNPROVEN");
}
function validateProductionExecutionBindings(bindings, expected) {
  if (bindings === void 0) return { ...expected.deploymentTargetImages };
  requireProof(exact(bindings, roles));
  let host;
  const result = {};
  for (const role of roles) {
    const value = bindings[role];
    requireProof(exact(value, ["format", "role", "releaseId", "sourceMachineUuidSha256", "sourceKernelBootIdSha256", "store", "executionImageId", "graph", "nativeInspection", "inspectionSha256"]));
    requireProof(value.format === "sabalan-production-image-execution-binding/v1" && value.role === role && value.releaseId === expected.releaseId && digest2(value.sourceMachineUuidSha256) && digest2(value.sourceKernelBootIdSha256));
    const identity2 = value.sourceMachineUuidSha256 + ":" + value.sourceKernelBootIdSha256;
    requireProof(host === void 0 || host === identity2);
    host = identity2;
    if (expected.sourceHost) requireProof(value.sourceMachineUuidSha256 === expected.sourceHost.machineUuidSha256 && value.sourceKernelBootIdSha256 === expected.sourceHost.kernelBootIdSha256);
    if (expected.recoveryMachineUuidSha256) requireProof(digest2(expected.recoveryMachineUuidSha256) && value.sourceMachineUuidSha256 !== expected.recoveryMachineUuidSha256);
    const graph = value.graph;
    requireProof(exact(graph, ["index", "platform", "config", "rootfsDiffIds", "archiveSha256", "archiveBytes"]) && same2(graph, expected.imageGraphs[role]) && graph.config === expected.deploymentTargetImages[role] && [graph.index, graph.platform, graph.config].every(image) && digest2(graph.archiveSha256) && Number.isSafeInteger(graph.archiveBytes) && graph.archiveBytes > 0 && Array.isArray(graph.rootfsDiffIds) && graph.rootfsDiffIds.length > 0 && graph.rootfsDiffIds.length <= 128 && graph.rootfsDiffIds.every(image));
    const observed = value.nativeInspection;
    requireProof(exact(observed, ["Id", "Descriptor", "RootFS", "Os", "Architecture", "Config"]) && observed.Os === "linux" && observed.Architecture === "amd64" && exact(observed.RootFS, ["Type", "Layers"]) && observed.RootFS.Type === "layers" && same2(observed.RootFS.Layers, graph.rootfsDiffIds) && exact(observed.Config, ["Labels"]) && (observed.Config.Labels === null || typeof observed.Config.Labels === "object" && !Array.isArray(observed.Config.Labels) && Object.entries(observed.Config.Labels).every(([key, label]) => key.length > 0 && typeof label === "string")) && digest2(value.inspectionSha256) && productionImageInspectionSha256(observed) === value.inspectionSha256 && image(value.executionImageId) && observed.Id === value.executionImageId);
    if (value.store === "containerd") {
      const descriptor = observed.Descriptor;
      requireProof(value.executionImageId === graph.index && exact(descriptor, ["mediaType", "digest", "size"]) && descriptor.digest === graph.index && ["application/vnd.oci.image.index.v1+json", "application/vnd.docker.distribution.manifest.list.v2+json"].includes(descriptor.mediaType) && Number.isSafeInteger(descriptor.size) && descriptor.size > 0);
    } else requireProof(value.store === "classic" && value.executionImageId === graph.config && observed.Descriptor === null);
    result[role] = value.executionImageId;
  }
  return result;
}
var import_node_crypto7, roles, canonical3, same2, digest2, image, exact, productionImageInspectionSha256;
var init_onlineImageExecutionBinding = __esm({
  "backend/src/services/onlineImageExecutionBinding.ts"() {
    "use strict";
    import_node_crypto7 = require("node:crypto");
    roles = ["backend", "frontend", "inquiry"];
    canonical3 = (v) => Array.isArray(v) ? v.map(canonical3) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical3(v[k])])) : v;
    same2 = (a, b) => JSON.stringify(canonical3(a)) === JSON.stringify(canonical3(b));
    digest2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    image = (v) => typeof v === "string" && /^sha256:[a-f0-9]{64}$/.test(v);
    exact = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && same2(Object.keys(v).sort(), keys.slice().sort());
    productionImageInspectionSha256 = (inspection) => (0, import_node_crypto7.createHash)("sha256").update(JSON.stringify(canonical3(inspection))).digest("hex");
  }
});

// backend/src/services/onlineQualificationProvenance.ts
function required(value) {
  if (!value) throw Error("ONLINE_TRUSTED_ORIGINAL_QUALIFICATION_UNPROVEN");
}
function read(file, maximum, mode) {
  required(import_node_fs3.default.realpathSync(file) === file);
  const fd = import_node_fs3.default.openSync(file, import_node_fs3.default.constants.O_RDONLY | import_node_fs3.default.constants.O_NOFOLLOW | import_node_fs3.default.constants.O_NONBLOCK);
  try {
    const before = import_node_fs3.default.fstatSync(fd, { bigint: true });
    required(before.isFile() && before.uid === 0n && before.nlink === 1n && (before.mode & 0o777n) === BigInt(mode) && before.size > 0n && before.size <= BigInt(maximum));
    const raw2 = import_node_fs3.default.readFileSync(fd);
    required(pin(before) === pin(import_node_fs3.default.fstatSync(fd, { bigint: true })) && pin(before) === pin(import_node_fs3.default.lstatSync(file, { bigint: true })));
    return { raw: raw2, pin: pin(before) };
  } finally {
    import_node_fs3.default.closeSync(fd);
  }
}
function verifyOnlineQualificationOrigin(raw2, publicKey, accepted) {
  required(raw2.length > 0 && raw2.length <= 65536 && publicKey.length > 0 && publicKey.length <= 4096);
  const envelope = JSON.parse(raw2.toString("utf8")), value = envelope.decision;
  required(Object.keys(envelope).sort().join(",") === "decision,format,signature" && envelope.format === "sabalan-signed-online-qualification-origin/v1" && Object.keys(value).sort().join(",") === "acceptanceSha256,checkpointSha256,evidenceInventorySha256,format,issuedAt,manifestSha256,nativeClosuresSha256,origins,releaseId" && value.format === "sabalan-original-online-qualification/v1" && value.releaseId === accepted.manifest.releaseId && value.manifestSha256 === accepted.acceptance.manifestSha256 && value.checkpointSha256 === accepted.acceptance.checkpointSha256 && [value.acceptanceSha256, value.manifestSha256, value.evidenceInventorySha256, value.nativeClosuresSha256].every(hex) && value.acceptanceSha256 === accepted.evidenceInventory.find((row) => row.file === "acceptance.json")?.sha256 && value.evidenceInventorySha256 === hash4(accepted.evidenceInventory) && value.nativeClosuresSha256 === hash4(accepted.nativeClosures) && Array.isArray(value.origins) && value.origins.length === 2 && value.origins.map((row) => row.kind).sort().join(",") === "independent-original,local-original" && value.origins.every((row) => Object.keys(row).sort().join(",") === "completionSha256,controllerSourceSha256,historySha256,kind" && [row.completionSha256, row.controllerSourceSha256, row.historySha256].every(hex)) && Number.isFinite(Date.parse(value.issuedAt)) && Date.parse(value.issuedAt) <= Date.now() && new Date(value.issuedAt).toISOString() === value.issuedAt && typeof envelope.signature === "string" && /^[A-Za-z0-9+/]{86}==$/.test(envelope.signature));
  const key = (0, import_node_crypto8.createPublicKey)(publicKey);
  required(key.asymmetricKeyType === "ed25519" && (0, import_node_crypto8.verify)(null, Buffer.concat([Buffer.from("sabalan-original-online-qualification/v1\n"), encode(value)]), key, Buffer.from(envelope.signature, "base64")));
  return Object.freeze(value);
}
function openTrustedOnlineQualification(directory, expected) {
  required(process.platform === "linux" && process.getuid?.() === 0);
  const accepted = readOnlineReleaseEvidence(directory, expected), key = read(ONLINE_QUALIFICATION_PUBLIC_KEY, 4096, 292);
  const file = import_node_path3.default.join(directory, "qualification-provenance.json"), certificate = read(file, 65536, 256);
  const decision = verifyOnlineQualificationOrigin(certificate.raw, key.raw, accepted);
  required(decision.acceptanceSha256 === expected.acceptanceSha256);
  return Object.freeze({ decision, accepted, revalidate() {
    accepted.revalidate();
    required(read(ONLINE_QUALIFICATION_PUBLIC_KEY, 4096, 292).pin === key.pin && read(file, 65536, 256).pin === certificate.pin);
  } });
}
var import_node_fs3, import_node_path3, import_node_crypto8, ONLINE_QUALIFICATION_PUBLIC_KEY, canonical4, encode, sha2, hash4, hex, pin;
var init_onlineQualificationProvenance = __esm({
  "backend/src/services/onlineQualificationProvenance.ts"() {
    "use strict";
    import_node_fs3 = __toESM(require("node:fs"));
    import_node_path3 = __toESM(require("node:path"));
    import_node_crypto8 = require("node:crypto");
    init_onlineReleaseEvidence();
    ONLINE_QUALIFICATION_PUBLIC_KEY = "/etc/sabalan/online/qualification-public-key.pem";
    canonical4 = (v) => Array.isArray(v) ? v.map(canonical4) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((key) => [key, canonical4(v[key])])) : v;
    encode = (v) => Buffer.from(JSON.stringify(canonical4(v)));
    sha2 = (v) => (0, import_node_crypto8.createHash)("sha256").update(v).digest("hex");
    hash4 = (v) => sha2(encode(v));
    hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    pin = (s) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(":");
  }
});

// backend/src/services/restoredQaHttpObservation.ts
function parseRestoredQaBGuardianClosure(activeRaw, finalRaw, expected) {
  const need5 = (v) => {
    if (!v) throw Error("RESTORED_QA_B_GUARDIAN_CLOSURE_UNPROVEN");
  };
  need5(Buffer.isBuffer(activeRaw) && Buffer.isBuffer(finalRaw) && activeRaw.length > 0 && finalRaw.length > 0 && activeRaw.length <= 16384 && finalRaw.length <= 16384);
  const role = expected.role ?? "standalone";
  need5(role === "standalone" || role === "control");
  const a = JSON.parse(activeRaw.toString()), f = JSON.parse(finalRaw.toString()), hash14 = (0, import_node_crypto9.createHash)("sha256").update(activeRaw).digest("hex");
  need5(a?.format === "sabalan-runtime-native/v1" && a.phase === "ACTIVE" && a.role === role && a.guardian?.pid === expected.pid && a.guardian.startTicks === expected.startTicks && a.commandSha256 === expected.commandSha256 && a.initialDatabase?.name === expected.database.name && String(a.initialDatabase.oid) === expected.database.oid && a.clusterIdentifier === expected.database.systemIdentifier && a.onlineScope === void 0 && a.onlineLocks === void 0 && a.captureGate === void 0 && a.previousSha256 === null && /^[a-f0-9]{48}$/.test(a.instanceId) && a.namespace === "sabalan-rt-" + a.instanceId);
  need5(f?.phase === "QUIESCENT" && f.nativeReaped === true && f.databaseQuiet === true && f.nativeStatus === 0 && f.stoppedBySignal === false && f.activeClaimSha256 === hash14);
  const restored = { ...f, phase: "ACTIVE" };
  for (const key of ["nativeReaped", "databaseQuiet", "nativeStatus", "stoppedBySignal", "activeClaimSha256"]) delete restored[key];
  need5(JSON.stringify(canonical5(restored)) === JSON.stringify(canonical5(a)));
  return Object.freeze({ namespace: a.namespace, activeClaimSha256: hash14, nativeReceiptSha256: (0, import_node_crypto9.createHash)("sha256").update(finalRaw).digest("hex"), database: Object.freeze({ ...expected.database }) });
}
var import_node_crypto9, canonical5;
var init_restoredQaHttpObservation = __esm({
  "backend/src/services/restoredQaHttpObservation.ts"() {
    "use strict";
    import_node_crypto9 = require("node:crypto");
    canonical5 = (v) => Array.isArray(v) ? v.map(canonical5) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical5(v[k])])) : v;
  }
});

// backend/src/services/restoredQaInstalledRuntimeFiles.ts
function need(v) {
  if (!v) throw Error("RESTORED_QA_INSTALLED_CONTENT_UNPROVEN");
}
function installedRuntimeReceiptProjection(raw2) {
  need(Buffer.isBuffer(raw2) && raw2.length > 0 && raw2.length <= 4 * 1024 * 1024);
  const receipt = JSON.parse(raw2.toString());
  need(receipt?.format === "sabalan-current-backend-material/v1" && receipt.materialized === true && receipt.sourceUnchanged === true && Array.isArray(receipt.files) && receipt.files.length > 0 && receipt.files.length <= 2e4);
  const ids = /* @__PURE__ */ new Set();
  const files = receipt.files.map((row) => {
    need(row && Object.keys(row).sort().join(",") === "bytes,path,sha256" && typeof row.path === "string" && row.path.length <= 4096 && !row.path.includes("\\") && !row.path.includes("\0") && !row.path.startsWith("/") && row.path.split("/").every((p) => p !== "" && p !== "." && p !== "..") && !ids.has(row.path) && Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 512 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(row.sha256));
    ids.add(row.path);
    need(row.path === "Dockerfile" || row.path.startsWith("app/") || row.path.startsWith("packages/contract-product-graph/") || row.path.startsWith("packages/partner-sales-contracts/"));
    return { path: row.path, bytes: row.bytes, sha256: row.sha256 };
  }).filter((row) => row.path !== "Dockerfile").sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  need(files.some((r) => r.path === "app/dist/application.js") && files.some((r) => r.path === "app/dist/lib/prisma.js") && files.some((r) => r.path === "app/prisma/schema.prisma") && files.some((r) => r.path.startsWith("app/node_modules/@prisma/client/")));
  return Object.freeze({ files: Object.freeze(files.map((r) => Object.freeze(r))), materialReceiptSha256: hash5(raw2), fileMapSha256: hash5(JSON.stringify(files)) });
}
var import_node_crypto10, hash5;
var init_restoredQaInstalledRuntimeFiles = __esm({
  "backend/src/services/restoredQaInstalledRuntimeFiles.ts"() {
    "use strict";
    import_node_crypto10 = require("node:crypto");
    hash5 = (b) => (0, import_node_crypto10.createHash)("sha256").update(b).digest("hex");
  }
});

// backend/src/services/protectedBridgeMigrationCompiler.ts
function failure(code) {
  throw Object.assign(new Error(code), { code });
}
function compileProtectedBridgeMigration(name, bytes) {
  if (!Object.prototype.hasOwnProperty.call(known, name)) failure("PROTECTED_BRIDGE_MIGRATION_UNSUPPORTED");
  const definition = known[name];
  if (!Buffer.isBuffer(bytes) || sha3(bytes) !== definition.sha256) failure("PROTECTED_BRIDGE_SQL_IDENTITY_MISMATCH");
  const statements = name === "20261019010000_customer_semantic_barrier" ? [bytes.toString("utf8")] : bytes.toString("utf8").split(/;\s*(?=(?:--[^\r\n]*[\r\n]\s*)*(?:CREATE|ALTER)\s)/);
  if (statements.length !== definition.statements) failure("PROTECTED_BRIDGE_STATEMENTS_UNPROVEN");
  return { name, sha256: definition.sha256, statements, tables: [...definition.tables], functions: [...definition.functions] };
}
var import_node_crypto11, bootstrap, protectedBridgeMigrationNames, known, protectedOwnedMigrationStrategyNames, sha3;
var init_protectedBridgeMigrationCompiler = __esm({
  "backend/src/services/protectedBridgeMigrationCompiler.ts"() {
    "use strict";
    import_node_crypto11 = require("node:crypto");
    bootstrap = {
      "20261014120000_hr_vehicle_assignment_plans": {
        sha256: "c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289",
        statements: 4,
        tables: ["driver_vehicle_assignment_plans"],
        functions: []
      },
      "20261014140000_online_deployment_control": {
        sha256: "872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2",
        statements: 29,
        tables: ["online_releases", "online_runtime_slots", "online_migration_steps"],
        functions: [
          "sabalan_protect_online_release_identity",
          "sabalan_protect_online_runtime_identity",
          "sabalan_protect_online_migration_identity",
          "sabalan_prevent_online_registry_delete"
        ]
      }
    };
    protectedBridgeMigrationNames = Object.freeze(Object.keys(bootstrap));
    known = {
      ...bootstrap,
      "20261019010000_customer_semantic_barrier": {
        sha256: "f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55",
        statements: 1,
        tables: [
          "online_financial_compatibility_barriers",
          "accounting_check_instrument_events",
          "accounting_check_instruments",
          "accounting_customer_commands",
          "accounting_customer_opening_attributions",
          "accounting_customer_opening_reviews",
          "accounting_customer_receipt_adjustments",
          "accounting_customer_receipt_resolutions",
          "accounting_settlement_allocation_lines",
          "accounting_settlement_allocations",
          "accounting_treasury_transactions"
        ],
        functions: [
          "sabalan_require_customer_source_shares",
          "sabalan_protect_customer_barrier",
          "sabalan_guard_customer_credit_source",
          "sabalan_reject_customer_semantic_mutation",
          "sabalan_guard_customer_semantic_fields"
        ]
      },
      "20261019020000_hr_versioned_file_cleanup": {
        sha256: "cb25c720d02d37ad036c95583ef9ba1ba7856bcd483a62ef1c8e03930947b9a9",
        statements: 1,
        tables: ["hr_deletion_file_cleanups"],
        functions: []
      },
      "20261020010000_online_realtime_completion": {
        sha256: "f92e8c7dca2ef0c1798275c0e3fe3d1735aec67ef52875dd4df3fed4744df181",
        statements: 10,
        tables: ["online_hr_invalidation_intents", "online_realtime_batches", "online_realtime_commands"],
        functions: ["sabalan_guard_realtime_command"]
      },
      "20261020093000_online_serving_epochs": {
        sha256: "7f4b2b3dc5f7084047409e7c59d29b8667d37a85d33920e95bc7a8f37f48eb9c",
        statements: 5,
        tables: ["online_serving_epochs"],
        functions: ["sabalan_protect_online_serving_epoch"]
      }
    };
    protectedOwnedMigrationStrategyNames = Object.freeze(Object.keys(known));
    sha3 = (bytes) => (0, import_node_crypto11.createHash)("sha256").update(bytes).digest("hex");
  }
});

// backend/src/services/protectedFinancialMigrationEvidence.ts
function need2(v) {
  if (!v) throw Error("PROTECTED_FINANCIAL_NATIVE_EVIDENCE_UNPROVEN");
}
function compileProtectedFinancialMigrationPlan(files) {
  need2(files.size === pending.length && same3([...files.keys()].sort(), [...pending].sort()));
  const steps = pending.map((name) => {
    const bytes = files.get(name);
    need2(bytes);
    const compiled = compileProtectedBridgeMigration(name, bytes);
    return Object.freeze({
      migrationName: name,
      sqlSha256: compiled.sha256,
      statementCount: compiled.statements.length,
      tables: Object.freeze(compiled.tables),
      functions: Object.freeze(compiled.functions)
    });
  });
  const result = Object.freeze({
    strategy: "sabalan-protected-owned-financial/v1",
    steps: Object.freeze(steps),
    sourceCatalogSha256: sha4(JSON.stringify(steps))
  });
  plans.add(result);
  return result;
}
function history(raw2) {
  need2(typeof raw2 === "string" && Buffer.byteLength(raw2) > 0 && Buffer.byteLength(raw2) <= 16 * 1024 * 1024);
  const rows = JSON.parse(raw2);
  need2(Array.isArray(rows) && rows.length <= 4096);
  const ids = /* @__PURE__ */ new Set();
  for (const r of rows) {
    need2(r && same3(Object.keys(r).sort(), ["id", "migration_name", "checksum", "started_at", "finished_at", "rolled_back_at", "logs", "applied_steps_count"].sort()) && typeof r.id === "string" && r.id.length > 0 && r.id.length <= 256 && !ids.has(r.id) && typeof r.migration_name === "string" && r.migration_name.length <= 256 && hex2(r.checksum) && typeof r.started_at === "string" && Number.isFinite(Date.parse(r.started_at)) && (r.finished_at === null || typeof r.finished_at === "string" && Number.isFinite(Date.parse(r.finished_at))) && (r.rolled_back_at === null || typeof r.rolled_back_at === "string" && Number.isFinite(Date.parse(r.rolled_back_at))) && (r.logs === null || typeof r.logs === "string") && Number.isSafeInteger(r.applied_steps_count) && r.applied_steps_count >= 0);
    if (r.rolled_back_at === null) need2(r.finished_at !== null && r.applied_steps_count > 0);
    ids.add(r.id);
  }
  return rows;
}
function verifyProtectedFinancialNativeRun(plan, run, beforeRaw, afterRaw, priorRaw) {
  need2(plans.has(plan));
  const before = history(beforeRaw), after = history(afterRaw);
  history(priorRaw);
  need2(before.length === 440 && before.filter((r) => r.rolled_back_at === null).length === 439 && after.length === 445 && after.filter((r) => r.rolled_back_at === null).length === 444 && sha4(priorRaw) === sha4(beforeRaw) && run?.format === "sabalan-owned-protected-migration-run/v1" && run.protectedMigrationsCompleted === true && run.pendingCount === 5 && Array.isArray(run.steps) && run.steps.length === 5 && same3(run.validatedAlreadyApplied, [hr]) && Array.isArray(run.historicalInspections) && run.historicalInspections.length === 1 && typeof run.historicalInspections[0]?.file === "string" && run.historicalInspections[0].file.length > 0 && hex2(run.historicalInspections[0].sha256) && same3(run.history, {
    before: { rows: 440, appliedRows: 439, sha256: sha4(beforeRaw) },
    after: { rows: 445, appliedRows: 444, sha256: sha4(afterRaw) },
    priorProjectionSha256: sha4(priorRaw),
    priorProjectionUnchanged: true
  }));
  const oldIds = new Set(before.map((r) => r.id)), added = after.filter((r) => !oldIds.has(r.id));
  need2(added.length === 5 && same3(after.filter((r) => oldIds.has(r.id)), before));
  const oldHr = before.filter((r) => r.migration_name === hr && r.rolled_back_at === null);
  need2(oldHr.length === 1 && oldHr[0].logs === null);
  for (let i = 0; i < plan.steps.length; i++) {
    const input = plan.steps[i], step = run.steps[i], rows = added.filter((r) => r.migration_name === input.migrationName);
    need2(!before.some((r) => r.migration_name === input.migrationName && r.rolled_back_at === null) && rows.length === 1);
    const row = rows[0];
    need2(row.checksum === input.sqlSha256 && row.rolled_back_at === null && row.finished_at !== null && row.applied_steps_count === 1 && typeof row.logs === "string");
    const receipt = JSON.parse(row.logs);
    need2(receipt?.format === "sabalan-protected-bridge/v1" && receipt.sqlSha256 === input.sqlSha256 && hex2(receipt.catalogSha256) && same3(Object.keys(receipt).sort(), ["format", "sqlSha256", "catalogSha256"].sort()) && step?.migrationName === input.migrationName && step.sqlSha256 === input.sqlSha256 && step.applied === true && same3(step.nativeRow, row) && same3(step.ownedReceipt, receipt));
  }
  return Object.freeze({
    format: "sabalan-protected-financial-native-data/v1",
    strategy: plan.strategy,
    sourceCatalogSha256: plan.sourceCatalogSha256,
    originalHistorySha256: sha4(beforeRaw),
    currentHistorySha256: sha4(afterRaw),
    originalRows: 440,
    currentRows: 445,
    originalAppliedRows: 439,
    currentAppliedRows: 444,
    financialSchemaQualified: false,
    productionAdmission: false,
    requiresOriginalOldAndNewHttpProof: true
  });
}
var import_node_crypto12, pending, hr, sha4, hex2, canonical6, same3, plans;
var init_protectedFinancialMigrationEvidence = __esm({
  "backend/src/services/protectedFinancialMigrationEvidence.ts"() {
    "use strict";
    import_node_crypto12 = require("node:crypto");
    init_protectedBridgeMigrationCompiler();
    pending = Object.freeze([
      "20261014140000_online_deployment_control",
      "20261019010000_customer_semantic_barrier",
      "20261019020000_hr_versioned_file_cleanup",
      "20261020010000_online_realtime_completion",
      "20261020093000_online_serving_epochs"
    ]);
    hr = "20261014120000_hr_vehicle_assignment_plans";
    sha4 = (v) => (0, import_node_crypto12.createHash)("sha256").update(v).digest("hex");
    hex2 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    canonical6 = (v) => Array.isArray(v) ? v.map(canonical6) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical6(v[k])])) : v;
    same3 = (a, b) => JSON.stringify(canonical6(a)) === JSON.stringify(canonical6(b));
    plans = /* @__PURE__ */ new WeakSet();
  }
});

// backend/src/services/protectedFinancialQualificationProvenance.ts
function need3(v) {
  if (!v) throw Error("PROTECTED_FINANCIAL_ORIGINAL_PROVENANCE_UNPROVEN");
}
function original(record, outer = true) {
  need3(record && record.code === 0 && record.signal === null && record.stdoutEof === true && record.stderrEof === true && (outer ? record.observationFault === null : record.observationFault === void 0) && record.killed === false && Number.isSafeInteger(record.originalPid) && record.originalPid > 0);
}
function child(closure, db) {
  need3(closure && closure.code === 0 && closure.signal === null && closure.stdoutEof === true && closure.stderrEof === true && closure.originalParentControlUnchanged === true && closure.cleanupPending === true && closure.productionAdmission === false && closure.independentPointHealthy === false);
  const active = Buffer.from(closure.activeNativeRawBase64 ?? "", "base64"), final = Buffer.from(closure.finalNativeRawBase64 ?? "", "base64");
  need3(active.toString("base64") === closure.activeNativeRawBase64 && final.toString("base64") === closure.finalNativeRawBase64);
  const a = JSON.parse(active.toString());
  const receipt = parseRestoredQaBGuardianClosure(active, final, { pid: closure.originalGuardianPid, startTicks: a.guardian.startTicks, commandSha256: a.commandSha256, database: db });
  need3(same4(receipt, closure.native) && Number.isSafeInteger(closure.originalNodePid) && closure.originalNodePid > 0 && closure.nativeGuardianSourceSha256 === "7812ebf703fd3c68f0fa7e3d595034a8b27166e16865718934d284ca626d8865");
  return receipt;
}
function verifyProtectedFinancialQualification(certificate, keyRaw, artifacts, b) {
  need3(b?.format === "sabalan-protected-financial-binding/v1" && database(b.sourceDatabase) && database(b.restoredDatabase) && database(b.controllerDatabase) && b.sourceDatabase.systemIdentifier !== b.restoredDatabase.systemIdentifier && !same4(b.controllerDatabase, b.restoredDatabase) && /^[a-f0-9]{64}$/.test(b.currentContainerId) && /^sha256:[a-f0-9]{64}$/.test(b.currentExecutionImage) && /^[a-f0-9]{40}$/.test(b.sourceCommit));
  for (const field of ["sourceCheckpointMetadataSha256", "sourceCheckpointChecksum", "workerSourceSha256", "controllerSourceSha256", "callbackSourceSha256", "currentMaterialReceiptSha256", "currentCompiledReceiptSha256", "currentImageReceiptSha256", "currentFileMapSha256"]) need3(hex3(b[field]));
  need3(certificate.length > 0 && certificate.length <= 65536 && keyRaw.length > 0 && keyRaw.length <= 4096 && same4(Object.keys(artifacts).sort(), [...fields].sort()));
  const artifactHashes = {};
  for (const name of fields) {
    const raw2 = artifacts[name];
    need3(Buffer.isBuffer(raw2) && raw2.length <= protectedFinancialArtifactMaximum(name) && (name === "workerStderr" || raw2.length > 0));
    artifactHashes[name] = sha5(raw2);
  }
  const envelope = JSON.parse(certificate.toString()), d = envelope.decision;
  need3(same4(Object.keys(envelope).sort(), ["decision", "format", "signature"]) && envelope.format === "sabalan-signed-protected-financial-qualification/v1" && d?.format === "sabalan-protected-financial-qualified/v1" && same4(Object.keys(d).sort(), ["artifacts", "bindingSha256", "financialSchemaQualified", "format", "issuedAt", "productionAdmission", "purpose"].sort()) && d.purpose === "ORIGINAL_CLOSED_RESTORED_QA_FINANCIAL" && d.financialSchemaQualified === true && d.productionAdmission === false && d.bindingSha256 === hash6(b) && same4(d.artifacts, artifactHashes) && typeof d.issuedAt === "string" && new Date(d.issuedAt).toISOString() === d.issuedAt && Date.parse(d.issuedAt) <= Date.now());
  const key = (0, import_node_crypto13.createPublicKey)(keyRaw), signature = Buffer.from(envelope.signature ?? "", "base64");
  need3(key.asymmetricKeyType === "ed25519" && signature.length === 64 && signature.toString("base64") === envelope.signature && (0, import_node_crypto13.verify)(null, Buffer.concat([Buffer.from("sabalan-protected-financial-qualified/v1\n"), encode2(d)]), key, signature));
  const owner = JSON.parse(artifacts.workerOriginal.toString());
  original(owner);
  need3(owner.format === "sabalan-original-protected-financial-closure/v1" && owner.workerSourceSha256 === b.workerSourceSha256 && owner.controllerSourceSha256 === b.controllerSourceSha256 && owner.stdoutSha256 === artifactHashes.workerStdout && owner.stderrSha256 === artifactHashes.workerStderr && owner.stdoutRawBase64 === artifacts.workerStdout.toString("base64") && owner.stderrRawBase64 === artifacts.workerStderr.toString("base64"));
  const active = JSON.parse(artifacts.outerActive.toString());
  parseRestoredQaBGuardianClosure(artifacts.outerActive, artifacts.outerFinal, { role: "control", pid: owner.nativeGuardianPid, startTicks: owner.nativeGuardianStartTicks, commandSha256: owner.nativeCommandSha256, database: b.controllerDatabase });
  need3(active.guardian.pid === owner.nativeGuardianPid);
  const lines = artifacts.workerStdout.toString().split("\n");
  need3(lines.pop() === "" && lines.length === 3);
  const frames = lines.map((line) => JSON.parse(line));
  need3(frames.every((f) => /^[a-f0-9]{64}$/.test(f.session) && f.session === frames[0].session) && frames[0].event === "HR_REQUEST" && frames[0].sequence === 1 && frames[1].event === "CALLBACK_DRAINED" && frames[1].sequence === 2 && frames[2].event === "RESTORE_RESULT" && frames[2].sequence === 3);
  const result = frames[2].result, partial = result?.privateQa?.value, privateProof = JSON.parse(artifacts.privateProof.toString()), checkpoint = JSON.parse(artifacts.sourceCheckpoint.toString());
  need3(frames[0].format === "sabalan-original-active-restored-qa-hr-request/v1" && frames[1].format === "sabalan-original-active-restored-qa-hr-drained/v1" && frames[2].format === "sabalan-original-active-restored-qa-result/v1" && same4(frames[0].proof, privateProof.proof) && same4(frames[0].manifest, checkpoint.manifest) && same4(frames[0].targetDatabase, b.restoredDatabase));
  need3(result?.format === "sabalan-strict-local-complete-validation/v1" && result.strictCompleteValidationSucceeded === true && result.databaseAbsent === true && result.baseClientFinallyDisconnected === true && result.financialSchemaQualified === false && result.productionAdmission === false && result.privateProof?.sha256 === artifactHashes.privateProof);
  need3(result.absence?.visible === true && result.absence.name === b.restoredDatabase.name && result.absence.oid === null && result.absence.systemIdentifier === b.restoredDatabase.systemIdentifier && ["sessions", "transactions", "prepared"].every((k) => result.absence[k] === 0));
  need3(artifactHashes.sourceCheckpoint === b.sourceCheckpointMetadataSha256 && checkpoint.checksum === b.sourceCheckpointChecksum && same4(checkpoint.sourceDatabase, b.sourceDatabase) && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.manifestReadable === true && checkpoint.manifest?.packageType === "COMPLETE" && same4(privateProof.manifest, checkpoint.manifest) && same4(privateProof.proof?.database, b.restoredDatabase));
  original(privateProof.proof.originalRestore, false);
  need3(privateProof.proof.originalRestore.format === "sabalan-owned-native-recovery-command/v1" && privateProof.proof.originalRestore.stdoutBytes >= 0 && privateProof.proof.originalRestore.stderrBytes >= 0);
  need3(partial?.format === "sabalan-restored-qa-financial-domain-partial/v1" && same4(partial.database, b.restoredDatabase) && partial.financialSchemaQualified === false && partial.productionAdmission === false && partial.cleanupPending === true && partial.outerOriginalClosurePending === true && partial.financialDomainHttpObserved === true && partial.postHttpCatalogRevalidationPending === false && partial.decimalBalanced === true && partial.workingFilesUnchanged === true && hex3(partial.workingFilesSha256));
  const n = partial.native;
  need3(n?.format === "sabalan-protected-financial-native-data/v1" && n.strategy === "sabalan-protected-owned-financial/v1" && n.originalRows === 440 && n.currentRows === 445 && n.originalAppliedRows === 439 && n.currentAppliedRows === 444 && n.financialSchemaQualified === false && n.originalHistorySha256 === privateProof.proof.rawHistorySha256 && hex3(n.currentHistorySha256));
  const evidence = partial.ownedMigrationEvidence;
  need3(evidence && typeof evidence.historyRaw?.before === "string" && evidence.historyRaw.before === privateProof.proof.rawHistoryJson && partial.pendingSql && Object.keys(partial.pendingSql).length === 5);
  const sql = new Map(Object.entries(partial.pendingSql).map(([name, value]) => {
    need3(typeof value === "string" && value.length <= 1398104);
    const raw2 = Buffer.from(value, "base64");
    need3(raw2.toString("base64") === value);
    return [name, raw2];
  })), plan = compileProtectedFinancialMigrationPlan(sql);
  need3(same4(verifyProtectedFinancialNativeRun(plan, evidence.run, evidence.historyRaw.before, evidence.historyRaw.after, evidence.historyRaw.prior), n));
  const catalog = partial.catalog;
  need3(catalog?.format === "sabalan-restored-qa-private-normal-catalog/v1" && catalog.readOnly === true && same4(catalog.database, b.restoredDatabase) && catalog.nativeHistorySha256 === n.currentHistorySha256 && Array.isArray(catalog.catalogs) && catalog.catalogs.length === 5 && new Set(catalog.catalogs.map((v) => v.migrationName)).size === 5 && catalog.catalogs.every((v) => hex3(v.sqlSha256) && hex3(v.catalogSha256)));
  for (let i = 0; i < plan.steps.length; i++) need3(catalog.catalogs[i].migrationName === plan.steps[i].migrationName && catalog.catalogs[i].sqlSha256 === plan.steps[i].sqlSha256 && catalog.catalogs[i].catalogSha256 === evidence.run.steps[i].ownedReceipt.catalogSha256);
  const old = partial.http?.oldOriginal, next = partial.http?.newOriginal;
  const oldNative = child(old, b.restoredDatabase), newNative = child(next, b.restoredDatabase);
  need3(oldNative.namespace !== newNative.namespace && old.originalGuardianPid !== next.originalGuardianPid && old.applicationGraph?.kind === "OLD_89DD" && old.applicationGraph.sourceImage === "sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186" && old.applicationGraph.sourceCommit === "7af34849e2aff4a23a32adb7387bf99283c3864e" && old.applicationGraph.materialReceiptSha256 === "8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d" && old.applicationGraph.baseInventorySha256 === "37f58e13131ada8a8afdd99a202c6592f3dfbf3dbd4b9dddcd9ef2abf16df3d1");
  const material = JSON.parse(artifacts.currentMaterial.toString()), compiled = JSON.parse(artifacts.currentCompiled.toString()), image2 = JSON.parse(artifacts.currentImage.toString()), inspect = JSON.parse(artifacts.currentInspect.toString()), projection = installedRuntimeReceiptProjection(artifacts.currentMaterial);
  need3(artifactHashes.currentMaterial === b.currentMaterialReceiptSha256 && artifactHashes.currentCompiled === b.currentCompiledReceiptSha256 && artifactHashes.currentImage === b.currentImageReceiptSha256 && material.compiledReceiptSha256 === b.currentCompiledReceiptSha256 && compiled.pass === true && compiled.sourceUnchanged === true && compiled.sources?.["backend/src/scripts/restored-qa-financial-qualification.ts"] === b.callbackSourceSha256 && image2.pass === true && image2.sourceUnchanged === true && image2.sourceCommit === b.sourceCommit && image2.materialReceiptSha256 === b.currentMaterialReceiptSha256 && image2.image?.id === b.currentExecutionImage && inspect.Id === b.currentContainerId && inspect.Image === b.currentExecutionImage && inspect.Config?.Labels?.["io.sabalan.compact.source-commit"] === b.sourceCommit);
  need3(next.applicationGraph?.kind === "CURRENT_INSTALLED" && next.applicationGraph.imageProvenanceClaimed === false && next.applicationGraph.materialReceiptSha256 === b.currentMaterialReceiptSha256 && next.applicationGraph.fileMapSha256 === b.currentFileMapSha256 && projection.fileMapSha256 === b.currentFileMapSha256 && projection.files.length === next.applicationGraph.fileCount);
  need3(partial.http.initialBalance === "9007199254740993" && partial.http.finalBalance === partial.http.initialBalance && partial.http.oldAndNewWritersObserved === true && partial.http.idempotentPostsObserved === 2 && partial.originalBusinessRows?.preserved === true && hex3(partial.originalBusinessRows.sha256) && partial.sequence?.conserved === true && partial.sequence.canonicalPostedVouchers === 3 && partial.sequence.currentNextNumber === partial.sequence.originalNextNumber + 3 && Array.isArray(partial.vouchers) && partial.vouchers.length === 3 && new Set(partial.vouchers.map((v) => v.id)).size === 3 && partial.http.voucherIds?.length === 2 && partial.http.voucherIds.every((id) => partial.vouchers.some((v) => v.id === id)));
  need3(Array.isArray(partial.http.events) && partial.http.events.length === 9 && partial.http.events.filter((v) => v.method === "POST").length === 4 && partial.http.events.every((v) => v.status === 200 && hex3(v.pathSha256) && hex3(v.responseSha256) && v.responseBytes > 0 && v.responseBytes <= 1048576));
  const qualified2 = Object.freeze({ format: "sabalan-original-protected-financial-qualified/v1", financialSchemaQualified: true, productionAdmission: false, sourceDatabase: b.sourceDatabase, restoredDatabase: b.restoredDatabase, sourceCheckpointMetadataSha256: b.sourceCheckpointMetadataSha256, sourceCheckpointChecksum: b.sourceCheckpointChecksum, currentHistorySha256: n.currentHistorySha256, certificateSha256: sha5(certificate), bindingSha256: hash6(b), sourceCommit: b.sourceCommit, currentExecutionImage: b.currentExecutionImage, originalHistoryRaw: evidence.historyRaw.before, steps: Object.freeze(plan.steps.map((s) => Object.freeze({ ...s }))), catalogs: Object.freeze(catalog.catalogs.map((c) => Object.freeze({ ...c }))) });
  verifiedQualifications.add(qualified2);
  return qualified2;
}
function protectedFinancialArtifactMaximum(name) {
  return (name === "currentCompiled" ? 32 : name === "workerStdout" ? 40 : 16) * 1024 * 1024;
}
function assertProtectedFinancialQualificationSource(source, b, artifacts, certificate) {
  need3(source?.format === "sabalan-protected-financial-qualification/v1" && source.productionAdmission === false && source.qualificationComplete === true && source.evidence && same4(Object.keys(source.evidence).sort(), [...fields, "certificate"].sort()));
  for (const name of protectedFinancialArtifactNames) {
    const d = source.evidence[name], raw2 = name === "certificate" ? certificate : artifacts[name];
    need3(d && same4(Object.keys(d).sort(), ["bytes", "file", "sha256"]) && typeof d.file === "string" && /^[a-z0-9][a-z0-9_.-]{0,95}$/.test(d.file) && Number.isSafeInteger(d.bytes) && d.bytes >= 0 && d.bytes === raw2?.length && d.sha256 === sha5(raw2));
  }
  const file = ONLINE_QUALIFICATION_PUBLIC_KEY;
  need3(process.platform === "linux" && process.getuid?.() === 0 && import_node_fs4.default.realpathSync(file) === file);
  const fd = import_node_fs4.default.openSync(file, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NOFOLLOW | import_node_fs4.default.constants.O_NONBLOCK);
  let key;
  try {
    const before = import_node_fs4.default.fstatSync(fd, { bigint: true });
    need3(before.isFile() && before.uid === 0n && before.nlink === 1n && (before.mode & 0o777n) === 0o444n && before.size > 0n && before.size <= 4096n);
    key = import_node_fs4.default.readFileSync(fd);
    const after = import_node_fs4.default.fstatSync(fd, { bigint: true }), named = import_node_fs4.default.lstatSync(file, { bigint: true });
    for (const field of ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "uid", "nlink"]) need3(before[field] === after[field] && before[field] === named[field]);
  } finally {
    import_node_fs4.default.closeSync(fd);
  }
  return verifyProtectedFinancialQualification(certificate, key, artifacts, b);
}
function openProtectedFinancialQualificationDirectory(directory, expected) {
  need3(process.platform === "linux" && process.getuid?.() === 0 && hex3(expected.sourceSha256) && directory.startsWith("/") && import_node_fs4.default.realpathSync(directory) === directory);
  const root = import_node_fs4.default.lstatSync(directory, { bigint: true }), pins = [], inventory = [];
  const identity2 = (st) => ["dev", "ino", "size", "mtimeNs", "ctimeNs", "mode", "uid", "nlink"].map((k) => String(st[k])).join(":");
  need3(root.isDirectory() && !root.isSymbolicLink() && root.uid === 0n && (root.mode & 0o777n) === 0o700n);
  const read2 = (name, maximum, expectedSha, allowEmpty = false) => {
    need3(/^[a-z0-9][a-z0-9_.-]{0,95}$/.test(name) && hex3(expectedSha));
    const file = directory + "/" + name, fd = import_node_fs4.default.openSync(file, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NOFOLLOW | import_node_fs4.default.constants.O_NONBLOCK);
    try {
      const before = import_node_fs4.default.fstatSync(fd, { bigint: true }), named = import_node_fs4.default.lstatSync(file, { bigint: true });
      need3(before.isFile() && before.nlink === 1n && before.uid === 0n && (before.mode & 0o777n) === 0o400n && before.size >= (allowEmpty ? 0n : 1n) && before.size <= BigInt(maximum) && identity2(before) === identity2(named));
      const chunks = [];
      let remaining = Number(before.size);
      while (remaining) {
        const chunk = Buffer.alloc(Math.min(512 * 1024, remaining)), count = import_node_fs4.default.readSync(fd, chunk, 0, chunk.length, null);
        need3(count > 0);
        chunks.push(chunk.subarray(0, count));
        remaining -= count;
      }
      need3(import_node_fs4.default.readSync(fd, Buffer.alloc(1), 0, 1, null) === 0);
      const raw3 = Buffer.concat(chunks);
      need3(sha5(raw3) === expectedSha && identity2(before) === identity2(import_node_fs4.default.fstatSync(fd, { bigint: true })) && identity2(named) === identity2(import_node_fs4.default.lstatSync(file, { bigint: true })));
      inventory.push({ file: name, bytes: raw3.length, sha256: expectedSha });
      pins.push(() => {
        const current = import_node_fs4.default.openSync(file, import_node_fs4.default.constants.O_RDONLY | import_node_fs4.default.constants.O_NOFOLLOW | import_node_fs4.default.constants.O_NONBLOCK);
        try {
          need3(identity2(import_node_fs4.default.fstatSync(current, { bigint: true })) === identity2(before) && identity2(import_node_fs4.default.lstatSync(file, { bigint: true })) === identity2(named) && sha5(import_node_fs4.default.readFileSync(current)) === expectedSha && identity2(import_node_fs4.default.fstatSync(current, { bigint: true })) === identity2(before));
        } finally {
          import_node_fs4.default.closeSync(current);
        }
      });
      return raw3;
    } finally {
      import_node_fs4.default.closeSync(fd);
    }
  };
  const source = JSON.parse(read2("protected-financial-source.json", 8 * 1024 * 1024, expected.sourceSha256).toString());
  need3(source?.evidence && same4(Object.keys(source.evidence).sort(), protectedFinancialArtifactNames.slice().sort()));
  const raw2 = {};
  for (const name of protectedFinancialArtifactNames) {
    const d = source.evidence[name];
    need3(d && same4(Object.keys(d).sort(), ["bytes", "file", "sha256"]) && d.file === "protected-financial-" + name.toLowerCase() + ".json");
    raw2[name] = read2(d.file, name === "certificate" ? 65536 : protectedFinancialArtifactMaximum(name), d.sha256, name === "workerStderr");
    need3(raw2[name].length === d.bytes);
  }
  const { certificate, ...artifacts } = raw2, qualification = assertProtectedFinancialQualificationSource(source, expected.binding, artifacts, certificate);
  const revalidate = () => {
    need3(identity2(import_node_fs4.default.lstatSync(directory, { bigint: true })) === identity2(root));
    for (const check of pins) check();
  };
  revalidate();
  return Object.freeze({ qualification, evidenceInventory: Object.freeze(inventory.map((v) => Object.freeze(v))), sourceSha256: expected.sourceSha256, revalidate });
}
var import_node_fs4, import_node_crypto13, canonical7, encode2, sha5, hash6, same4, hex3, verifiedQualifications, fields, database, protectedFinancialArtifactNames;
var init_protectedFinancialQualificationProvenance = __esm({
  "backend/src/services/protectedFinancialQualificationProvenance.ts"() {
    "use strict";
    import_node_fs4 = __toESM(require("node:fs"));
    import_node_crypto13 = require("node:crypto");
    init_onlineQualificationProvenance();
    init_restoredQaHttpObservation();
    init_restoredQaInstalledRuntimeFiles();
    init_protectedFinancialMigrationEvidence();
    canonical7 = (v) => Array.isArray(v) ? v.map(canonical7) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical7(v[k])])) : v;
    encode2 = (v) => Buffer.from(JSON.stringify(canonical7(v)));
    sha5 = (b) => (0, import_node_crypto13.createHash)("sha256").update(b).digest("hex");
    hash6 = (v) => sha5(encode2(v));
    same4 = (a, b) => encode2(a).equals(encode2(b));
    hex3 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
    verifiedQualifications = /* @__PURE__ */ new WeakSet();
    fields = ["workerStdout", "workerStderr", "workerOriginal", "outerActive", "outerFinal", "privateProof", "sourceCheckpoint", "currentMaterial", "currentCompiled", "currentImage", "currentInspect"];
    database = (v) => v && same4(Object.keys(v).sort(), ["name", "oid", "systemIdentifier"]) && Object.values(v).every((x) => typeof x === "string") && /^[A-Za-z0-9_]{1,63}$/.test(v.name) && /^[1-9][0-9]*$/.test(v.oid) && /^[1-9][0-9]*$/.test(v.systemIdentifier);
    protectedFinancialArtifactNames = Object.freeze([...fields, "certificate"]);
  }
});

// backend/src/services/onlineQualificationEvidence.ts
function fail5() {
  throw Error("ONLINE_QUALIFICATION_SEMANTICS_UNPROVEN");
}
function validDatabase(value, oid) {
  return value && same5(Object.keys(value).sort(), oid ? ["name", "oid", "systemIdentifier"] : ["name", "systemIdentifier"]) && typeof value.name === "string" && /^[A-Za-z0-9_]{1,63}$/.test(value.name) && typeof value.systemIdentifier === "string" && /^[1-9][0-9]*$/.test(value.systemIdentifier) && (!oid || typeof value.oid === "string" && /^[1-9][0-9]*$/.test(value.oid));
}
function rawJson(value, maximum = 65536) {
  if (typeof value !== "string" || !value.length || value.length > maximum) fail5();
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) fail5();
  return JSON.parse(bytes.toString("utf8"));
}
function liveRestoredDirectoryJoin(source, proof, baseline, restore, baselineRaw) {
  const join = proof.liveFinalJoin;
  const exact4 = (v, keys) => v && typeof v === "object" && !Array.isArray(v) && same5(Object.keys(v).sort(), keys.slice().sort());
  const sha6 = (raw2) => (0, import_node_crypto14.createHash)("sha256").update(raw2).digest("hex");
  const decode = (v, max) => {
    if (typeof v !== "string" || v.length > Math.ceil(max / 3) * 4 + 4) fail5();
    const b = Buffer.from(v, "base64");
    if (b.length < 1 || b.length > max || b.toString("base64") !== v) fail5();
    return b;
  };
  const json = (v, max) => JSON.parse(decode(v, max).toString("utf8"));
  if (!exact4(join, ["format", "baselineCompletion", "baselineOriginalRawBase64", "baselineNativeSha256", "workerStdoutRawBase64", "workerOriginalRawBase64", "ownerResultRawBase64", "ownerOriginalRawBase64", "ownerStdoutRawBase64", "completeManifestValueRawBase64", "workingManifestValueRawBase64"]) || join.format !== "sabalan-original-live-restored-qa-final-join/v1" || baseline.captureSource !== "live-verified-complete-restored-qa" || !exact4(baseline.restoredQaLineage, ["format", "sourceDatabase", "targetDatabase", "completeManifestSha256", "nativeHistorySha256", "workingManifestSha256", "cleanupPending", "independentPointHealthy", "productionAdmission"])) fail5();
  const lineage = baseline.restoredQaLineage;
  const completeValueRaw = decode(join.completeManifestValueRawBase64, 8 * 1024 * 1024), workingValueRaw = decode(join.workingManifestValueRawBase64, 8 * 1024 * 1024);
  const completeValue = JSON.parse(completeValueRaw.toString("utf8")), workingValue = JSON.parse(workingValueRaw.toString("utf8"));
  if (JSON.stringify(completeValue) !== completeValueRaw.toString("utf8") || JSON.stringify(workingValue) !== workingValueRaw.toString("utf8") || !same5(completeValue, source.checkpointMetadata.manifest) || !same5(workingValue, { database: lineage.targetDatabase, sources: baseline.sources.map((r) => ({ name: r.name, files: r.files, directories: r.directories })) })) fail5();
  if (lineage.format !== "sabalan-live-restored-qa-private-lineage/v1" || lineage.cleanupPending !== true || lineage.independentPointHealthy !== false || lineage.productionAdmission !== false || !same5(lineage.sourceDatabase, source.checkpointMetadata.sourceDatabase) || !same5(lineage.targetDatabase, source.restoredDatabase) || lineage.sourceDatabase.systemIdentifier === lineage.targetDatabase.systemIdentifier || lineage.completeManifestSha256 !== sha6(completeValueRaw) || baseline.capturedManifest?.sha256 !== lineage.completeManifestSha256 || lineage.workingManifestSha256 !== sha6(workingValueRaw)) fail5();
  const completion = join.baselineCompletion;
  if (completion?.event !== "restored-file-baseline-complete" || completion.manifestSha256 !== sha6(baselineRaw) || completion.capturedManifestSha256 !== lineage.completeManifestSha256 || completion.productionAdmission !== false || !Array.isArray(completion.proofs) || completion.proofs.length !== 9) fail5();
  const original2 = source.originalNativeClosures.filter((c) => c.runtimeId === completion.runtimeId);
  if (original2.length !== 1 || sha6(Buffer.from(original2[0].nativeRawBase64, "base64")) !== join.baselineNativeSha256) fail5();
  const baselineNative = rawJson(original2[0].nativeRawBase64);
  if (baselineNative.onlineScope?.scope?.purpose !== "jobs" || baselineNative.onlineScope.scope.role !== "control") fail5();
  const baselineOriginal = json(join.baselineOriginalRawBase64, 8 * 1024 * 1024);
  if (baselineOriginal.format !== "sabalan-original-independent-private-runtime/v1" || baselineOriginal.event !== "CLOSED" || baselineOriginal.mode !== "baseline" || !same5(baselineOriginal.result, completion) || baselineOriginal.originalPopenPid !== original2[0].originalPopenPid || baselineOriginal.originalReturncode !== 0 || ["nativeRawBase64", "workRawBase64", "workClaimRawBase64", "workScopeRawBase64"].some((k) => baselineOriginal[k] !== original2[0][k])) fail5();
  const names = /* @__PURE__ */ new Set();
  for (const row of completion.proofs) {
    if (typeof row.name !== "string" || names.has(row.name) || row.publicOnlineAdmission !== false || !digest3(row.sha256) || baseline.sources.filter((s) => s.name === row.name).length !== 1) fail5();
    names.add(row.name);
  }
  const workerRaw = decode(join.workerStdoutRawBase64, 8 * 1024 * 1024), lines = workerRaw.toString("utf8").split("\n");
  if (lines.pop() !== "" || lines.length !== 3) fail5();
  const frames = lines.map((line) => JSON.parse(line));
  for (let i = 0; i < 3; i++) if (frames[i].sequence !== i + 1 || frames[i].session !== frames[0].session || !digest3(frames[i].session)) fail5();
  if (frames[0].event !== "HR_REQUEST" || frames[0].format !== "sabalan-original-active-restored-qa-hr-request/v1" || frames[1].event !== "CALLBACK_DRAINED" || frames[1].format !== "sabalan-original-active-restored-qa-hr-drained/v1" || frames[2].event !== "RESTORE_RESULT" || frames[2].format !== "sabalan-original-active-restored-qa-result/v1" || !same5(frames[0].manifest, source.checkpointMetadata.manifest) || !same5(frames[0].targetDatabase, lineage.targetDatabase) || !same5(frames[0].proof?.database, lineage.targetDatabase) || frames[0].proof.cleanupPending !== true || frames[0].proof.productionAdmission !== false || frames[0].proof.sourceAuthorityAuthenticated !== false || frames[0].proof.format !== "sabalan-private-native-complete-ledger439-proof/v1" || frames[0].proof.nativeRowsCompared !== 440 || frames[0].proof.activeRows !== 439 || frames[0].proof.rollbackRows !== 1 || frames[0].proof.sourceCatalogMigrations !== 444 || typeof frames[0].proof.rawHistoryJson !== "string" || sha6(frames[0].proof.rawHistoryJson) !== lineage.nativeHistorySha256 || frames[0].proof.rawHistorySha256 !== lineage.nativeHistorySha256) fail5();
  if (!Array.isArray(JSON.parse(frames[0].proof.rawHistoryJson)) || JSON.parse(frames[0].proof.rawHistoryJson).length !== 440) fail5();
  const pg = frames[0].proof.originalRestore;
  if (pg?.format !== "sabalan-owned-native-recovery-command/v1" || pg.code !== 0 || pg.signal !== null || pg.stdoutEof !== true || pg.stderrEof !== true || pg.killed !== false || pg.observationFault !== void 0) fail5();
  const result = frames[2].result, absence = result?.absence;
  if (result?.format !== "sabalan-strict-local-complete-validation/v1" || result.strictCompleteValidationSucceeded !== true || result.databaseAbsent !== true || result.baseClientFinallyDisconnected !== true || result.productionAdmission !== false || result.financialSchemaQualified !== false || absence?.visible !== true || absence.name !== lineage.targetDatabase.name || absence.oid !== null || absence.systemIdentifier !== lineage.targetDatabase.systemIdentifier || ["sessions", "transactions", "prepared"].some((k) => absence[k] !== 0)) fail5();
  const worker = json(join.workerOriginalRawBase64, 8 * 1024 * 1024), owner = json(join.ownerOriginalRawBase64, 131072);
  const closed = (v) => Number.isSafeInteger(v.originalPid) && v.originalPid > 1 && v.code === 0 && v.signal === null && v.stdoutEof === true && v.stderrEof === true && v.observationFault === null && v.killed === false;
  const collectedOwner = owner.format === "sabalan-original-complete-owner-closure/v1";
  if (!closed(owner) || !collectedOwner && owner.format !== "sabalan-original-existing-compose-complete-owner/v1" || owner.interrupted !== false || !closed(worker) || worker.format !== "sabalan-original-protected-financial-closure/v1" || worker.stdoutSha256 !== sha6(workerRaw) || worker.stdoutRawBase64 !== workerRaw.toString("base64") || worker.stderrRawBase64 !== "" || worker.stderrSha256 !== sha6(Buffer.alloc(0))) fail5();
  const ownerRaw = decode(join.ownerResultRawBase64, 8 * 1024 * 1024), ownerResult = JSON.parse(ownerRaw.toString("utf8"));
  const ownerStdout = decode(join.ownerStdoutRawBase64, 131072);
  let ownerReference;
  if (collectedOwner) {
    const lines2 = ownerStdout.toString("utf8").split("\n");
    if (lines2.pop() !== "" || lines2.length !== 2) fail5();
    const ready = JSON.parse(lines2[0]);
    ownerReference = JSON.parse(lines2[1]);
    if (!exact4(ready, ["format", "operation", "credentialsRead", "productionAdmission"]) || ready.format !== "sabalan-r9-master-private-credential-ready/v1" || ready.credentialsRead !== false || ready.productionAdmission !== false || !same5(ready.operation, ownerResult.operation) || !/^([a-f0-9]{32})$/.test(ready.operation) || !exact4(ownerReference, ["file", "sha256", "strictCompleteValidationSucceeded", "outerOriginalClosurePending", "productionAdmission"]) || ownerReference.strictCompleteValidationSucceeded !== true || ownerReference.outerOriginalClosurePending !== true || ownerReference.productionAdmission !== false) fail5();
  } else ownerReference = JSON.parse(ownerStdout.toString("utf8"));
  if (owner.stdoutSha256 !== sha6(ownerStdout) || owner.stdoutBytes !== ownerStdout.length || owner.stderrBytes !== 0 || owner.stderrSha256 !== sha6(Buffer.alloc(0)) || ownerReference.sha256 !== sha6(ownerRaw) || ownerResult.format !== "sabalan-owned-complete-transfer-strict-restore/v1" || ownerResult.strictCompleteValidationSucceeded !== true || ownerResult.temporaryTransferRetired !== true || ownerResult.localJobRetired !== true || ownerResult.productionAdmission !== false || !same5(ownerResult.protectedFinancialQualification?.binding?.sourceDatabase, lineage.sourceDatabase) || !same5(ownerResult.protectedFinancialQualification?.binding?.restoredDatabase, lineage.targetDatabase) || ownerResult.protectedFinancialQualification.binding.sourceCommit !== source.sourceCommit || worker.workerSourceSha256 !== ownerResult.protectedFinancialQualification.binding.workerSourceSha256 || worker.controllerSourceSha256 !== ownerResult.protectedFinancialQualification.binding.controllerSourceSha256 || restore.format !== "sabalan-original-existing-compose-complete-restore/v1" || restore.originalBaselineSha256 !== sha6(baselineRaw) || restore.finalOwnerResultSha256 !== sha6(ownerRaw) || restore.finalOwnerClosureSha256 !== sha6(decode(join.ownerOriginalRawBase64, 131072)) || restore.finalWorkerStdoutSha256 !== sha6(workerRaw)) fail5();
  for (const stamp of [owner.startedAt, owner.closedAt, restore.drill?.completedAt]) if (typeof stamp !== "string" || !Number.isFinite(Date.parse(stamp))) fail5();
  if (Date.parse(owner.closedAt) < Date.parse(owner.startedAt) || Date.parse(restore.drill.completedAt) < Date.parse(owner.closedAt)) fail5();
}
function protectedDirectoryRestore(source, checkpointSha256) {
  const proof = source.protectedDirectoryComponents, metadata = source.checkpointMetadata;
  const live = proof?.format === "sabalan-original-live-restored-qa-directory-restore/v1";
  if (!proof || !live && proof.format !== "sabalan-original-protected-directory-restore/v1" || proof.checkpointSha256 !== checkpointSha256 || !digest3(proof.baselineSha256) || !nonempty(proof.rootBindings) || proof.rootBindings.length !== 9) fail5();
  const restore = rawJson(proof.canonicalRestoreOutputRawBase64, 8 * 1024 * 1024), baseline = rawJson(proof.baselineRawBase64, 8 * 1024 * 1024);
  const restoreSha = (0, import_node_crypto14.createHash)("sha256").update(Buffer.from(proof.canonicalRestoreOutputRawBase64, "base64")).digest("hex");
  if ((0, import_node_crypto14.createHash)("sha256").update(Buffer.from(proof.baselineRawBase64, "base64")).digest("hex") !== proof.baselineSha256 || restore.ok !== true || !hasHealthyIndependentCheckpointDrill({ ...source.checkpoint, lastDrill: restore.drill }) || baseline.format !== "sabalan-application-restored-file-baseline/v1" || baseline.captureSource !== (live ? "live-verified-complete-restored-qa" : "canonical-complete-package") || !live && baseline.capturedManifest?.sha256 !== restoreSha || !Array.isArray(baseline.sources) || baseline.sources.length !== 9 || metadata.manifest?.format !== "sabalan-recovery" || metadata.manifest.packageType !== "COMPLETE" || !Array.isArray(metadata.manifest.components) || metadata.manifest.components.length > 25e4) fail5();
  if (live) liveRestoredDirectoryJoin(source, proof, baseline, restore, Buffer.from(proof.baselineRawBase64, "base64"));
  const finalDrill = source.checkpoint.lastDrill;
  for (const key of ["operationId", "checkpointId", "releaseId", "checksum", "size", "sourceMachineUuidSha256", "sourceKernelBootIdSha256", "recoveryMachineUuidSha256", "recoveryKernelBootIdSha256", "startedAt"])
    if (!same5(restore.drill[key], finalDrill[key])) fail5();
  if (Date.parse(restore.drill.completedAt) > Date.parse(finalDrill.completedAt)) fail5();
  const relative = (value) => typeof value === "string" && value.length > 0 && !value.startsWith("/") && !/[\\\0]/.test(value) && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
  const components = metadata.manifest.components, paths = /* @__PURE__ */ new Set();
  for (const row of components) {
    if (!relative(row.path) || paths.has(row.path) || !digest3(row.sha256) || !Number.isSafeInteger(row.size) || row.size < 0) fail5();
    paths.add(row.path);
  }
  if (!paths.has("database/main.dump") || !paths.has("inquiry/inquiry.db")) fail5();
  const retained = [
    "storage/contracts",
    "storage/hr-hiring",
    "storage/accounting-contracts",
    "storage/dispatch-documents",
    "storage/support-tickets",
    "storage/performance-exports",
    "uploads/images",
    "uploads/security-shift-log",
    "uploads/security-vehicle-pairs"
  ];
  const names = /* @__PURE__ */ new Set(), roots = /* @__PURE__ */ new Set(), restoredRoots = /* @__PURE__ */ new Set();
  for (const binding of proof.rootBindings) {
    const relativeRoot = typeof binding.sourceLiveRoot === "string" ? binding.sourceLiveRoot.slice("/app/".length) : "";
    if (!binding.sourceLiveRoot?.startsWith("/app/") || !retained.includes(relativeRoot) || roots.has(relativeRoot) || names.has(binding.name) || binding.payloadPrefix !== "files/" + relativeRoot.replace(/^storage\//, "") || !binding.restoredLiveRoot?.startsWith("/") || restoredRoots.has(binding.restoredLiveRoot) || binding.restoredLiveRoot.slice(1).split("/").some((part) => part === "" || part === "." || part === "..") || binding.restoredLiveRoot.includes("\\")) fail5();
    names.add(binding.name);
    roots.add(relativeRoot);
    restoredRoots.add(binding.restoredLiveRoot);
    const matches = baseline.sources.filter((row) => row.name === binding.name && row.liveRoot === binding.restoredLiveRoot);
    if (matches.length !== 1) fail5();
    const actual = matches[0];
    if (!Array.isArray(actual.files) || actual.files.length > 1e4 || !Array.isArray(actual.directories) || actual.directories.length > 1e4 || new Set(actual.directories).size !== actual.directories.length || actual.directories.some((value) => !relative(value))) fail5();
    const expected = components.filter((row) => row.path.startsWith(binding.payloadPrefix + "/")).map((row) => ({ key: row.path.slice(binding.payloadPrefix.length + 1), bytes: row.size, sha256: row.sha256 })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    if (!same5(actual.files, expected)) fail5();
    for (const file of actual.files) {
      if (!relative(file.key)) fail5();
      const segments = file.key.split("/");
      for (let length = 1; length < segments.length; length++) if (!actual.directories.includes(segments.slice(0, length).join("/"))) fail5();
    }
  }
  if (roots.size !== 9 || source.restoredFileRoots !== 9) fail5();
}
function originalClosures(source, expected, scopeName) {
  if (!nonempty(source.originalNativeClosures)) fail5();
  const cohort = expected.runtimeCohorts[scopeName];
  if (!nonempty(cohort) || source.originalNativeClosures.length !== cohort.length) fail5();
  const ids = /* @__PURE__ */ new Set();
  const purposes = [];
  for (const closure of source.originalNativeClosures) {
    const identities = cohort.filter((value) => value.runtimeId === closure.runtimeId);
    if (identities.length !== 1) fail5();
    const expectedRuntime = identities[0];
    if (!digest3(closure.runtimeId) || ids.has(closure.runtimeId) || !Number.isSafeInteger(closure.originalPopenPid) || closure.originalPopenPid < 1 || closure.originalReturncode !== 0 || !digest3(closure.activeClaimSha256)) fail5();
    ids.add(closure.runtimeId);
    const native = rawJson(closure.nativeRawBase64), work = rawJson(closure.workRawBase64), claim = rawJson(closure.workClaimRawBase64);
    const provision = rawJson(closure.workScopeRawBase64);
    const scope = native.onlineScope?.scope;
    if (native.format !== "sabalan-runtime-native/v1" || native.phase !== "QUIESCENT" || native.nativeReaped !== true || native.databaseQuiet !== true || native.nativeStatus !== 0 || native.stoppedBySignal !== false || native.guardian?.pid !== closure.originalPopenPid || native.activeClaimSha256 !== closure.activeClaimSha256 || native.clusterIdentifier !== expected.sourceDatabase.systemIdentifier || native.initialDatabase?.name !== expected.sourceDatabase.name || String(native.initialDatabase?.oid) !== expected.sourceDatabase.oid || scope?.runtimeId !== closure.runtimeId || scope.sourceCommit !== expectedRuntime.sourceCommit || scope.releaseId !== expectedRuntime.releaseId || scope.purpose !== expectedRuntime.purpose || scope.image !== expectedRuntime.image || scope.manifestSha256 !== expectedRuntime.runtimeBundleSha256 || native.onlineScope?.sha256 !== hash7(scope) || !(scope.purpose === "http" && scope.role === "serving" || scope.purpose === "jobs" && scope.role === "control")) fail5();
    purposes.push({
      purpose: scope.purpose,
      runtimeId: closure.runtimeId,
      native,
      closure,
      candidate: [expected.images.backend, expected.deploymentTargetImages.backend].includes(expectedRuntime.image) && expectedRuntime.sourceCommit === expected.sourceCommit && expectedRuntime.runtimeBundleSha256 === expected.runtimeBundleSha256
    });
    const active = { ...native, phase: "ACTIVE" };
    for (const key of ["activeClaimSha256", "nativeReaped", "databaseQuiet", "nativeStatus", "stoppedBySignal"]) delete active[key];
    if (hash7(active) !== closure.activeClaimSha256 || work.format !== "sabalan-runtime-boundary/v1" || work.phase !== "QUIESCENT" || work.claimSha256 !== hash7(claim) || claim.format !== "sabalan-runtime-claim/v2" || provision.format !== "sabalan-runtime-namespace/v1" || claim.scopeSha256 !== hash7(provision) || provision.scope?.runtimeId !== closure.runtimeId || provision.scope.image !== expectedRuntime.image || provision.scope.registrySha256 !== expectedRuntime.runtimeBundleSha256 || provision.scope.postgresApplicationName !== runtimeNativePostgresApplicationName(closure.runtimeId) || !same5(claim.native, closure.claimNative) || !same5(closure.claimNative, { scopeSha256: native.onlineScope.sha256, claimSha256: closure.activeClaimSha256 }) || closure.freshSql?.visible !== true || closure.freshSql.systemIdentifier !== expected.sourceDatabase.systemIdentifier || closure.freshSql.namespace !== runtimeNativePostgresApplicationName(closure.runtimeId) || String(closure.freshSql.databaseOid) !== expected.sourceDatabase.oid || closure.freshSql.namespaceSessions !== 0 || closure.freshSql.prepared !== 0) fail5();
  }
  return purposes;
}
function bridgeFanout(source, purposes) {
  const proof = rawJson(source.bridgeProofRawBase64, 2 * 1024 * 1024);
  const raw2 = Buffer.from(source.bridgeProofRawBase64, "base64"), proofSha = (0, import_node_crypto14.createHash)("sha256").update(raw2).digest("hex");
  const targetIds = source.singleWorker.targetRuntimeIds;
  if (proof.format !== "sabalan-private-pair-bridge-proof/v1" || !digest3(proof.qualificationId) || !nonempty(targetIds) || targetIds.length !== source.singleWorker.httpTargetCount || new Set(targetIds).size !== targetIds.length || !digest3(source.bridgeAfterDrain?.proofSha256) || source.bridgeAfterDrain.proofSha256 !== proofSha || source.bridgeAfterDrain.format !== "sabalan-private-pair-bridge-after-drain/v1" || source.bridgeAfterDrain.passResult !== true || source.bridgeAfterDrain.durableAcknowledgmentsUnchanged !== true || source.bridgeAfterDrain.historyUnchanged !== true) fail5();
  const actors = targetIds.map((id) => purposes.find((actor) => actor.runtimeId === id && actor.purpose === "http"));
  if (actors.some((actor) => !actor) || !actors.some((actor) => actor.candidate) || new Set(actors.map((actor) => actor.native.onlineScope.scope.image)).size < 2) fail5();
  const observations = proof.clientObservations, durable = proof.durable, ids = proof.ids;
  if (!nonempty(observations) || observations.length !== targetIds.length || !same5(observations.map((row) => row.runtimeId).sort(), [...targetIds].sort()) || observations.some((row) => row.originalSocketClosed !== true || row.authenticated !== true || !same5(row.observedEvents, ["notification.created", "hr.personnel.changed"]))) fail5();
  if (!nonempty(durable?.batches) || durable.batches.length !== 2 || !nonempty(durable.commands) || durable.commands.length !== targetIds.length * 2 || !same5(durable.batches.map((row) => row.kind).sort(), ["HR_PERSONNEL_INVALIDATION", "NOTIFICATION"]) || !ids || !same5([...ids.batchIds].sort(), durable.batches.map((row) => row.id).sort())) fail5();
  const handoff = proof.workerHandoff;
  const oldJobs = purposes.find((actor) => actor.runtimeId === handoff?.oldJobsRuntimeId && actor.purpose === "jobs" && !actor.candidate);
  const newJobs = purposes.find((actor) => actor.runtimeId === handoff?.newJobsRuntimeId && actor.purpose === "jobs" && actor.candidate);
  if (!oldJobs || !newJobs || handoff.oldNativeSha256 !== (0, import_node_crypto14.createHash)("sha256").update(Buffer.from(oldJobs.closure.nativeRawBase64, "base64")).digest("hex")) fail5();
  const nonce = (actor) => (0, import_node_crypto14.createHash)("sha256").update(actor.native.onlineScope.scope.nonce, "utf8").digest("hex");
  const commandIds = /* @__PURE__ */ new Set();
  for (const batch of durable.batches) {
    const jobs = batch.kind === "NOTIFICATION" ? oldJobs : newJobs;
    if (batch.producerRuntimeId !== jobs.runtimeId || batch.producerNonceSha256 !== nonce(jobs) || !nonempty(batch.targetsJson) || batch.targetsJson.length !== targetIds.length || !same5(batch.targetsJson.map((target) => target.runtimeId).sort(), [...targetIds].sort())) fail5();
    if (batch.targetsSha256 !== canonicalRealtimeTargets(batch.targetsJson).sha256) fail5();
    for (const target of batch.targetsJson) {
      const actor = actors.find((row) => row.runtimeId === target.runtimeId);
      const scope = actor.native.onlineScope.scope;
      if (target.nonceSha256 !== nonce(actor) || target.imageIdentity !== scope.image || target.releaseId !== scope.releaseId) fail5();
      const commands = durable.commands.filter((row) => row.batchId === batch.id && row.runtimeId === target.runtimeId);
      if (commands.length !== 1) fail5();
      const command = commands[0];
      if (command.id !== realtimeCommandId(batch.id, target) || commandIds.has(command.id) || command.status !== "SETTLED" || !command.claimToken || !command.startedAt || !command.settledAt) fail5();
      commandIds.add(command.id);
    }
  }
  if (durable.outbox?.id !== ids.outboxId || durable.outbox.status !== "PROCESSED" || !durable.outbox.processedAt || durable.intent?.id !== ids.intentId || !targetIds.includes(durable.intent.originRuntimeId) || durable.intent.sourceOutcome !== "READY" || durable.intent.deliveryStatus !== "SETTLED" || !durable.intent.sourceSettledAt || !durable.intent.deliverySettledAt || durable.personnel?.id !== ids.personnelId || durable.personnel.lastName !== ids.personnelLastName) fail5();
}
function installedBrowserRouting(source, expected) {
  const proof = source.installedRouting;
  if (proof?.format !== "sabalan-original-installed-browser-routing/v1" || !same5(proof.proofDatabase, expected.proofDatabases["single-worker-and-completion"])) fail5();
  const cohort = expected.runtimeCohorts["single-worker-and-completion"].filter((actor) => actor.purpose === "http");
  const actors = originalClosures(proof, {
    ...expected,
    sourceDatabase: proof.proofDatabase,
    runtimeCohorts: { ...expected.runtimeCohorts, "browser-24-hours": cohort }
  }, "browser-24-hours");
  if (actors.length !== 2 || !actors.some((actor) => actor.candidate) || new Set(actors.map((actor) => actor.native.onlineScope.scope.image)).size !== 2) fail5();
  const publication = rawJson(proof.publicationRawBase64, 8 * 1024 * 1024);
  const raw2 = Buffer.from(proof.publicationRawBase64, "base64");
  if (publication.format !== "sabalan-browser-publication/v1" || !Number.isSafeInteger(publication.generation) || publication.generation < 1 || publication.registry?.format !== "sabalan-browser-routing/v2" || publication.registry.generation !== publication.generation || proof.publicationSha256 !== (0, import_node_crypto14.createHash)("sha256").update(raw2).digest("hex") || !nonempty(publication.registry.builds) || !nonempty(publication.registry.apiBindings) || !nonempty(proof.executions) || proof.executions.length !== 2) fail5();
  const current = publication.registry.builds.find((build) => build.id === publication.registry.current?.erp);
  if (current?.image !== expected.images.frontend) fail5();
  const registry = publication.registry;
  const normalized = {
    format: registry.format,
    generation: registry.generation,
    current: registry.current,
    legacy: registry.legacy,
    builds: registry.builds.map((build) => ({ ...build, actionIds: [...build.actionIds].sort(), assets: [...build.assets].sort((a, b) => a.path.localeCompare(b.path)) })).sort((a, b) => a.id.localeCompare(b.id)),
    apiBindings: [...registry.apiBindings].sort((a, b) => a.buildId.localeCompare(b.buildId))
  };
  if (publication.registryIdentity !== checkpointMetadataHash(normalized)) fail5();
  const seen = /* @__PURE__ */ new Set(), builds = /* @__PURE__ */ new Set();
  for (const execution of proof.executions) {
    const actor = actors.find((actor2) => actor2.runtimeId === execution.runtimeId);
    if (!actor || seen.has(actor.runtimeId)) fail5();
    seen.add(actor.runtimeId);
    const intent = rawJson(execution.intentRawBase64), completion = rawJson(execution.completionRawBase64), client = rawJson(execution.clientRawBase64);
    const scope = actor.native.onlineScope.scope;
    const build = publication.registry.builds.find((build2) => build2.id === intent.buildId);
    const bindings = publication.registry.apiBindings.filter((binding2) => binding2.buildId === intent.buildId);
    if (!build || build.application !== "erp" || bindings.length !== 1) fail5();
    const binding = bindings[0];
    if (builds.has(build.id) || binding.slotId !== "backend_" + scope.runtimeId || binding.image !== scope.image || binding.manifestSha256 !== scope.manifestSha256 || binding.browserManifestSha256 !== build.manifestSha256 || intent.format !== "sabalan-browser-operation/v1" || intent.generation !== publication.generation || intent.registryIdentity !== publication.registryIdentity || intent.slotId !== binding.slotId || intent.image !== scope.image || intent.manifestSha256 !== scope.manifestSha256 || intent.method !== "POST" || completion.format !== "sabalan-browser-operation-completion/v1" || completion.id !== intent.id || completion.instanceId !== intent.instanceId || completion.outcome !== "UPSTREAM_ENDED" || completion.intentSha256 !== (0, import_node_crypto14.createHash)("sha256").update(Buffer.from(execution.intentRawBase64, "base64")).digest("hex") || client.format !== "sabalan-installed-browser-form-response/v1" || client.operationId !== intent.id || client.buildId !== build.id || client.image !== build.image || client.runtimeId !== scope.runtimeId || client.method !== "POST" || client.status !== 201 || client.requestCount !== 1 || client.automaticNavigation !== false || client.originalClientClosed !== true || !digest3(client.responseSha256) || !digest3(client.storedBusinessReceiptSha256)) fail5();
    builds.add(build.id);
  }
  if (!builds.has(current.id)) fail5();
}
function assertOnlineQualificationProof(scope, source, expected, financialArtifacts, financialCertificate) {
  validateProductionExecutionBindings(expected.productionExecutionBindings, expected);
  if (![expected.manifestSha256, expected.checkpointSha256, expected.checkpointArchiveChecksum, expected.runtimeBundleSha256, expected.schemaSha256, expected.captureId].every(digest3) || !/^[a-f0-9]{40}$/.test(expected.sourceCommit) || !/^[A-Za-z0-9_-]{8,128}$/.test(expected.releaseId) || !validDatabase(expected.sourceDatabase, true) || !validDatabase(expected.deploymentTargetDatabase, true) || !["PROTECTED_MAINTENANCE_COMPLETE", "ONLINE_COHERENT_WAL"].includes(expected.recoveryMode) || !same5(Object.keys(expected.images).sort(), ["backend", "frontend", "inquiry"]) || Object.values(expected.images).some((image2) => !/^sha256:[a-f0-9]{64}$/.test(image2))) fail5();
  if (!same5(Object.keys(expected.deploymentTargetImages).sort(), ["backend", "frontend", "inquiry"]) || !same5(Object.keys(expected.imageGraphs).sort(), ["backend", "frontend", "inquiry"])) fail5();
  for (const role of ["backend", "frontend", "inquiry"]) {
    const graph = expected.imageGraphs[role];
    if (!graph || !same5(Object.keys(graph).sort(), ["archiveBytes", "archiveSha256", "config", "index", "platform", "rootfsDiffIds"]) || graph.index !== expected.images[role] || graph.config !== expected.deploymentTargetImages[role] || ![graph.index, graph.platform, graph.config].every((value) => /^sha256:[a-f0-9]{64}$/.test(value)) || !digest3(graph.archiveSha256) || !Number.isSafeInteger(graph.archiveBytes) || graph.archiveBytes < 1 || !nonempty(graph.rootfsDiffIds) || graph.rootfsDiffIds.length > 128 || graph.rootfsDiffIds.some((value) => !/^sha256:[a-f0-9]{64}$/.test(value))) fail5();
  }
  if (!same5(Object.keys(expected.componentSourceCommits).sort(), ["backend", "frontend", "inquiry"]) || Object.values(expected.componentSourceCommits).some((value) => !/^[a-f0-9]{40}$/.test(value)) || expected.componentSourceCommits.backend !== expected.sourceCommit || !same5(Object.keys(expected.runtimeCohorts).sort(), ["browser-24-hours", "coherent-independent-restore", "compatible-migrations", "current-domain", "single-worker-and-completion"])) fail5();
  if (!expected.proofDatabases || !same5(Object.keys(expected.proofDatabases).sort(), Object.keys(expected.runtimeCohorts).sort()) || Object.values(expected.proofDatabases).some((database2) => !validDatabase(database2, true)) || !same5(expected.proofDatabases["compatible-migrations"], expected.sourceDatabase) || !same5(expected.proofDatabases["browser-24-hours"], expected.sourceDatabase) || same5(expected.proofDatabases["coherent-independent-restore"], expected.sourceDatabase)) fail5();
  for (const [cohortName, cohort] of Object.entries(expected.runtimeCohorts)) {
    if (!nonempty(cohort) || new Set(cohort.map((actor) => actor.runtimeId)).size !== cohort.length) fail5();
    if (!["compatible-migrations", "browser-24-hours"].includes(cohortName) && !cohort.some((actor) => [expected.images.backend, expected.deploymentTargetImages.backend].includes(actor.image) && actor.sourceCommit === expected.sourceCommit && actor.runtimeBundleSha256 === expected.runtimeBundleSha256)) fail5();
    for (const actor of cohort) if (!digest3(actor.runtimeId) || !digest3(actor.runtimeBundleSha256) || !/^[a-f0-9]{40}$/.test(actor.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(actor.image) || !/^[A-Za-z0-9_-]{8,128}$/.test(actor.releaseId) || !["http", "jobs"].includes(actor.purpose)) fail5();
  }
  if (scope === "compatible-migrations" && source?.format === "sabalan-protected-financial-qualification/v1") {
    const b = expected.protectedFinancial, point = expected.qualificationCheckpoint;
    if (!b || expected.recoveryMode !== "PROTECTED_MAINTENANCE_COMPLETE" || !point || b.sourceCheckpointMetadataSha256 !== point.metadataSha256 || b.sourceCheckpointChecksum !== point.metadata.checksum || !same5(b.sourceDatabase, expected.deploymentTargetDatabase) || b.sourceCommit !== expected.sourceCommit || b.currentExecutionImage !== expected.deploymentTargetImages.backend) fail5();
    return assertProtectedFinancialQualificationSource(source, b, financialArtifacts, financialCertificate);
  }
  if (!source || source.productionAdmission !== true || source.passResult !== true || source.executionKind !== (["compatible-migrations", "browser-24-hours"].includes(scope) ? "DIAGNOSTIC_SUPPORT" : "INSTALLED_RUNTIME") || source.manifestSha256 !== expected.manifestSha256 || source.checkpointSha256 !== expected.checkpointSha256 || source.releaseId !== expected.releaseId || source.sourceCommit !== expected.sourceCommit || source.runtimeBundleSha256 !== expected.runtimeBundleSha256 || source.schemaSha256 !== expected.schemaSha256 || source.captureId !== expected.captureId || !same5(source.sourceDatabase, expected.sourceDatabase) || source.recoveryMode !== expected.recoveryMode || !same5(source.proofDatabase, expected.proofDatabases[scope]) || !same5(source.deploymentTargetDatabase, expected.deploymentTargetDatabase) || !same5(source.images, expected.images) || !same5(source.deploymentTargetImages, expected.deploymentTargetImages) || !same5(source.imageGraphs, expected.imageGraphs) || !same5(source.productionExecutionBindings, expected.productionExecutionBindings)) fail5();
  let purposes;
  if (scope === "coherent-independent-restore") {
    const restored = source.restoredDatabase;
    if (!validDatabase(restored, true) || !same5(restored, expected.proofDatabases[scope]) || same5(restored, expected.sourceDatabase)) fail5();
    purposes = originalClosures(source, { ...expected, sourceDatabase: restored }, scope);
  } else purposes = originalClosures(source, { ...expected, sourceDatabase: expected.proofDatabases[scope] }, scope);
  switch (scope) {
    case "compatible-migrations": {
      if (source.format !== "sabalan-application-native/v1" || source.diagnosticExpansionApplied !== false || source.ownedMigration?.financialSchemaQualified !== true || !Array.isArray(source.ownedMigration.steps) || source.ownedMigration.steps.length > 1024 || !digest3(source.originalHistory?.sha256) || !digest3(source.history?.sha256) || !Number.isSafeInteger(source.originalHistory.rows) || source.originalHistory.rows < 1) fail5();
      const names = /* @__PURE__ */ new Set();
      for (const step of source.ownedMigration.steps) {
        const compiled = compileOnlineExpansion(step.plan);
        if (names.has(compiled.plan.migrationName) || step.sqlSha256 !== compiled.sqlSha256 || step.operationSha256 !== compiled.operationSha256 || step.state !== "COMPLETE" || step.oldAndNewWritersObserved !== true || step.pendingRows !== 0 || step.conflictingRows !== 0) fail5();
        names.add(compiled.plan.migrationName);
      }
      if (source.history.rows !== source.originalHistory.rows + names.size || source.priorMigrationHistorySha256 !== source.originalHistory.sha256 || !names.size && source.history.sha256 !== source.originalHistory.sha256) fail5();
      break;
    }
    case "coherent-independent-restore": {
      const point = expected.qualificationCheckpoint;
      if (point && expected.recoveryMode !== "PROTECTED_MAINTENANCE_COMPLETE") fail5();
      const checkpointSha256 = point?.metadataSha256 ?? expected.checkpointSha256;
      const checkpointChecksum = point?.metadata.checksum ?? expected.checkpointArchiveChecksum;
      const checkpointReleaseId = point?.metadata.releaseId ?? expected.releaseId;
      if (point && (!digest3(point.metadataSha256) || checkpointMetadataHash(point.metadata) !== point.metadataSha256 || !same5(point.metadata, source.checkpointMetadata))) fail5();
      const transport = rawJson(source.checkpointTransportRawBase64, 8 * 1024 * 1024);
      const canonicalMetadata = readCanonicalCheckpointMetadata(transport);
      if (canonicalMetadata.sha256 !== checkpointSha256 || !same5(canonicalMetadata.metadata, source.checkpointMetadata)) fail5();
      if (source.format !== "sabalan-native-application-coherent-integration/v1" || source.independentHostQualified !== true || source.continuousWalQualified !== false || source.immutableDifferentImagesQualified !== true || source.inquiryRuntimeQualified !== true || expected.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE" && !hasHealthyIndependentCheckpointDrill(source.checkpoint) || source.checkpoint.releaseId !== checkpointReleaseId || source.checkpoint.checksum !== checkpointChecksum || !source.checkpointMetadata || checkpointMetadataHash(source.checkpointMetadata) !== checkpointSha256 || source.checkpointMetadata.captureMethod !== expected.recoveryMode || source.checkpointMetadata.checksum !== checkpointChecksum || source.checkpointMetadata.id !== source.checkpoint.id || source.checkpointMetadata.releaseId !== checkpointReleaseId || source.checkpointMetadata.size !== source.checkpoint.size || !validDatabase(source.checkpointMetadata.sourceDatabase, true) || !same5(source.checkpointMetadata.sourceDatabase, expected.deploymentTargetDatabase) || source.checkpointMetadata.sourceMachineUuidSha256 !== source.checkpoint.sourceMachineUuidSha256 || source.checkpointMetadata.sourceKernelBootIdSha256 !== source.checkpoint.sourceKernelBootIdSha256 || source.checkpoint.remoteVerified !== true || source.checkpoint.restoreVerified !== true) fail5();
      let recoveryMachineUuidSha256;
      if (expected.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE") protectedDirectoryRestore(source, checkpointSha256);
      else {
        const physicalReport = assertOriginalIndependentPhysicalPoint(source, expected);
        recoveryMachineUuidSha256 = physicalReport.format === "sabalan-original-same-compose-online-physical-restore/v1" ? physicalReport.rsaHost.machineUuidSha256 : physicalReport.recoveryMachineUuidSha256;
        const components = source.components;
        if (!components || !same5(Object.keys(components).sort(), ["coordination", "files", "postgres", "sqlite"])) fail5();
        for (const component of Object.values(components)) if (component.captureId !== expected.captureId || !digest3(component.sha256) || !Number.isSafeInteger(component.bytes) || component.bytes < 1 || component.restoredSha256 !== component.sha256) fail5();
        if (source.restoredFileRoots !== 9 || !nonempty(source.independentlyVerifiedFileCuts) || source.independentlyVerifiedFileCuts.length !== 9 || new Set(source.independentlyVerifiedFileCuts.map((cut) => cut.name)).size !== 9) fail5();
      }
      if (expected.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE") recoveryMachineUuidSha256 = source.checkpoint.lastDrill?.recoveryMachineUuidSha256;
      if (expected.productionExecutionBindings && !digest3(recoveryMachineUuidSha256)) fail5();
      validateProductionExecutionBindings(expected.productionExecutionBindings, { ...expected, sourceHost: {
        machineUuidSha256: source.checkpointMetadata.sourceMachineUuidSha256,
        kernelBootIdSha256: source.checkpointMetadata.sourceKernelBootIdSha256
      }, recoveryMachineUuidSha256 });
      for (const name of ["backend", "frontend", "inquiry"]) {
        const health = source.applicationHealth?.[name];
        if (health?.image !== expected.deploymentTargetImages[name] || health.sourceCommit !== expected.componentSourceCommits[name] || (expected.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE" ? health.checkpointMetadataSha256 !== checkpointSha256 : health.captureId !== expected.captureId) || health.status !== 200 || !digest3(health.responseSha256)) fail5();
      }
      break;
    }
    case "browser-24-hours": {
      installedBrowserRouting(source, expected);
      if (source.format !== "sabalan-actual-native-browser/v1" || source.actualCompiledPages !== true || source.actualCanonicalAuthorization !== true || source.oldFormSubmittedAfterSwitch !== true || source.newFormSubmittedOnNewSlot !== true || !nonempty(source.retainedBuilds)) fail5();
      const registry = rawJson(source.routingRegistryRawBase64, 6 * 1024 * 1024);
      if (registry.format !== "sabalan-browser-routing/v2" || !Array.isArray(registry.builds) || !digest3(source.routingRegistrySha256) || (0, import_node_crypto14.createHash)("sha256").update(Buffer.from(source.routingRegistryRawBase64, "base64")).digest("hex") !== source.routingRegistrySha256) fail5();
      for (const application of ["erp", "inquiry"]) {
        const current = registry.builds.find((build) => build.id === registry.current?.[application]);
        if (!current || current.application !== application || current.retiredAt !== null || current.image !== expected.images[application === "erp" ? "frontend" : "inquiry"]) fail5();
      }
      const applications = /* @__PURE__ */ new Set();
      for (const build of source.retainedBuilds) {
        const registered = registry.builds.filter((value) => value.id === build.buildId);
        const manual = registered.length === 1 && registered[0].handoffPolicy === "MANUAL_SAVE_REQUIRED";
        const required4 = build.application === "erp" ? ["api", "assets", "rsc", "sessions", "sockets"] : ["assets", "inquiry-actions", "rsc", "sessions"];
        required4.push(manual ? "manual-save-expiry" : "draft-expiry");
        required4.sort();
        const retired = Date.parse(build.retiredAt), until = Date.parse(build.supportUntil), tested = Date.parse(build.observedAt);
        if (!["erp", "inquiry"].includes(build.application) || typeof build.buildId !== "string" || !build.buildId || ![retired, until, tested].every(Number.isFinite) || until - retired < 864e5 || tested < retired || tested >= until || !same5([...build.coverage].sort(), required4) || !digest3(build.formInventorySha256) || build.exercisedFormInventorySha256 !== build.formInventorySha256 || (manual ? build.manualRefreshNeverForced !== true || build.manualSaveRequiredAfterExpiry !== true : build.savedBeforeRequiredRefresh !== true) || build.accountIsolationVerified !== true) fail5();
        const execution = build.execution, started = Date.parse(execution?.startedAt), completed = Date.parse(execution?.completedAt);
        if (registered.length !== 1 || registered[0].application !== build.application || registered[0].image !== build.image || registered[0].retiredAt !== build.retiredAt || registered[0].supportUntil !== build.supportUntil || !/^sha256:[a-f0-9]{64}$/.test(build.image) || execution?.buildId !== build.buildId || execution?.image !== build.image || execution?.registrySha256 !== source.routingRegistrySha256 || ![started, completed].every(Number.isFinite) || started < retired || completed < started || tested < started || tested > completed || completed >= until) fail5();
        const row = (now) => ({ phase: "RETAINED", now: new Date(now), retiredAt: new Date(retired), browserSupportUntil: new Date(until) });
        snapshotOnlineSupportWindow(row(retired));
        snapshotOnlineSupportWindow(row(retired + 864e5 - 1));
        snapshotOnlineSupportWindow(row(until - 1));
        for (const at of [until, until + 1]) {
          let refused = false;
          try {
            snapshotOnlineSupportWindow(row(at));
          } catch {
            refused = true;
          }
          if (!refused) fail5();
        }
        snapshotOnlineSupportWindow(row(tested));
        applications.add(build.application);
      }
      if (applications.size !== 2) fail5();
      break;
    }
    case "single-worker-and-completion": {
      if (source.format !== "sabalan-application-native/v1" || source.singleWorker?.unknownOwners !== 0 || source.singleWorker.unresolvedCommands !== 0 || source.singleWorker.nativeJobsObserved !== true || !Number.isSafeInteger(source.singleWorker.httpTargetCount) || source.singleWorker.httpTargetCount < 2 || source.singleWorker.rowFenceVerified !== true) fail5();
      bridgeFanout(source, purposes);
      const jobs = purposes.filter((actor) => actor.purpose === "jobs"), intervals = source.workerOwnershipIntervals;
      if (jobs.length < 2 || !jobs.some((actor) => actor.candidate) || !jobs.some((actor) => !actor.candidate) || !nonempty(intervals) || intervals.length !== jobs.length) fail5();
      const seen = /* @__PURE__ */ new Set();
      let lock, boot;
      const ordered = intervals.map((interval) => {
        const actor = jobs.find((value) => value.runtimeId === interval.runtimeId);
        if (!actor || seen.has(interval.runtimeId)) fail5();
        seen.add(interval.runtimeId);
        const worker = actor.native.onlineLocks?.worker, issued = actor.native.onlineScope.scope.worker;
        if (!worker || worker.descriptor !== 12 || !issued || !same5(worker, { ...issued, descriptor: 12 }) || !/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(actor.native.guardian.bootId) || interval.bootId !== actor.native.guardian.bootId || interval.activeClaimSha256 !== actor.closure.activeClaimSha256) fail5();
        if (lock !== void 0 && (!same5(lock, issued) || boot !== interval.bootId)) fail5();
        lock = issued;
        boot = interval.bootId;
        const values = [interval.admissionRequestedMonotonicNs, interval.exclusiveClaimObservedMonotonicNs, interval.controlClosedMonotonicNs];
        if (values.some((value) => typeof value !== "string" || !/^\d{1,30}$/.test(value))) fail5();
        const [requested, acquired, closed] = values.map((value) => BigInt(value));
        if (requested > acquired || acquired > closed) fail5();
        return { actor, requested, acquired, closed };
      }).sort((a, b) => a.requested < b.requested ? -1 : a.requested > b.requested ? 1 : 0);
      let handoff = false;
      for (let index = 1; index < ordered.length; index++) {
        const previous = ordered[index - 1], next = ordered[index];
        if (previous.closed > next.requested) fail5();
        if (!previous.actor.candidate && next.actor.candidate) handoff = true;
      }
      if (!handoff) fail5();
      break;
    }
    case "current-domain": {
      const required4 = ["accounting", "contracts", "dispatch", "hr", "inquiry", "personnel-performance", "security", "support", "uploads"];
      if (source.format !== "sabalan-application-native/v1" || !nonempty(source.domainCases) || !same5(source.domainCases.map((row) => row.domain).sort(), required4) || source.writerCoverage?.remaining?.length !== 0 || source.writerCoverage?.startupOnly?.length !== 0) fail5();
      for (const row of source.domainCases) if (row.status !== "COMPLETE" || !digest3(row.receiptSha256) || row.actualCanonicalRuntime !== true || row.schemaSha256 !== expected.schemaSha256) fail5();
      break;
    }
    default:
      fail5();
  }
}
var import_node_crypto14, digest3, canonical8, same5, hash7, checkpointMetadataHash, nonempty;
var init_onlineQualificationEvidence = __esm({
  "backend/src/services/onlineQualificationEvidence.ts"() {
    "use strict";
    import_node_crypto14 = require("node:crypto");
    init_deploymentCheckpointPolicy();
    init_onlineReleaseSupportWindow();
    init_onlineMigrationPlan();
    init_onlineRealtimeBridgeIdentity();
    init_runtimeBoundaryJournal();
    init_onlinePhysicalCheckpointEvidence();
    init_deploymentCheckpointMetadataIdentity();
    init_onlineImageExecutionBinding();
    init_protectedFinancialQualificationProvenance();
    digest3 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    canonical8 = (value) => Array.isArray(value) ? value.map(canonical8) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical8(value[key])])) : value;
    same5 = (a, b) => JSON.stringify(canonical8(a)) === JSON.stringify(canonical8(b));
    hash7 = (value) => (0, import_node_crypto14.createHash)("sha256").update(JSON.stringify(canonical8(value)).replace(/[\u007f-\uffff]/g, (character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0")) + "\n").digest("hex");
    checkpointMetadataHash = (value) => (0, import_node_crypto14.createHash)("sha256").update(JSON.stringify(canonical8(value))).digest("hex");
    nonempty = (value) => Array.isArray(value) && value.length > 0 && value.length <= 1024;
  }
});

// backend/src/services/onlineReleaseEvidence.ts
var onlineReleaseEvidence_exports = {};
__export(onlineReleaseEvidence_exports, {
  assertOnlineQualificationProof: () => assertOnlineQualificationProof,
  readOnlineReleaseEvidence: () => readOnlineReleaseEvidence,
  readProtectedFinancialArtifactInventory: () => readProtectedFinancialArtifactInventory
});
function fail6() {
  throw new Error("ONLINE_RELEASE_EVIDENCE_UNPROVEN");
}
function boundedRead(fd, size) {
  const bytes = Buffer.alloc(Number(size));
  let offset = 0;
  while (offset < bytes.length) {
    const count = import_node_fs5.default.readSync(fd, bytes, offset, bytes.length - offset, null);
    if (!count) fail6();
    offset += count;
  }
  if (import_node_fs5.default.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) fail6();
  return bytes;
}
function readProtectedFinancialArtifactInventory(source, read2) {
  if (!source?.evidence || !exact2(source.evidence, [...protectedFinancialArtifactNames])) fail6();
  const raws = {};
  for (const name of protectedFinancialArtifactNames) {
    const d = source.evidence[name], maximum = name === "certificate" ? 65536 : protectedFinancialArtifactMaximum(name);
    if (!exact2(d, ["file", "bytes", "sha256"]) || !digest4(d.sha256) || !Number.isSafeInteger(d.bytes) || d.bytes < (name === "workerStderr" ? 0 : 1) || d.bytes > maximum || d.file !== `protected-financial-${name.toLowerCase()}.json`) fail6();
    const bytes = read2(d.file, d.sha256, maximum, d.bytes, false, name === "workerStderr");
    if (bytes.length !== d.bytes || hash8(bytes) !== d.sha256) fail6();
    raws[name] = bytes;
  }
  const { certificate, ...artifacts } = raws;
  return { certificate, artifacts };
}
function readOnlineReleaseEvidence(directory, expected) {
  if (!import_node_path4.default.isAbsolute(directory) || import_node_path4.default.resolve(directory) !== directory || import_node_fs5.default.realpathSync(directory) !== directory || !digest4(expected.manifestSha256) || !digest4(expected.acceptanceSha256)) fail6();
  const root = import_node_fs5.default.lstatSync(directory, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink() || process.platform !== "win32" && (root.mode & 0o077n) !== 0n || process.getuid && root.uid !== BigInt(process.getuid())) fail6();
  const nativeClosures = /* @__PURE__ */ new Map();
  const evidenceInventory = /* @__PURE__ */ new Map();
  const browserRegistries = [];
  const migrationPlans = [];
  const protectedFinancialQualifications = [];
  const migrationHistories = [];
  const pins = [];
  function read2(file, expectedHash, maximum = 8 * 1024 * 1024, expectedBytes, json = true, allowEmpty = false) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,95}$/.test(file) || !digest4(expectedHash)) fail6();
    const target = import_node_path4.default.join(directory, file);
    const fd = import_node_fs5.default.openSync(target, import_node_fs5.default.constants.O_RDONLY | import_node_fs5.default.constants.O_NOFOLLOW | import_node_fs5.default.constants.O_NONBLOCK);
    try {
      const before = import_node_fs5.default.fstatSync(fd, { bigint: true });
      const named = import_node_fs5.default.lstatSync(target, { bigint: true });
      for (const key of ["ino", "size", "mtimeNs", "ctimeNs", "uid", "mode", "nlink"]) if (named[key] !== before[key]) fail6();
      if (process.platform !== "win32" && named.dev !== before.dev) fail6();
      if (!before.isFile() || before.nlink !== 1n || before.size < (allowEmpty ? 0n : 1n) || before.size > BigInt(maximum) || process.platform !== "win32" && (before.mode & 0o077n) !== 0n || process.getuid && before.uid !== BigInt(process.getuid())) fail6();
      const bytes = boundedRead(fd, before.size);
      if (bytes.length !== Number(before.size) || expectedBytes !== void 0 && bytes.length !== expectedBytes || hash8(bytes) !== expectedHash || identity(before) !== identity(import_node_fs5.default.fstatSync(fd, { bigint: true })) || identity(named) !== identity(import_node_fs5.default.lstatSync(target, { bigint: true }))) fail6();
      pins.push({ file: target, identity: identity(before), namedIdentity: identity(named), sha256: expectedHash });
      evidenceInventory.set(file, { file, bytes: bytes.length, sha256: expectedHash });
      return json ? JSON.parse(bytes.toString("utf8")) : bytes;
    } finally {
      import_node_fs5.default.closeSync(fd);
    }
  }
  const manifest = read2("manifest.json", expected.manifestSha256, 128 * 1024);
  if (!exact2(manifest, ["format", "releaseId", "sourceCommit", "image", "runtimeBundleSha256", "generation", "database", "roots", "ephemeralRoots"]) || manifest.format !== "sabalan-online-release-manifest/v1" || !/^[a-zA-Z0-9_-]{8,128}$/.test(manifest.releaseId) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(manifest.image) || !digest4(manifest.runtimeBundleSha256) || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1 || !exact2(manifest.database, ["name", "systemIdentifier"]) || typeof manifest.database.name !== "string" || !/^[1-9][0-9]*$/.test(manifest.database.systemIdentifier) || !Array.isArray(manifest.roots) || manifest.roots.length !== 9 || !Array.isArray(manifest.ephemeralRoots) || manifest.ephemeralRoots.length !== 3) fail6();
  for (const value of manifest.roots) if (!exact2(value, ["live", "store", "liveDevice", "liveInode", "storeDevice", "storeInode", "baselineSha256"]) || !digest4(value.baselineSha256) || ![value.live, value.store].every((file) => typeof file === "string" && import_node_path4.default.posix.isAbsolute(file) && import_node_path4.default.posix.resolve(file) === file) || ![value.liveDevice, value.liveInode, value.storeDevice, value.storeInode].every((value2) => typeof value2 === "string" && /^\d+$/.test(value2))) fail6();
  if (new Set(manifest.roots.map((value) => value.live)).size !== 9 || new Set(manifest.roots.map((value) => value.store)).size !== 9 || new Set(manifest.ephemeralRoots).size !== 3 || manifest.ephemeralRoots.some((value) => typeof value !== "string" || !import_node_path4.default.posix.isAbsolute(value) || import_node_path4.default.posix.resolve(value) !== value)) fail6();
  const acceptance = read2("acceptance.json", expected.acceptanceSha256, 128 * 1024);
  if (!exact2(acceptance, ["format", "manifestSha256", "deploymentId", "checkpointSha256", "qualification", "reports"]) || acceptance.format !== "sabalan-online-release-acceptance/v2" || acceptance.manifestSha256 !== expected.manifestSha256 || typeof acceptance.deploymentId !== "string" || !acceptance.deploymentId || !digest4(acceptance.checkpointSha256) || !exact2(acceptance.reports, [...scopes])) fail6();
  const qualification = acceptance.qualification;
  const qualificationKeys = ["schemaSha256", "sourceDatabase", "proofDatabases", "recoveryMode", "deploymentTargetDatabase", "captureId", "images", "checkpointArchiveChecksum", "componentSourceCommits", "runtimeCohorts", "deploymentTargetImages", "imageGraphs", "imageArchiveReceipts"];
  if (Object.prototype.hasOwnProperty.call(qualification ?? {}, "productionExecutionBindings")) qualificationKeys.push("productionExecutionBindings");
  if (qualification?.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE") {
    qualificationKeys.push("qualificationCheckpoint");
    if (Object.prototype.hasOwnProperty.call(qualification, "protectedFinancial")) qualificationKeys.push("protectedFinancial");
  }
  if (!exact2(qualification, qualificationKeys) || !digest4(qualification.schemaSha256) || !digest4(qualification.captureId) || !digest4(qualification.checkpointArchiveChecksum) || !exact2(qualification.sourceDatabase, ["name", "systemIdentifier", "oid"]) || !/^[A-Za-z0-9_]{1,63}$/.test(qualification.sourceDatabase.name) || !/^[1-9][0-9]*$/.test(qualification.sourceDatabase.systemIdentifier) || !/^[1-9][0-9]*$/.test(qualification.sourceDatabase.oid) || !exact2(qualification.deploymentTargetDatabase, ["name", "systemIdentifier", "oid"]) || !/^[1-9][0-9]*$/.test(qualification.deploymentTargetDatabase.oid) || qualification.deploymentTargetDatabase.name !== manifest.database.name || qualification.deploymentTargetDatabase.systemIdentifier !== manifest.database.systemIdentifier || !exact2(qualification.images, ["backend", "frontend", "inquiry"]) || !exact2(qualification.componentSourceCommits, ["backend", "frontend", "inquiry"]) || !exact2(qualification.runtimeCohorts, ["compatible-migrations", "coherent-independent-restore", "browser-24-hours", "single-worker-and-completion", "current-domain"]) || !exact2(qualification.proofDatabases, ["compatible-migrations", "coherent-independent-restore", "browser-24-hours", "single-worker-and-completion", "current-domain"]) || Object.values(qualification.images).some((value) => typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) || !exact2(qualification.deploymentTargetImages, ["backend", "frontend", "inquiry"]) || !exact2(qualification.imageGraphs, ["backend", "frontend", "inquiry"]) || !exact2(qualification.imageArchiveReceipts, ["backend", "frontend", "inquiry"])) fail6();
  const executionImages = validateProductionExecutionBindings(qualification.productionExecutionBindings, { ...qualification, releaseId: manifest.releaseId });
  if (manifest.image !== executionImages.backend) fail6();
  for (const role of ["backend", "frontend", "inquiry"]) {
    const descriptor = qualification.imageArchiveReceipts[role];
    if (!exact2(descriptor, ["file", "bytes", "sha256"]) || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > 1048576) fail6();
    const receipt = read2(descriptor.file, descriptor.sha256, 1048576, descriptor.bytes);
    const graph = qualification.imageGraphs[role];
    if (!graph || ["index", "platform", "config", "rootfsDiffIds", "archiveSha256", "archiveBytes"].some((key) => JSON.stringify(receipt[key]) !== JSON.stringify(graph[key]))) fail6();
  }
  const binding = {
    manifestSha256: expected.manifestSha256,
    checkpointSha256: acceptance.checkpointSha256,
    checkpointArchiveChecksum: qualification.checkpointArchiveChecksum,
    releaseId: manifest.releaseId,
    sourceCommit: manifest.sourceCommit,
    runtimeBundleSha256: manifest.runtimeBundleSha256,
    schemaSha256: qualification.schemaSha256,
    captureId: qualification.captureId,
    sourceDatabase: qualification.sourceDatabase,
    proofDatabases: qualification.proofDatabases,
    recoveryMode: qualification.recoveryMode,
    deploymentTargetDatabase: qualification.deploymentTargetDatabase,
    images: qualification.images,
    ...qualification.protectedFinancial ? { protectedFinancial: qualification.protectedFinancial } : {},
    ...qualification.qualificationCheckpoint ? { qualificationCheckpoint: qualification.qualificationCheckpoint } : {},
    deploymentTargetImages: qualification.deploymentTargetImages,
    imageGraphs: qualification.imageGraphs,
    ...qualification.productionExecutionBindings ? { productionExecutionBindings: qualification.productionExecutionBindings } : {},
    componentSourceCommits: qualification.componentSourceCommits,
    runtimeCohorts: qualification.runtimeCohorts
  };
  for (const scope of scopes) {
    const descriptor = acceptance.reports[scope];
    if (!exact2(descriptor, ["file", "bytes", "sha256"]) || descriptor.file !== scope + ".json" || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > 8 * 1024 * 1024) fail6();
    const report = read2(descriptor.file, descriptor.sha256, 8 * 1024 * 1024, descriptor.bytes);
    if (scope === "release-gates") {
      if (qualification.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE") {
        if (!completeProtectedPrivateQualificationPrerequisite(report, {
          releaseId: manifest.releaseId,
          manifestSha256: expected.manifestSha256,
          qualificationCheckpointSha256: qualification.qualificationCheckpoint?.metadataSha256,
          qualificationReports: Object.fromEntries(scopes.filter((value) => value !== "release-gates").map((scope2) => [scope2, acceptance.reports[scope2]?.sha256]))
        })) fail6();
      } else if (!completeOnlinePrivateQualificationPrerequisite(report, {
        releaseId: manifest.releaseId,
        manifestSha256: expected.manifestSha256,
        checkpointSha256: acceptance.checkpointSha256,
        captureId: qualification.captureId,
        qualificationReports: Object.fromEntries(scopes.filter((value) => value !== "release-gates").map((scope2) => [scope2, acceptance.reports[scope2]?.sha256]))
      })) fail6();
    } else {
      if (report.format !== "sabalan-online-qualification/v1" || report.scope !== scope || report.manifestSha256 !== expected.manifestSha256 || report.releaseId !== manifest.releaseId || report.sourceCommit !== manifest.sourceCommit || report.image !== manifest.image || report.productionAdmission !== true || !Array.isArray(report.proofs) || !report.proofs.length || report.proofs.length > 64) fail6();
      for (const proof of report.proofs) {
        if (!exact2(proof, ["file", "bytes", "sha256"]) || !Number.isSafeInteger(proof.bytes) || proof.bytes < 1 || proof.bytes > 8 * 1024 * 1024 || !digest4(proof.sha256)) fail6();
        const source = read2(proof.file, proof.sha256, 8 * 1024 * 1024, proof.bytes);
        if (scope === "compatible-migrations" && source?.format === "sabalan-protected-financial-qualification/v1") {
          const { certificate, artifacts } = readProtectedFinancialArtifactInventory(source, read2);
          const verified = assertOnlineQualificationProof(scope, source, binding, artifacts, certificate);
          if (!verified) fail6();
          protectedFinancialQualifications.push(verified);
        } else {
          assertOnlineQualificationProof(scope, source, binding);
          const originalClosures2 = [
            ...source.originalNativeClosures,
            ...scope === "browser-24-hours" ? source.installedRouting.originalNativeClosures : []
          ];
          for (const closure of originalClosures2) {
            const row = {
              runtimeId: closure.runtimeId,
              nativeSha256: hash8(Buffer.from(closure.nativeRawBase64, "base64")),
              workSha256: hash8(Buffer.from(closure.workRawBase64, "base64")),
              activeClaimSha256: closure.activeClaimSha256
            };
            const old = nativeClosures.get(row.runtimeId);
            if (old && JSON.stringify(old) !== JSON.stringify(row)) fail6();
            nativeClosures.set(row.runtimeId, row);
          }
          if (scope === "compatible-migrations") {
            migrationPlans.push(...source.ownedMigration.steps.map((step) => step.plan));
            migrationHistories.push({ before: { rows: source.originalHistory.rows, sha256: source.originalHistory.sha256 }, afterRows: source.history.rows });
          }
          if (scope === "browser-24-hours") {
            browserRegistries.push(JSON.parse(Buffer.from(source.routingRegistryRawBase64, "base64").toString("utf8")));
            browserRegistries.push(JSON.parse(Buffer.from(source.installedRouting.publicationRawBase64, "base64").toString("utf8")).registry);
          }
        }
      }
    }
  }
  const revalidate = () => {
    const current = import_node_fs5.default.lstatSync(directory, { bigint: true });
    if (identity(current) !== identity(root)) fail6();
    for (const pin4 of pins) {
      const fd = import_node_fs5.default.openSync(pin4.file, import_node_fs5.default.constants.O_RDONLY | import_node_fs5.default.constants.O_NOFOLLOW | import_node_fs5.default.constants.O_NONBLOCK);
      try {
        const before = import_node_fs5.default.fstatSync(fd, { bigint: true });
        if (identity(before) !== pin4.identity || hash8(boundedRead(fd, before.size)) !== pin4.sha256 || identity(import_node_fs5.default.fstatSync(fd, { bigint: true })) !== pin4.identity || identity(import_node_fs5.default.lstatSync(pin4.file, { bigint: true })) !== pin4.namedIdentity) fail6();
      } finally {
        import_node_fs5.default.closeSync(fd);
      }
    }
  };
  revalidate();
  return {
    nativeClosures: freeze([...nativeClosures.values()].sort((a, b) => a.runtimeId.localeCompare(b.runtimeId))),
    evidenceInventory: freeze([...evidenceInventory.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)),
    manifest: freeze(manifest),
    acceptance: freeze(acceptance),
    browserRegistries: freeze(browserRegistries),
    protectedFinancialQualifications: freeze(protectedFinancialQualifications),
    migrationPlans: freeze(migrationPlans),
    migrationHistories: freeze(migrationHistories),
    revalidate
  };
}
var import_node_fs5, import_node_path4, import_node_crypto15, hash8, digest4, exact2, identity, freeze, scopes;
var init_onlineReleaseEvidence = __esm({
  "backend/src/services/onlineReleaseEvidence.ts"() {
    "use strict";
    import_node_fs5 = __toESM(require("node:fs"));
    import_node_path4 = __toESM(require("node:path"));
    import_node_crypto15 = require("node:crypto");
    init_deploymentGates();
    init_onlineQualificationEvidence();
    init_protectedFinancialQualificationProvenance();
    init_onlineImageExecutionBinding();
    init_onlineQualificationEvidence();
    hash8 = (bytes) => (0, import_node_crypto15.createHash)("sha256").update(bytes).digest("hex");
    digest4 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
    exact2 = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
    identity = (value) => [
      value.dev,
      value.ino,
      value.size,
      value.mtimeNs,
      value.ctimeNs,
      value.uid,
      value.mode,
      value.nlink
    ].map(String).join(":");
    freeze = (value) => {
      if (value && typeof value === "object") {
        for (const child2 of Object.values(value)) freeze(child2);
        Object.freeze(value);
      }
      return value;
    };
    scopes = [
      "release-gates",
      "compatible-migrations",
      "coherent-independent-restore",
      "browser-24-hours",
      "single-worker-and-completion",
      "current-domain"
    ];
  }
});

// backend/src/services/onlineReleaseRegistration.ts
var onlineReleaseRegistration_exports = {};
__export(onlineReleaseRegistration_exports, {
  prepareValidatedOnlineRegistration: () => prepareValidatedOnlineRegistration,
  prepareValidatedRetainedWorkerRegistration: () => prepareValidatedRetainedWorkerRegistration,
  registerAcceptedOnlineRelease: () => registerAcceptedOnlineRelease
});
function required2(value, code) {
  if (!value) throw Error(code);
}
function prepareValidatedOnlineRegistration(owner, input) {
  return prepareRegistration(owner, input, "release");
}
function prepareValidatedRetainedWorkerRegistration(owner, input) {
  return prepareRegistration(owner, input, "retained-worker");
}
function prepareRegistration(owner, input, layout) {
  const accepted = readOnlineReleaseEvidence(input.evidenceDirectory, {
    manifestSha256: input.manifestSha256,
    acceptanceSha256: input.acceptanceSha256
  });
  const { manifest, acceptance } = accepted;
  required2(manifest.releaseId === owner.releaseId && acceptance.deploymentId === owner.deploymentId, "ONLINE_REGISTRATION_OWNER_CHANGED");
  required2(layout === "release" ? input.scopes.length >= 2 && input.scopes.length <= 1024 : input.scopes.length === 1 && input.scopes[0].scope.purpose === "jobs" && input.scopes[0].scope.role === "control", "ONLINE_REGISTRATION_SCOPES_UNPROVEN");
  const slots = input.scopes.map(({ scope, sha256, file }) => {
    required2(import_node_path5.default.isAbsolute(file) && import_node_fs6.default.realpathSync(file) === file, "ONLINE_REGISTRATION_SCOPE_FILE_UNPROVEN");
    const fd = import_node_fs6.default.openSync(file, import_node_fs6.default.constants.O_RDONLY | import_node_fs6.default.constants.O_NOFOLLOW | import_node_fs6.default.constants.O_NONBLOCK);
    try {
      const st = import_node_fs6.default.fstatSync(fd, { bigint: true });
      required2(st.isFile() && st.nlink === 1n && st.size > 0n && st.size <= 32768n, "ONLINE_REGISTRATION_SCOPE_FILE_UNPROVEN");
      const raw2 = import_node_fs6.default.readFileSync(fd), after = import_node_fs6.default.fstatSync(fd, { bigint: true });
      required2(
        st.dev === after.dev && st.ino === after.ino && st.mtimeNs === after.mtimeNs && st.ctimeNs === after.ctimeNs && (0, import_node_crypto16.createHash)("sha256").update(raw2).digest("hex") === sha256 && hash9(JSON.parse(raw2.toString())) === hash9(scope),
        "ONLINE_REGISTRATION_SCOPE_FILE_CHANGED"
      );
    } finally {
      import_node_fs6.default.closeSync(fd);
    }
    required2(scope.format === "sabalan-online-runtime-scope/v2" && /^[a-f0-9]{64}$/.test(scope.runtimeId) && /^[a-f0-9]{64}$/.test(scope.nonce) && sha256 === (0, import_node_crypto16.createHash)("sha256").update(JSON.stringify(canonical9(scope)) + "\n").digest("hex") && scope.releaseId === manifest.releaseId && scope.image === manifest.image && scope.sourceCommit === manifest.sourceCommit && scope.manifestSha256 === manifest.runtimeBundleSha256 && hash9(scope.database) === hash9(manifest.database) && (scope.purpose === "http" && scope.role === "serving" || scope.purpose === "jobs" && scope.role === "control"), "ONLINE_REGISTRATION_SCOPE_CHANGED");
    return {
      id: scope.runtimeId,
      releaseId: owner.releaseId,
      component: "backend",
      role: scope.role,
      phase: "PREPARED",
      nonceSha256: (0, import_node_crypto16.createHash)("sha256").update(scope.nonce).digest("hex"),
      imageIdentity: scope.image
    };
  });
  required2(new Set(slots.map((slot) => slot.id)).size === slots.length && new Set(slots.map((slot) => slot.nonceSha256)).size === slots.length && input.scopes.filter((item) => item.scope.purpose === "jobs").length === 1 && (layout === "retained-worker" || input.scopes.some((item) => item.scope.purpose === "http")), "ONLINE_REGISTRATION_DUPLICATE_SCOPE");
  const compatibilityJson = {
    format: "sabalan-online-compatibility-index/v1",
    reports: Object.fromEntries(Object.entries(acceptance.reports).filter(([scope]) => ["compatible-migrations", "browser-24-hours", "single-worker-and-completion", "current-domain"].includes(scope)))
  };
  const recoveryJson = {
    format: "sabalan-online-recovery-index/v1",
    checkpointSha256: acceptance.checkpointSha256,
    report: acceptance.reports["coherent-independent-restore"],
    qualification: acceptance.qualification
  };
  const identityJson = {
    format: "sabalan-online-release-identity/v1",
    manifestSha256: input.manifestSha256,
    acceptanceSha256: input.acceptanceSha256,
    compatibilitySha256: hash9(compatibilityJson),
    recoverySha256: hash9(recoveryJson)
  };
  return { accepted, manifest, acceptance, slots, compatibilityJson, recoveryJson, identityJson };
}
async function registerAcceptedOnlineRelease(database2, owner, input) {
  required2(input.previousReleaseId !== null, "ONLINE_REGISTRATION_REQUIRES_PROVEN_BOOTSTRAP_PREDECESSOR");
  const { accepted, manifest, acceptance, slots, compatibilityJson, recoveryJson, identityJson } = prepareValidatedOnlineRegistration(owner, input);
  required2(acceptance.qualification.recoveryMode === "ONLINE_COHERENT_WAL", "ONLINE_REGISTRATION_COHERENT_WAL_REQUIRED");
  return database2.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
   SELECT id,"releaseId","targetCommit",phase,"checkpointJson" FROM deployment_operations
   WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken} AND "activeKey"='production'
    AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
    required2(rows.length === 1 && rows[0].releaseId === owner.releaseId && rows[0].targetCommit === manifest.sourceCommit && rows[0].phase === "ONLINE_ACCEPTING", "ONLINE_REGISTRATION_OWNED_ONLINE_LEASE_REQUIRED");
    const checkpoint = rows[0].checkpointJson;
    required2(
      checkpoint && checkpoint.deploymentId === owner.deploymentId && checkpoint.releaseId === owner.releaseId && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.restoreVerified === true && checkpoint.manifestReadable === true && checkpoint.compatibility?.local?.compatible === true && checkpoint.compatibility?.remote?.compatible === true && hash9(checkpoint) === acceptance.checkpointSha256,
      "ONLINE_REGISTRATION_CHECKPOINT_CHANGED"
    );
    const identities = await tx.$queryRaw`
   SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid
   FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
    required2(
      identities.length === 1 && hash9(identities[0]) === hash9({ ...manifest.database, oid: acceptance.qualification.deploymentTargetDatabase.oid }),
      "ONLINE_REGISTRATION_DATABASE_CHANGED"
    );
    if (input.previousReleaseId !== null) {
      const previous = await tx.$queryRaw`SELECT id FROM online_releases
    WHERE id=${input.previousReleaseId} AND phase='SERVING' AND ("retiredAt" IS NULL OR EXISTS(SELECT 1 FROM online_serving_epochs e
      WHERE e."releaseId"=online_releases.id AND e."retiredAt" IS NULL)) FOR SHARE`;
      required2(previous.length === 1, "ONLINE_REGISTRATION_PREDECESSOR_UNPROVEN");
    }
    accepted.revalidate();
    const existing = await tx.onlineRelease.findUnique({ where: { id: owner.releaseId } });
    if (existing) {
      required2(existing.phase === "ACCEPTING" && existing.deploymentId === owner.deploymentId && existing.manifestSha256 === input.manifestSha256 && hash9(existing.identityJson) === hash9(identityJson) && hash9(existing.acceptanceJson) === hash9(acceptance), "ONLINE_REGISTRATION_PREPARATION_CHANGED");
      const actual = await tx.onlineRuntimeSlot.findMany({ where: { releaseId: owner.releaseId } });
      const fields2 = (slot) => ({
        id: slot.id,
        releaseId: slot.releaseId,
        component: slot.component,
        role: slot.role,
        phase: slot.phase,
        nonceSha256: slot.nonceSha256,
        imageIdentity: slot.imageIdentity
      });
      required2(hash9(actual.map(fields2).sort((a, b) => a.id.localeCompare(b.id))) === hash9(slots.map(fields2).sort((a, b) => a.id.localeCompare(b.id))), "ONLINE_REGISTRATION_PREPARED_SLOTS_CHANGED");
      await tx.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: "READY" } });
    } else await tx.onlineRelease.create({ data: {
      id: owner.releaseId,
      deploymentId: owner.deploymentId,
      manifestSha256: input.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      identityJson,
      compatibilityJson,
      recoveryJson,
      acceptanceJson: acceptance,
      phase: "READY",
      previousReleaseId: input.previousReleaseId
    } });
    if (!existing) await tx.onlineRuntimeSlot.createMany({ data: slots });
    await tx.deploymentOperation.update({ where: { id: owner.deploymentId }, data: { phase: "ONLINE_READY" } });
    return {
      format: "sabalan-online-owned-registry-registration/v1",
      releaseId: owner.releaseId,
      phase: "READY",
      slots: slots.map((slot) => slot.id),
      manifestSha256: input.manifestSha256,
      acceptanceSha256: input.acceptanceSha256,
      startupAuthorityIssued: false,
      publicTrafficPublished: false
    };
  }, { timeout: 3e4, maxWait: 1e3 });
}
var import_node_crypto16, import_node_fs6, import_node_path5, canonical9, hash9;
var init_onlineReleaseRegistration = __esm({
  "backend/src/services/onlineReleaseRegistration.ts"() {
    "use strict";
    import_node_crypto16 = require("node:crypto");
    import_node_fs6 = __toESM(require("node:fs"));
    import_node_path5 = __toESM(require("node:path"));
    init_onlineReleaseEvidence();
    canonical9 = (value) => Array.isArray(value) ? value.map(canonical9) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical9(value[key])])) : value;
    hash9 = (value) => (0, import_node_crypto16.createHash)("sha256").update(JSON.stringify(canonical9(value))).digest("hex");
  }
});

// backend/src/scripts/online-release-host-kernel.ts
var online_release_host_kernel_exports = {};
__export(online_release_host_kernel_exports, {
  PrismaDeploymentStore: () => PrismaDeploymentStore,
  acquireDeploymentLease: () => acquireDeploymentLease,
  assertOwnedOnlineLease: () => assertOwnedOnlineLease,
  assertProtectedOnlineBootstrap: () => assertProtectedOnlineBootstrap,
  finalizeProtectedOnlineBootstrap: () => finalizeProtectedOnlineBootstrap,
  finishDeployment: () => finishDeployment,
  heartbeatDeployment: () => heartbeatDeployment,
  openProtectedFinancialQualificationDirectory: () => openProtectedFinancialQualificationDirectory,
  openTrustedOnlineQualification: () => openTrustedOnlineQualification,
  prepareAcceptedOnlineExpansion: () => prepareAcceptedOnlineExpansion,
  prepareProtectedOnlineBootstrap: () => prepareProtectedOnlineBootstrap,
  productionImageInspectionSha256: () => productionImageInspectionSha256,
  readOnlineReleaseEvidence: () => readOnlineReleaseEvidence,
  recordOwnedOnlinePublication: () => recordOwnedOnlinePublication,
  registerAcceptedOnlineRelease: () => registerAcceptedOnlineRelease,
  registerRetainedOnlineIncarnations: () => registerRetainedOnlineIncarnations,
  registerRetainedOnlineWorker: () => registerRetainedOnlineWorker,
  runAcceptedOnlineExpansion: () => runAcceptedOnlineExpansion,
  transitionDeployment: () => transitionDeployment,
  validateProductionExecutionBindings: () => validateProductionExecutionBindings,
  verifyOnlineQualificationOrigin: () => verifyOnlineQualificationOrigin,
  verifyOnlineStartupDecision: () => verifyOnlineStartupDecision
});
module.exports = __toCommonJS(online_release_host_kernel_exports);

// backend/src/services/onlineReleaseEpochs.ts
var import_node_crypto17 = require("node:crypto");
function requireProof2(value, code) {
  if (!value) throw new Error(code);
}
async function assertOwnedOnlineLease(tx, owner, phases) {
  const rows = await tx.$queryRaw`SELECT "releaseId",phase FROM deployment_operations
    WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken} AND "activeKey"='production'
      AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
  requireProof2(rows.length === 1 && rows[0].releaseId === owner.releaseId && phases.includes(rows[0].phase), "ONLINE_ORIGINAL_LEASE_LOST");
  return rows[0];
}
async function recordOwnedOnlinePublication(database2, owner, publication) {
  requireProof2(/^[a-f0-9]{64}$/.test(publication.publicationSha256) && Number.isSafeInteger(publication.generation) && publication.generation > 1 && publication.releaseId !== publication.previousReleaseId, "ONLINE_PUBLICATION_IDENTITY_REQUIRED");
  return database2.$transaction(async (tx) => {
    await assertOwnedOnlineLease(tx, owner, [publication.rollback ? "ONLINE_ROLLBACK_PUBLISHING" : "ONLINE_PUBLISHING"]);
    const rows = await tx.$queryRaw`SELECT id,phase FROM online_releases
      WHERE id IN (${publication.releaseId},${publication.previousReleaseId}) ORDER BY id FOR UPDATE`;
    requireProof2(
      rows.length === 2 && rows.some((r) => r.id === publication.previousReleaseId && r.phase === "SERVING") && rows.some((r) => r.id === publication.releaseId && r.phase === (publication.rollback ? "RETAINED" : "READY")),
      "ONLINE_PUBLICATION_PREDECESSOR_CHANGED"
    );
    const current = await tx.$queryRaw`SELECT id,"releaseId",generation
      FROM online_serving_epochs WHERE "retiredAt" IS NULL FOR UPDATE`;
    requireProof2(current.length === 1 && current[0].releaseId === publication.previousReleaseId && current[0].generation + 1 === publication.generation, "ONLINE_PUBLICATION_BOOTSTRAP_OR_HEAD_UNPROVEN");
    const [time] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
    const until = new Date(time.now.getTime() + 864e5);
    await tx.$executeRaw`UPDATE online_serving_epochs SET "retiredAt"=${time.now},"supportUntil"=${until} WHERE id=${current[0].id}`;
    await tx.$executeRaw`UPDATE online_releases SET phase='RETAINED',"retiredAt"=coalesce("retiredAt",${time.now}),
      "browserSupportUntil"=greatest("browserSupportUntil",${until}),"updatedAt"=${time.now} WHERE id=${publication.previousReleaseId}`;
    const ready = await tx.$queryRaw`SELECT id FROM online_runtime_slots
      WHERE "releaseId"=${publication.releaseId} AND role='serving' AND phase IN ('READY','SERVING')
        AND "stoppedAt" IS NULL FOR UPDATE`;
    requireProof2(ready.length > 0, "ONLINE_PUBLICATION_READY_HTTP_REQUIRED");
    await tx.$executeRaw`UPDATE online_runtime_slots SET phase='SERVING' WHERE "releaseId"=${publication.releaseId}
      AND role='serving' AND phase='READY' AND "stoppedAt" IS NULL`;
    const epochId = (0, import_node_crypto17.randomUUID)();
    await tx.$executeRaw`INSERT INTO online_serving_epochs(id,"releaseId","deploymentId",generation,"publicationSha256","servedAt")
      VALUES (${epochId},${publication.releaseId},${owner.deploymentId},${publication.generation},${publication.publicationSha256},${time.now})`;
    await tx.$executeRaw`UPDATE online_releases SET phase='SERVING',"servedAt"=coalesce("servedAt",${time.now}),"updatedAt"=${time.now}
      WHERE id=${publication.releaseId}`;
    await tx.$executeRaw`UPDATE deployment_operations SET phase='ONLINE_SERVING'
      WHERE id=${owner.deploymentId}`;
    return Object.freeze({
      epochId,
      releaseId: publication.releaseId,
      generation: publication.generation,
      publicationSha256: publication.publicationSha256,
      retainedUntil: until.toISOString(),
      databaseRestored: false
    });
  }, { timeout: 3e4, maxWait: 1e3 });
}
async function registerRetainedOnlineIncarnations(database2, owner, input) {
  const { prepareValidatedOnlineRegistration: prepareValidatedOnlineRegistration2 } = await Promise.resolve().then(() => (init_onlineReleaseRegistration(), onlineReleaseRegistration_exports));
  const { readOnlineReleaseEvidence: readOnlineReleaseEvidence2 } = await Promise.resolve().then(() => (init_onlineReleaseEvidence(), onlineReleaseEvidence_exports));
  const accepted = readOnlineReleaseEvidence2(input.evidenceDirectory, input);
  const targetOwner = { ...owner, releaseId: accepted.manifest.releaseId, deploymentId: accepted.acceptance.deploymentId };
  const prepared = prepareValidatedOnlineRegistration2(targetOwner, input);
  requireProof2(targetOwner.releaseId !== owner.releaseId, "ONLINE_RETAINED_RELEASE_REQUIRED");
  return database2.$transaction(async (tx) => {
    await assertOwnedOnlineLease(tx, owner, ["ONLINE_ROLLBACK_PUBLISHING", "ONLINE_SERVING"]);
    const rows = await tx.$queryRaw`SELECT id,"manifestSha256","identityJson"
   FROM online_releases WHERE id=${targetOwner.releaseId} AND phase IN ('SERVING','RETAINED') FOR UPDATE`;
    requireProof2(rows.length === 1 && rows[0].manifestSha256 === input.manifestSha256 && rows[0].identityJson?.acceptanceSha256 === input.acceptanceSha256, "ONLINE_RETAINED_ACCEPTANCE_CHANGED");
    const [identity2] = await tx.$queryRaw`SELECT current_database() AS database,
   (SELECT system_identifier::text FROM pg_control_system()) AS system,
   (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
    requireProof2(identity2?.database === accepted.manifest.database.name && identity2.system === accepted.manifest.database.systemIdentifier && identity2.oid === accepted.acceptance.qualification.deploymentTargetDatabase.oid, "ONLINE_RETAINED_DATABASE_CHANGED");
    accepted.revalidate();
    await tx.onlineRuntimeSlot.createMany({ data: prepared.slots });
    return { releaseId: targetOwner.releaseId, runtimeIds: prepared.slots.map((slot) => slot.id), phase: "PREPARED" };
  }, { timeout: 3e4, maxWait: 1e3 });
}

// backend/src/scripts/online-release-host-kernel.ts
init_onlineReleaseRegistration();

// backend/src/services/onlineRetainedWorkerRegistration.ts
var import_node_fs7 = __toESM(require("node:fs"));
var import_node_path6 = __toESM(require("node:path"));
var import_node_crypto18 = require("node:crypto");
init_onlineReleaseEvidence();
init_onlineReleaseRegistration();
var canonical10 = (v) => Array.isArray(v) ? v.map(canonical10) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical10(v[k])])) : v;
var hash10 = (v) => (0, import_node_crypto18.createHash)("sha256").update(JSON.stringify(canonical10(v))).digest("hex");
function need4(v, code) {
  if (!v) throw Error(code);
}
var pin2 = (s) => [s.dev, s.ino, s.nlink, s.uid, s.gid, s.mode, s.size, s.mtimeNs, s.ctimeNs].map(String).join(":");
async function registerRetainedOnlineWorker(database2, owner, input) {
  const registration = input.registration, accepted = readOnlineReleaseEvidence(registration.evidenceDirectory, registration);
  const targetOwner = { ...owner, releaseId: accepted.manifest.releaseId, deploymentId: accepted.acceptance.deploymentId };
  need4(targetOwner.releaseId !== owner.releaseId && /^[a-f0-9]{64}$/.test(input.checkpointSha256), "ONLINE_RETAINED_WORKER_TARGET_REQUIRED");
  const prepared = prepareValidatedRetainedWorkerRegistration(targetOwner, registration);
  const previous = prepareValidatedRetainedWorkerRegistration(targetOwner, { ...registration, scopes: [input.previousJobsScope] });
  const fresh = registration.scopes[0].scope, old = input.previousJobsScope.scope;
  const stable = (scope) => Object.fromEntries(Object.entries(scope).filter(([key]) => !["runtimeId", "nonce", "nativeDirectory", "boundaryDirectory"].includes(key)));
  need4(fresh.runtimeId !== old.runtimeId && fresh.nonce !== old.nonce && hash10(stable(fresh)) === hash10(stable(old)), "ONLINE_RETAINED_WORKER_SCOPE_CHANGED");
  need4(fresh.nativeDirectory !== old.nativeDirectory && fresh.boundaryDirectory !== old.boundaryDirectory, "ONLINE_RETAINED_WORKER_NAMESPACE_REUSED");
  need4(import_node_path6.default.posix.isAbsolute(fresh.coordinationDirectory) && fresh.nativeDirectory === import_node_path6.default.posix.join(fresh.coordinationDirectory, "online/native", fresh.runtimeId) && fresh.boundaryDirectory === import_node_path6.default.posix.join(fresh.coordinationDirectory, "online/work", fresh.runtimeId), "ONLINE_RETAINED_WORKER_NAMESPACE_CHANGED");
  const worker = old.worker;
  need4(worker && import_node_path6.default.isAbsolute(input.workerHostFile) && import_node_fs7.default.realpathSync(input.workerHostFile) === input.workerHostFile, "ONLINE_RETAINED_WORKER_LOCK_REQUIRED");
  const fd = import_node_fs7.default.openSync(input.workerHostFile, import_node_fs7.default.constants.O_RDONLY | import_node_fs7.default.constants.O_NOFOLLOW | import_node_fs7.default.constants.O_NONBLOCK);
  try {
    const before = import_node_fs7.default.fstatSync(fd, { bigint: true });
    const checkWorker = () => {
      const actual = import_node_fs7.default.fstatSync(fd, { bigint: true }), named = import_node_fs7.default.lstatSync(input.workerHostFile, { bigint: true });
      need4(actual.isFile() && actual.uid === 0n && actual.nlink === 1n && actual.size === 0n && (actual.mode & 0o077n) === 0n && String(actual.dev) === worker.device && String(actual.ino) === worker.inode && worker.ownerUid === 0 && pin2(actual) === pin2(before) && pin2(named) === pin2(before), "ONLINE_RETAINED_WORKER_LOCK_CHANGED");
    };
    checkWorker();
    return await database2.$transaction(async (tx) => {
      await assertOwnedOnlineLease(tx, owner, ["ONLINE_ROLLBACK_PUBLISHING"]);
      const [operation] = await tx.$queryRaw`SELECT "checkpointJson" FROM deployment_operations WHERE id=${owner.deploymentId}`;
      const checkpoint = operation?.checkpointJson;
      need4(checkpoint?.deploymentId === owner.deploymentId && checkpoint.releaseId === owner.releaseId && checkpoint.captureMethod === "ONLINE_COHERENT_WAL" && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.restoreVerified === true && checkpoint.independentRestoreVerified === true && checkpoint.manifestReadable === true && checkpoint.compatibility?.local?.compatible === true && checkpoint.compatibility?.remote?.compatible === true && hash10(checkpoint) === input.checkpointSha256, "ONLINE_RETAINED_WORKER_CHECKPOINT_CHANGED");
      const attempts = await tx.$queryRaw`SELECT "previousReleaseId","acceptanceJson" FROM online_releases WHERE id=${owner.releaseId} FOR SHARE`;
      need4(attempts.length === 1 && attempts[0].previousReleaseId === targetOwner.releaseId && attempts[0].acceptanceJson?.checkpointSha256 === input.checkpointSha256, "ONLINE_RETAINED_WORKER_PREDECESSOR_CHANGED");
      const targets = await tx.$queryRaw`SELECT "manifestSha256","identityJson" FROM online_releases
    WHERE id=${targetOwner.releaseId} AND phase='RETAINED' FOR UPDATE`;
      need4(targets.length === 1 && targets[0].manifestSha256 === registration.manifestSha256 && targets[0].identityJson?.acceptanceSha256 === registration.acceptanceSha256, "ONLINE_RETAINED_WORKER_ACCEPTANCE_CHANGED");
      const prior = await tx.$queryRaw`SELECT id,"releaseId",role,component,phase,"stoppedAt","nonceSha256","imageIdentity"
    FROM online_runtime_slots WHERE "releaseId"=${targetOwner.releaseId} AND role='control' FOR UPDATE`;
      const slot = prior.find((row) => row.id === old.runtimeId), expected = previous.slots[0];
      need4(slot && slot.releaseId === targetOwner.releaseId && slot.role === expected.role && slot.component === expected.component && slot.imageIdentity === expected.imageIdentity && slot.nonceSha256 === expected.nonceSha256 && prior.every((row) => row.phase === "STOPPED" && row.stoppedAt instanceof Date), "ONLINE_RETAINED_WORKER_PREDECESSOR_NOT_CLOSED");
      const [identity2] = await tx.$queryRaw`SELECT current_database() AS database,
    (SELECT system_identifier::text FROM pg_control_system()) AS system,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
      need4(identity2?.database === accepted.manifest.database.name && identity2.system === accepted.manifest.database.systemIdentifier && identity2.oid === accepted.acceptance.qualification.deploymentTargetDatabase.oid, "ONLINE_RETAINED_WORKER_DATABASE_CHANGED");
      accepted.revalidate();
      prepared.accepted.revalidate();
      previous.accepted.revalidate();
      checkWorker();
      const inserted = await tx.onlineRuntimeSlot.createMany({ data: prepared.slots });
      need4(inserted.count === 1, "ONLINE_RETAINED_WORKER_INSERT_CHANGED");
      return { releaseId: targetOwner.releaseId, jobsRuntimeIds: prepared.slots.map((slot2) => slot2.id) };
    }, { timeout: 3e4, maxWait: 1e3 });
  } finally {
    import_node_fs7.default.closeSync(fd);
  }
}

// backend/src/scripts/online-release-host-kernel.ts
init_onlineReleaseEvidence();
init_onlineImageExecutionBinding();

// backend/src/services/onlineReleaseControllerAuthority.ts
var import_node_crypto19 = require("node:crypto");
init_onlineRuntimeScope();
init_runtimeNativeAuthority();

// backend/src/services/onlinePrivateIngress.ts
var fail7 = () => {
  throw new Error("ONLINE_PRIVATE_INGRESS_UNPROVEN");
};
function parseOnlineHttpIngress(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== "bindHost,port") return fail7();
  const input = value;
  if (typeof input.bindHost !== "string" || !/^\d{1,3}(\.\d{1,3}){3}$/.test(input.bindHost) || typeof input.port !== "number" || !Number.isSafeInteger(input.port) || input.port < 1024 || input.port > 65535) return fail7();
  const octets = input.bindHost.split(".").map(Number);
  if (octets.some((part) => part < 0 || part > 255) || octets.join(".") !== input.bindHost || !(octets[0] === 10 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168)) return fail7();
  return Object.freeze({ bindHost: input.bindHost, port: input.port });
}

// backend/src/services/onlineReleaseControllerAuthority.ts
var DOMAIN = "sabalan-online-runtime-startup/v2\n";
var canonical11 = (value) => Array.isArray(value) ? value.map(canonical11) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical11(value[key])])) : value;
var encoded = (value) => Buffer.from(JSON.stringify(canonical11(value)), "utf8");
var exact3 = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
var hex4 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function fail8() {
  throw new Error("ONLINE_ORIGINAL_CONTROLLER_AUTHORITY_UNPROVEN");
}
function verifyOnlineStartupDecision(bytes, publicKeyBytes, now = /* @__PURE__ */ new Date()) {
  if (bytes.length < 1 || bytes.length > 16384 || publicKeyBytes.length < 1 || publicKeyBytes.length > 4096) fail8();
  if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+-----END PUBLIC KEY-----\r?\n?$/.test(publicKeyBytes.toString("ascii"))) fail8();
  const envelope = JSON.parse(bytes.toString("utf8"));
  if (!exact3(envelope, ["format", "decision", "signature"]) || envelope.format !== "sabalan-signed-online-startup/v2" || typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)) fail8();
  if (Buffer.from(envelope.signature, "base64").toString("base64") !== envelope.signature) fail8();
  const value = envelope.decision;
  if (!exact3(value, [
    "format",
    "purpose",
    "scopeSha256",
    "runtimeId",
    "nonceSha256",
    "runtimePurpose",
    "role",
    "releaseId",
    "image",
    "sourceCommit",
    "runtimeBundleSha256",
    "manifestSha256",
    "acceptanceSha256",
    "database",
    "httpIngress",
    "issuedAt",
    "expiresAt"
  ]) || value.format !== "sabalan-online-startup-decision/v2" || value.purpose !== "online-runtime-startup" || ![value.scopeSha256, value.runtimeId, value.nonceSha256, value.runtimeBundleSha256, value.manifestSha256, value.acceptanceSha256].every(hex4) || !(value.runtimePurpose === "http" && value.role === "serving" || value.runtimePurpose === "jobs" && value.role === "control") || typeof value.releaseId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(value.releaseId) || !/^sha256:[a-f0-9]{64}$/.test(value.image) || !/^[a-f0-9]{40}$/.test(value.sourceCommit) || !exact3(value.database, ["name", "systemIdentifier"]) || typeof value.database.name !== "string" || !/^[a-zA-Z0-9_]{1,63}$/.test(value.database.name) || !/^[1-9][0-9]*$/.test(value.database.systemIdentifier)) fail8();
  if (value.runtimePurpose === "http") value.httpIngress = parseOnlineHttpIngress(value.httpIngress);
  else if (value.httpIngress !== null) fail8();
  const issued = Date.parse(value.issuedAt), expires = Date.parse(value.expiresAt), current = now.getTime();
  if (!Number.isFinite(issued) || !Number.isFinite(expires) || !Number.isFinite(current) || new Date(issued).toISOString() !== value.issuedAt || new Date(expires).toISOString() !== value.expiresAt || issued > current || expires <= current || expires <= issued || expires - issued > 6e5) fail8();
  const key = (0, import_node_crypto19.createPublicKey)(publicKeyBytes);
  if (key.asymmetricKeyType !== "ed25519" || !(0, import_node_crypto19.verify)(
    null,
    Buffer.concat([Buffer.from(DOMAIN), encoded(value)]),
    key,
    Buffer.from(envelope.signature, "base64")
  )) fail8();
  Object.freeze(value.database);
  return Object.freeze(value);
}

// backend/src/services/deploymentControl.ts
var fromDatabase = (row) => ({
  deploymentId: row.id,
  releaseId: row.releaseId,
  targetCommit: row.targetCommit,
  owner: row.owner,
  phase: row.phase,
  leaseToken: row.leaseToken,
  leaseExpiresAt: row.leaseExpiresAt,
  heartbeatAt: row.heartbeatAt,
  startedAt: row.startedAt,
  updatedAt: row.updatedAt
});
var PrismaDeploymentStore = class {
  constructor(prisma) {
    this.prisma = prisma;
  }
  async findActive() {
    const row = await this.prisma.deploymentOperation.findUnique({ where: { activeKey: "production" } });
    return row ? fromDatabase(row) : null;
  }
  async create(record) {
    const blocker = await this.prisma.deploymentOperation.findFirst({
      where: { phase: { in: ["RECOVERY_REQUIRED", "COMPLETED_WITH_NOTIFICATION_FAILURE"] } },
      orderBy: { completedAt: "desc" },
      select: { id: true, phase: true }
    });
    if (blocker) {
      throw Object.assign(new Error(`Deployment is blocked by unresolved operation ${blocker.id} (${blocker.phase}).`), {
        code: "DEPLOYMENT_BLOCKED_BY_UNRESOLVED_FAILURE"
      });
    }
    return fromDatabase(await this.prisma.deploymentOperation.create({
      data: {
        id: record.deploymentId,
        activeKey: "production",
        releaseId: record.releaseId,
        targetCommit: record.targetCommit,
        owner: record.owner,
        phase: record.phase,
        leaseToken: record.leaseToken,
        leaseExpiresAt: record.leaseExpiresAt,
        heartbeatAt: record.heartbeatAt,
        startedAt: record.startedAt
      }
    }));
  }
  async replaceExpired(expectedLeaseToken, record) {
    return this.prisma.$transaction(async (tx) => {
      const released = await tx.deploymentOperation.updateMany({
        where: {
          activeKey: "production",
          leaseToken: expectedLeaseToken,
          leaseExpiresAt: { lte: record.startedAt }
        },
        data: {
          activeKey: null,
          phase: "RECOVERY_REQUIRED",
          completedAt: record.startedAt,
          errorCode: "EXPIRED_LEASE_REPLACED_AFTER_PREFLIGHT"
        }
      });
      if (released.count !== 1) return null;
      return fromDatabase(await tx.deploymentOperation.create({
        data: {
          id: record.deploymentId,
          activeKey: "production",
          releaseId: record.releaseId,
          targetCommit: record.targetCommit,
          owner: record.owner,
          phase: record.phase,
          leaseToken: record.leaseToken,
          leaseExpiresAt: record.leaseExpiresAt,
          heartbeatAt: record.heartbeatAt,
          startedAt: record.startedAt
        }
      }));
    });
  }
  async updateOwned(deploymentId, leaseToken, update) {
    const result = await this.prisma.deploymentOperation.updateMany({
      where: { id: deploymentId, leaseToken, activeKey: "production" },
      data: {
        ...update.phase ? { phase: update.phase } : {},
        ...update.leaseExpiresAt ? { leaseExpiresAt: update.leaseExpiresAt } : {},
        ...update.heartbeatAt ? { heartbeatAt: update.heartbeatAt } : {}
      }
    });
    if (result.count !== 1) return null;
    const row = await this.prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
    return row ? fromDatabase(row) : null;
  }
  async finishOwned(deploymentId, leaseToken, phase, now) {
    const result = await this.prisma.deploymentOperation.updateMany({
      where: { id: deploymentId, leaseToken, activeKey: "production" },
      data: { phase, activeKey: null, completedAt: now }
    });
    if (result.count !== 1) return null;
    const row = await this.prisma.deploymentOperation.findUnique({ where: { id: deploymentId } });
    return row ? fromDatabase(row) : null;
  }
};
var newDeploymentRecord = (input) => ({
  deploymentId: input.deploymentId,
  releaseId: input.releaseId,
  targetCommit: input.targetCommit,
  owner: input.owner,
  phase: "LEASE_ACQUIRED",
  leaseToken: input.leaseToken,
  leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
  heartbeatAt: input.now,
  startedAt: input.now,
  updatedAt: input.now
});
var acquireDeploymentLease = async (store, input) => {
  const active = await store.findActive();
  if (active) {
    const expired = active.leaseExpiresAt.getTime() <= input.now.getTime();
    if (!expired || !input.recoveryPreflightPassed) return { acquired: false, active };
    const replacement = await store.replaceExpired(active.leaseToken, newDeploymentRecord(input));
    return replacement ? { acquired: true, deployment: replacement } : { acquired: false, active: await store.findActive() || active };
  }
  try {
    const deployment = await store.create(newDeploymentRecord(input));
    return { acquired: true, deployment };
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    const concurrent = await store.findActive();
    if (!concurrent) throw error;
    return { acquired: false, active: concurrent };
  }
};
var allowedTransitions = {
  PREFLIGHT: ["LEASE_ACQUIRED", "ABORTED"],
  LEASE_ACQUIRED: ["MAINTENANCE_REQUESTED", "ONLINE_CHECKPOINTING", "ABORTED"],
  ONLINE_CHECKPOINTING: ["ONLINE_EXPANDING", "ABORTED"],
  ONLINE_EXPANDING: ["ONLINE_ACCEPTING", "RECOVERY_REQUIRED"],
  ONLINE_ACCEPTING: ["ONLINE_READY", "RECOVERY_REQUIRED"],
  ONLINE_READY: ["ONLINE_PUBLISHING", "RECOVERY_REQUIRED"],
  ONLINE_PUBLISHING: ["ONLINE_SERVING", "RECOVERY_REQUIRED"],
  ONLINE_SERVING: ["COMPLETED", "ONLINE_ROLLBACK_PUBLISHING", "RECOVERY_REQUIRED"],
  ONLINE_ROLLBACK_PUBLISHING: ["ROLLED_BACK", "RECOVERY_REQUIRED"],
  MAINTENANCE_REQUESTED: ["TRAFFIC_BLOCKED", "ABORTED"],
  TRAFFIC_BLOCKED: ["SERVICES_DRAINED", "ABORTED"],
  SERVICES_DRAINED: ["LOCAL_CHECKPOINT_VERIFIED", "ABORTED"],
  LOCAL_CHECKPOINT_VERIFIED: ["REMOTE_CHECKPOINT_VERIFIED", "ABORTED"],
  REMOTE_CHECKPOINT_VERIFIED: ["MUTATION_STARTED", "ABORTED"],
  MUTATION_STARTED: ["MIGRATIONS_APPLIED", "ROLLBACK_STARTED"],
  MIGRATIONS_APPLIED: ["RELEASE_STARTED", "ROLLBACK_STARTED"],
  RELEASE_STARTED: ["GATES_PASSED", "ROLLBACK_STARTED"],
  GATES_PASSED: ["TRAFFIC_OPENED", "ROLLBACK_STARTED"],
  TRAFFIC_OPENED: ["COMPLETED", "ROLLBACK_STARTED"],
  COMPLETED: [],
  ABORTED: [],
  ROLLBACK_STARTED: ["ROLLED_BACK", "RECOVERY_REQUIRED"],
  ROLLED_BACK: [],
  RECOVERY_REQUIRED: [],
  COMPLETED_WITH_NOTIFICATION_FAILURE: []
};
var transitionDeployment = async (store, input) => {
  const active = await store.findActive();
  if (!active || active.deploymentId !== input.deploymentId || active.leaseToken !== input.leaseToken) {
    throw Object.assign(new Error("Deployment lease ownership was lost."), { code: "DEPLOYMENT_LEASE_LOST" });
  }
  if (!allowedTransitions[active.phase].includes(input.nextPhase)) {
    throw Object.assign(new Error(`Invalid deployment transition ${active.phase} -> ${input.nextPhase}.`), { code: "DEPLOYMENT_TRANSITION_INVALID" });
  }
  const updated = await store.updateOwned(input.deploymentId, input.leaseToken, {
    phase: input.nextPhase,
    updatedAt: input.now
  });
  if (!updated) throw Object.assign(new Error("Deployment lease ownership was lost."), { code: "DEPLOYMENT_LEASE_LOST" });
  return updated;
};
var heartbeatDeployment = async (store, input) => {
  const updated = await store.updateOwned(input.deploymentId, input.leaseToken, {
    heartbeatAt: input.now,
    leaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
    updatedAt: input.now
  });
  if (!updated) throw Object.assign(new Error("Deployment lease ownership was lost."), { code: "DEPLOYMENT_LEASE_LOST" });
  return updated;
};
var terminalPhases = /* @__PURE__ */ new Set(["COMPLETED", "ABORTED", "ROLLED_BACK", "RECOVERY_REQUIRED", "COMPLETED_WITH_NOTIFICATION_FAILURE"]);
var finishDeployment = async (store, input) => {
  if (!terminalPhases.has(input.phase)) {
    throw Object.assign(new Error("Deployment can only be released in a terminal phase."), { code: "DEPLOYMENT_TERMINAL_PHASE_REQUIRED" });
  }
  const updated = await store.finishOwned(input.deploymentId, input.leaseToken, input.phase, input.now);
  if (!updated) throw Object.assign(new Error("Deployment lease ownership was lost."), { code: "DEPLOYMENT_LEASE_LOST" });
  return updated;
};

// backend/src/services/onlineReleaseBootstrap.ts
var import_node_fs8 = __toESM(require("node:fs"));
var import_node_path7 = __toESM(require("node:path"));
var import_node_crypto21 = require("node:crypto");
init_onlineReleaseRegistration();
init_deploymentMaintenance();

// backend/src/services/onlineBootstrapCheckpointLineage.ts
var import_node_crypto20 = require("node:crypto");
var canonical12 = (value) => Array.isArray(value) ? value.map(canonical12) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical12(value[key])])) : value;
var hash11 = (value) => (0, import_node_crypto20.createHash)("sha256").update(JSON.stringify(canonical12(value))).digest("hex");
function requireProof3(value) {
  if (!value) throw Error("ONLINE_BOOTSTRAP_CHECKPOINT_LINEAGE_UNPROVEN");
}
function assertProtectedBootstrapCheckpointLineage(acceptance, activation) {
  const point = acceptance?.qualification?.qualificationCheckpoint, qualified2 = point?.metadata;
  requireProof3(acceptance?.qualification?.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE" && point && Object.keys(point).length === 2 && typeof point.metadataSha256 === "string" && /^[a-f0-9]{64}$/.test(point.metadataSha256) && hash11(qualified2) === point.metadataSha256 && hash11(activation) === acceptance.checkpointSha256);
  const database2 = acceptance.qualification.deploymentTargetDatabase;
  for (const metadata of [qualified2, activation]) requireProof3(metadata?.captureMethod === "PROTECTED_MAINTENANCE_COMPLETE" && hash11(metadata.sourceDatabase) === hash11(database2) && metadata.localVerified === true && metadata.remoteVerified === true && metadata.restoreVerified === true && metadata.manifestReadable === true && metadata.compatibility?.local?.compatible === true && metadata.compatibility?.remote?.compatible === true && typeof metadata.id === "string" && metadata.id.length > 0 && typeof metadata.releaseId === "string" && metadata.releaseId.length > 0 && /^[a-f0-9]{64}$/.test(metadata.checksum) && Number.isSafeInteger(metadata.size) && metadata.size > 0 && /^[a-f0-9]{64}$/.test(metadata.sourceMachineUuidSha256) && /^[a-f0-9]{64}$/.test(metadata.sourceKernelBootIdSha256) && typeof metadata.createdAt === "string" && Number.isFinite(Date.parse(metadata.createdAt)));
  requireProof3(qualified2.sourceMachineUuidSha256 === activation.sourceMachineUuidSha256 && Date.parse(qualified2.createdAt) <= Date.parse(activation.createdAt) && qualified2.id !== activation.id && point.metadataSha256 !== acceptance.checkpointSha256);
  return Object.freeze({
    qualificationCheckpointSha256: point.metadataSha256,
    activationCheckpointSha256: acceptance.checkpointSha256,
    continuousWalQualified: false
  });
}

// backend/src/services/onlineReleaseBootstrap.ts
init_onlineImageExecutionBinding();
var canonical13 = (value) => Array.isArray(value) ? value.map(canonical13) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical13(value[key])])) : value;
var hash12 = (value) => (0, import_node_crypto21.createHash)("sha256").update(JSON.stringify(canonical13(value))).digest("hex");
var pin3 = (st) => [process.platform === "win32" ? 0n : st.dev, st.ino, st.size, st.mtimeNs, st.ctimeNs, st.uid, st.mode, st.nlink].map(String).join(":");
function requireProof4(value, code) {
  if (!value) throw Error(code);
}
function directoryPin(directory) {
  requireProof4(import_node_path7.default.isAbsolute(directory) && import_node_fs8.default.realpathSync(directory) === directory, "ONLINE_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED");
  const st = import_node_fs8.default.lstatSync(directory, { bigint: true });
  requireProof4(st.isDirectory() && !st.isSymbolicLink() && (process.platform === "win32" || (st.mode & 0o077n) === 0n) && (!process.getuid || st.uid === BigInt(process.getuid())), "ONLINE_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED");
  return [st.dev, st.ino, st.uid, st.mode].map(String).join(":");
}
function readPrivate(file, maximum) {
  requireProof4(import_node_path7.default.isAbsolute(file) && import_node_fs8.default.realpathSync(file) === file, "ONLINE_BOOTSTRAP_PRIVATE_PATH_REQUIRED");
  const fd = import_node_fs8.default.openSync(file, import_node_fs8.default.constants.O_RDONLY | import_node_fs8.default.constants.O_NOFOLLOW | import_node_fs8.default.constants.O_NONBLOCK);
  try {
    const st = import_node_fs8.default.fstatSync(fd, { bigint: true });
    requireProof4(st.isFile() && st.nlink === 1n && st.size > 0n && st.size <= BigInt(maximum) && (process.platform === "win32" || (st.mode & 0o077n) === 0n) && (!process.getuid || st.uid === BigInt(process.getuid())), "ONLINE_BOOTSTRAP_PRIVATE_FILE_REQUIRED");
    const raw2 = import_node_fs8.default.readFileSync(fd);
    requireProof4(
      pin3(st) === pin3(import_node_fs8.default.fstatSync(fd, { bigint: true })) && pin3(st) === pin3(import_node_fs8.default.lstatSync(file, { bigint: true })),
      "ONLINE_BOOTSTRAP_FILE_CHANGED"
    );
    return { raw: raw2, pin: pin3(st), sha256: (0, import_node_crypto21.createHash)("sha256").update(raw2).digest("hex"), value: JSON.parse(raw2.toString("utf8")) };
  } finally {
    import_node_fs8.default.closeSync(fd);
  }
}
function maintenance(directory, owner) {
  const observed = readPrivate(import_node_path7.default.join(directory, DEPLOYMENT_MAINTENANCE_FILE), 16384);
  requireProof4(
    observed.value.deploymentId === owner.deploymentId && observed.value.releaseId === owner.releaseId && typeof observed.value.message === "string" && Number.isFinite(Date.parse(observed.value.activatedAt)),
    "ONLINE_BOOTSTRAP_OWNED_MAINTENANCE_REQUIRED"
  );
  return observed;
}
var operations = /* @__PURE__ */ new WeakMap();
async function assertBoundary(tx, state, phases) {
  requireProof4(
    directoryPin(state.coordinationDirectory) === state.coordinationPin && directoryPin(state.publicationDirectory) === state.publicationPin,
    "ONLINE_BOOTSTRAP_DIRECTORY_CHANGED"
  );
  const observed = maintenance(state.coordinationDirectory, state.owner);
  requireProof4(observed.pin === state.maintenancePin, "ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED");
  const rows = await tx.$queryRaw`
  SELECT "releaseId","targetCommit",phase,"checkpointJson" FROM deployment_operations
  WHERE id=${state.owner.deploymentId} AND "leaseToken"=${state.owner.leaseToken} AND "activeKey"='production'
   AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
  const { manifest, acceptance } = state.validated;
  requireProof4(rows.length === 1 && rows[0].releaseId === state.owner.releaseId && rows[0].targetCommit === manifest.sourceCommit && phases.includes(rows[0].phase), "ONLINE_BOOTSTRAP_PROTECTED_LEASE_REQUIRED");
  const checkpoint = rows[0].checkpointJson;
  requireProof4(
    checkpoint && checkpoint.deploymentId === state.owner.deploymentId && checkpoint.releaseId === manifest.releaseId && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.restoreVerified === true && checkpoint.manifestReadable === true && checkpoint.compatibility?.local?.compatible === true && checkpoint.compatibility?.remote?.compatible === true && hash12(checkpoint) === acceptance.checkpointSha256,
    "ONLINE_BOOTSTRAP_VERIFIED_CHECKPOINT_REQUIRED"
  );
  assertProtectedBootstrapCheckpointLineage(acceptance, checkpoint);
  const identities = await tx.$queryRaw`
  SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid
  FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
  requireProof4(
    identities.length === 1 && hash12(identities[0]) === hash12({ ...manifest.database, oid: acceptance.qualification.deploymentTargetDatabase.oid }),
    "ONLINE_BOOTSTRAP_DATABASE_CHANGED"
  );
  state.validated.accepted.revalidate();
  requireProof4(maintenance(state.coordinationDirectory, state.owner).pin === state.maintenancePin, "ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED");
}
async function prepareProtectedOnlineBootstrap(database2, owner, input, paths) {
  requireProof4(input.previousReleaseId === null, "ONLINE_BOOTSTRAP_MUST_HAVE_NO_PREDECESSOR");
  const validated = prepareValidatedOnlineRegistration(owner, input);
  requireProof4(validated.acceptance.qualification.recoveryMode === "PROTECTED_MAINTENANCE_COMPLETE", "ONLINE_BOOTSTRAP_PROTECTED_COMPLETE_REQUIRED");
  requireProof4(validated.manifest.generation === 1, "ONLINE_BOOTSTRAP_GENERATION_ONE_REQUIRED");
  const observed = maintenance(paths.coordinationDirectory, owner);
  const state = {
    database: database2,
    owner: Object.freeze({ ...owner }),
    input: structuredClone(input),
    validated,
    ...paths,
    coordinationPin: directoryPin(paths.coordinationDirectory),
    publicationPin: directoryPin(paths.publicationDirectory),
    maintenancePin: observed.pin,
    completed: false
  };
  await database2.$transaction(async (tx) => {
    await assertBoundary(tx, state, ["MIGRATIONS_APPLIED", "RELEASE_STARTED"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741936426)`;
    const prior = await tx.$queryRaw`SELECT
   (SELECT count(*)::int FROM online_releases) AS releases,(SELECT count(*)::int FROM online_serving_epochs) AS epochs`;
    requireProof4(prior.length === 1 && prior[0].releases === 0 && prior[0].epochs === 0, "ONLINE_BOOTSTRAP_REGISTRY_NOT_EMPTY");
    requireProof4(import_node_fs8.default.readdirSync(state.publicationDirectory).length === 0, "ONLINE_BOOTSTRAP_PUBLICATION_ALREADY_EXISTS");
    const { manifest, acceptance, identityJson, compatibilityJson, recoveryJson, slots } = validated;
    await tx.onlineRelease.create({ data: {
      id: owner.releaseId,
      deploymentId: owner.deploymentId,
      manifestSha256: input.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      identityJson,
      compatibilityJson,
      recoveryJson,
      acceptanceJson: acceptance,
      phase: "READY",
      previousReleaseId: null
    } });
    await tx.onlineRuntimeSlot.createMany({ data: slots });
    await assertBoundary(tx, state, ["MIGRATIONS_APPLIED", "RELEASE_STARTED"]);
  }, { timeout: 3e4, maxWait: 1e3 });
  const capability = Object.freeze({});
  operations.set(capability, state);
  return capability;
}
function assertProtectedOnlineBootstrap(capability, database2, owner) {
  const state = operations.get(capability);
  requireProof4(state && !state.completed && state.database === database2 && hash12(state.owner) === hash12(owner), "ONLINE_ORIGINAL_BOOTSTRAP_REQUIRED");
  requireProof4(
    directoryPin(state.coordinationDirectory) === state.coordinationPin && directoryPin(state.publicationDirectory) === state.publicationPin,
    "ONLINE_BOOTSTRAP_DIRECTORY_CHANGED"
  );
  requireProof4(maintenance(state.coordinationDirectory, state.owner).pin === state.maintenancePin, "ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED");
  state.validated.accepted.revalidate();
  return {
    input: structuredClone(state.input),
    coordinationDirectory: state.coordinationDirectory,
    publicationDirectory: state.publicationDirectory,
    maintenanceSha256: maintenance(state.coordinationDirectory, state.owner).sha256
  };
}
async function finalizeProtectedOnlineBootstrap(capability, database2, owner, expectedPublicationSha256) {
  assertProtectedOnlineBootstrap(capability, database2, owner);
  const state = operations.get(capability);
  requireProof4(/^[a-f0-9]{64}$/.test(expectedPublicationSha256), "ONLINE_BOOTSTRAP_PUBLICATION_HASH_REQUIRED");
  const head = readPrivate(import_node_path7.default.join(state.publicationDirectory, "published-00000001.json"), 4 * 1024 * 1024), record = head.value;
  requireProof4(head.sha256 === expectedPublicationSha256 && record.format === "sabalan-browser-publication/v1" && record.generation === 1 && record.previousPublicationSha256 === null && record.registry?.generation === 1 && head.raw.equals(Buffer.from(JSON.stringify(canonical13(record)) + "\n")) && import_node_fs8.default.readdirSync(state.publicationDirectory).join(",") === "published-00000001.json", "ONLINE_BOOTSTRAP_FIRST_PUBLICATION_UNPROVEN");
  const current = record.registry.builds?.find((build) => build.id === record.registry.current?.erp);
  const stable = (build) => ({
    id: build.id,
    application: build.application,
    image: build.image,
    manifestSha256: build.manifestSha256,
    assets: build.assets,
    actionIds: build.actionIds
  });
  const graph = state.validated.accepted.acceptance.qualification.imageGraphs.frontend;
  const qualification = state.validated.accepted.acceptance.qualification;
  const execution = validateProductionExecutionBindings(qualification.productionExecutionBindings, { ...qualification, releaseId: state.owner.releaseId });
  const qualifiedStable = (build) => stable({ ...build, image: build.image === graph.index ? execution.frontend : build.image });
  requireProof4(
    current && state.validated.accepted.browserRegistries.some((registry) => registry.builds.some((build) => hash12(qualifiedStable(build)) === hash12(stable(current)))),
    "ONLINE_BOOTSTRAP_UI_NOT_QUALIFIED"
  );
  const binding = record.registry.apiBindings?.find((value) => value.buildId === current.id);
  const runtime = state.input.scopes.find((value) => value.scope.purpose === "http" && binding?.slotId === "backend_" + value.scope.runtimeId && binding.image === value.scope.image && binding.manifestSha256 === value.scope.manifestSha256);
  requireProof4(runtime && binding.browserManifestSha256 === current.manifestSha256, "ONLINE_BOOTSTRAP_PAIRED_BACKEND_UNPROVEN");
  const receipt = await database2.$transaction(async (tx) => {
    await assertBoundary(tx, state, ["GATES_PASSED"]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(741936426)`;
    const rows = await tx.$queryRaw`SELECT id FROM online_runtime_slots
   WHERE id=${runtime.scope.runtimeId} AND "releaseId"=${owner.releaseId} AND phase='READY' AND "stoppedAt" IS NULL FOR UPDATE`;
    requireProof4(rows.length === 1, "ONLINE_BOOTSTRAP_ORIGINAL_READY_REQUIRED");
    const releases = await tx.$queryRaw`SELECT id FROM online_releases WHERE id=${owner.releaseId}
   AND phase='READY' AND "previousReleaseId" IS NULL FOR UPDATE`;
    const epochs = await tx.$queryRaw`SELECT id FROM online_serving_epochs FOR UPDATE`;
    requireProof4(releases.length === 1 && epochs.length === 0, "ONLINE_BOOTSTRAP_HEAD_ALREADY_EXISTS");
    requireProof4(
      readPrivate(import_node_path7.default.join(state.publicationDirectory, "published-00000001.json"), 4 * 1024 * 1024).pin === head.pin,
      "ONLINE_BOOTSTRAP_PUBLICATION_CHANGED"
    );
    const epochId = (0, import_node_crypto21.randomUUID)();
    await tx.$executeRaw`INSERT INTO online_serving_epochs(id,"releaseId","deploymentId",generation,"publicationSha256","servedAt")
   VALUES (${epochId},${owner.releaseId},${owner.deploymentId},1,${head.sha256},clock_timestamp())`;
    await tx.$executeRaw`UPDATE online_releases SET phase='SERVING',"servedAt"=clock_timestamp(),"updatedAt"=clock_timestamp()
   WHERE id=${owner.releaseId} AND phase='READY'`;
    await assertBoundary(tx, state, ["GATES_PASSED"]);
    return Object.freeze({
      epochId,
      releaseId: owner.releaseId,
      generation: 1,
      publicationSha256: head.sha256,
      deploymentPhase: "GATES_PASSED",
      publicTrafficOpened: false,
      legacyReleaseAdopted: false
    });
  }, { timeout: 3e4, maxWait: 1e3 });
  state.completed = true;
  return receipt;
}

// backend/src/services/onlineReleaseExpansion.ts
var import_node_crypto22 = require("node:crypto");
init_onlineReleaseRegistration();
init_onlineMigrationPlan();
init_deploymentMaintenance();
init_recoveryRuntime();
var canonical14 = (v) => Array.isArray(v) ? v.map(canonical14) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical14(v[k])])) : v;
var hash13 = (v) => (0, import_node_crypto22.createHash)("sha256").update(JSON.stringify(canonical14(v))).digest("hex");
function required3(v, code) {
  if (!v) throw Error(code);
}
function qualified(input) {
  required3(input.acceptance.qualification.recoveryMode === "ONLINE_COHERENT_WAL", "ONLINE_EXPANSION_COHERENT_WAL_REQUIRED");
  const plans2 = input.accepted.migrationPlans.map(compileOnlineExpansion).sort((a, b) => a.plan.migrationName.localeCompare(b.plan.migrationName));
  required3(new Set(plans2.map((plan) => plan.plan.migrationName)).size === plans2.length, "ONLINE_EXPANSION_DUPLICATE_QUALIFIED_PLAN");
  const histories = input.accepted.migrationHistories;
  required3(histories.length > 0 && histories.every((value) => hash13(value.before) === hash13(histories[0].before) && value.afterRows === value.before.rows + plans2.length), "ONLINE_EXPANSION_QUALIFIED_HISTORY_CHANGED");
  const steps = [];
  for (const compiled of plans2) {
    steps.push({
      stepId: compiled.plan.migrationName,
      phase: "expand",
      operationSha256: compiled.operationSha256,
      operationJson: JSON.parse(JSON.stringify(compiled.plan)),
      sourceMigrationName: compiled.plan.migrationName
    });
    for (const operation of compiled.plan.operations) if (operation.kind === "mirror-column") {
      const plan = { format: "sabalan-mirror-backfill/v1", expansionMigrationName: compiled.plan.migrationName, operation };
      steps.push({
        stepId: compiled.plan.migrationName + ":" + operation.table + ":" + operation.column,
        phase: "backfill",
        operationSha256: mirroredBackfillOperationSha256(plan),
        operationJson: JSON.parse(JSON.stringify(plan)),
        sourceMigrationName: null
      });
    }
  }
  required3(new Set(steps.map((step) => step.stepId)).size === steps.length, "ONLINE_EXPANSION_DUPLICATE_STEP");
  return { plans: plans2, steps: steps.sort((a, b) => a.stepId.localeCompare(b.stepId)), history: histories[0].before };
}
async function assertContext(tx, owner, input, prepared, phases, releasePhases) {
  required3(!deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR), "ONLINE_EXPANSION_PROTECTED_BOUNDARY");
  await assertOwnedOnlineLease(tx, owner, phases);
  const rows = await tx.$queryRaw`
  SELECT "targetCommit","checkpointJson" FROM deployment_operations WHERE id=${owner.deploymentId}`;
  const checkpoint = rows[0]?.checkpointJson;
  required3(
    rows.length === 1 && rows[0].targetCommit === prepared.manifest.sourceCommit && checkpoint && checkpoint.deploymentId === owner.deploymentId && checkpoint.releaseId === owner.releaseId && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.restoreVerified === true && checkpoint.manifestReadable === true && checkpoint.compatibility?.local?.compatible === true && checkpoint.compatibility?.remote?.compatible === true && hash13(checkpoint) === prepared.acceptance.checkpointSha256,
    "ONLINE_EXPANSION_VERIFIED_CHECKPOINT_REQUIRED"
  );
  const previous = await tx.$queryRaw`SELECT r.id FROM online_releases r
  WHERE r.id=${input.previousReleaseId} AND r.phase='SERVING' AND EXISTS(SELECT 1 FROM online_serving_epochs e
   WHERE e."releaseId"=r.id AND e."retiredAt" IS NULL) FOR SHARE`;
  required3(previous.length === 1, "ONLINE_EXPANSION_PREDECESSOR_CHANGED");
  const identities = await tx.$queryRaw`SELECT current_database() AS name,
  (SELECT system_identifier::text FROM pg_control_system()) AS system,
  (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
  required3(
    identities.length === 1 && identities[0].name === prepared.manifest.database.name && identities[0].system === prepared.manifest.database.systemIdentifier && identities[0].oid === prepared.acceptance.qualification.deploymentTargetDatabase.oid,
    "ONLINE_EXPANSION_DATABASE_CHANGED"
  );
  if (releasePhases) {
    const release = await tx.onlineRelease.findUnique({ where: { id: owner.releaseId } });
    required3(release && releasePhases.includes(release.phase) && release.deploymentId === owner.deploymentId && release.previousReleaseId === input.previousReleaseId && release.sourceCommit === prepared.manifest.sourceCommit && release.manifestSha256 === input.manifestSha256 && hash13(release.identityJson) === hash13(prepared.identityJson) && hash13(release.compatibilityJson) === hash13(prepared.compatibilityJson) && hash13(release.recoveryJson) === hash13(prepared.recoveryJson) && hash13(release.acceptanceJson) === hash13(prepared.acceptance), "ONLINE_EXPANSION_PREPARATION_CHANGED");
    prepared.accepted.revalidate();
    return release;
  }
  prepared.accepted.revalidate();
  return void 0;
}
async function assertUnchangedPriorHistory(tx, expected) {
  const names = expected.plans.map((value) => value.plan.migrationName).join(",");
  const rows = await tx.$queryRaw`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value
  FROM public._prisma_migrations t WHERE NOT(migration_name=ANY(string_to_array(${names},',')))`;
  required3(rows.length === 1 && JSON.parse(rows[0].value).length === expected.history.rows && (0, import_node_crypto22.createHash)("sha256").update(rows[0].value).digest("hex") === expected.history.sha256, "ONLINE_EXPANSION_PRIOR_HISTORY_CHANGED");
}
async function assertSteps(tx, owner, expected) {
  const actual = await tx.onlineMigrationStep.findMany({ where: { releaseId: owner.releaseId }, orderBy: { stepId: "asc" } });
  const identity2 = (step) => ({
    stepId: step.stepId,
    phase: step.phase,
    operationSha256: step.operationSha256,
    operationJson: step.operationJson,
    sourceMigrationName: step.sourceMigrationName ?? null
  });
  required3(hash13(actual.map(identity2).sort((a, b) => a.stepId.localeCompare(b.stepId))) === hash13(expected.steps) && actual.every((step) => ["PENDING", "RUNNING", "COMPLETE"].includes(step.state)), "ONLINE_EXPANSION_STEP_LEDGER_CHANGED");
  return actual;
}
async function prepareAcceptedOnlineExpansion(database2, owner, input) {
  required3(input.previousReleaseId !== null, "ONLINE_EXPANSION_BOOTSTRAP_REQUIRED");
  const prepared = prepareValidatedOnlineRegistration(owner, input), expected = qualified(prepared);
  await database2.$transaction(async (tx) => {
    await assertContext(tx, owner, input, prepared, ["ONLINE_CHECKPOINTING"]);
    await assertUnchangedPriorHistory(tx, expected);
    const names = expected.plans.map((value) => value.plan.migrationName).join(",");
    const existing = await tx.$queryRaw`SELECT migration_name FROM public._prisma_migrations
   WHERE migration_name=ANY(string_to_array(${names},','))`;
    required3(existing.length === 0, "ONLINE_EXPANSION_FRESH_PLAN_ALREADY_APPLIED");
    const { manifest, acceptance, identityJson, compatibilityJson, recoveryJson, slots } = prepared;
    await tx.onlineRelease.create({ data: {
      id: owner.releaseId,
      deploymentId: owner.deploymentId,
      manifestSha256: input.manifestSha256,
      sourceCommit: manifest.sourceCommit,
      identityJson,
      compatibilityJson,
      recoveryJson,
      acceptanceJson: acceptance,
      phase: "EXPANDING",
      previousReleaseId: input.previousReleaseId
    } });
    await tx.onlineRuntimeSlot.createMany({ data: slots });
    for (const step of expected.steps) await tx.onlineMigrationStep.create({ data: { id: (0, import_node_crypto22.randomUUID)(), releaseId: owner.releaseId, ...step, state: "PENDING" } });
    prepared.accepted.revalidate();
    await tx.deploymentOperation.update({ where: { id: owner.deploymentId }, data: { phase: "ONLINE_EXPANDING" } });
  }, { timeout: 3e4, maxWait: 1e3 });
  return { releaseId: owner.releaseId, qualifiedPlans: expected.plans.length, productionMutationStarted: false, productionAdmission: false };
}
async function runAcceptedOnlineExpansion(database2, owner, input) {
  required3(input.previousReleaseId !== null, "ONLINE_EXPANSION_BOOTSTRAP_REQUIRED");
  const prepared = prepareValidatedOnlineRegistration(owner, input), expected = qualified(prepared);
  const inspect = () => database2.$transaction(async (tx) => {
    const release2 = await assertContext(tx, owner, input, prepared, ["ONLINE_EXPANDING"], ["EXPANDING", "BACKFILLING"]);
    await assertUnchangedPriorHistory(tx, expected);
    await assertSteps(tx, owner, expected);
    return release2;
  }, { timeout: 15e3, maxWait: 1e3 });
  const release = await inspect();
  if (release.phase === "EXPANDING") {
    for (const compiled of expected.plans) {
      await inspect();
      prepared.accepted.revalidate();
      await applyOnlineExpansion(database2, owner, compiled.plan, Buffer.from(compiled.sql));
    }
    await database2.$transaction(async (tx) => {
      await assertContext(tx, owner, input, prepared, ["ONLINE_EXPANDING"], ["EXPANDING"]);
      await assertUnchangedPriorHistory(tx, expected);
      const steps = await assertSteps(tx, owner, expected);
      required3(steps.filter((step) => step.phase === "expand").every((step) => step.state === "COMPLETE"), "ONLINE_EXPANSION_DDL_NOT_COMPLETE");
      await tx.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: "BACKFILLING" } });
    }, { timeout: 15e3, maxWait: 1e3 });
  }
  for (const compiled of expected.plans) {
    await inspect();
    await verifyAppliedOnlineExpansion(database2, owner, compiled.plan);
  }
  for (const step of expected.steps.filter((value) => value.phase === "backfill")) {
    let complete = false;
    while (!complete) {
      await inspect();
      prepared.accepted.revalidate();
      complete = (await backfillMirroredColumn(database2, owner, step.stepId, step.operationJson, 200)).complete;
    }
  }
  for (const compiled of expected.plans) {
    await inspect();
    await verifyAppliedOnlineExpansion(database2, owner, compiled.plan);
  }
  await database2.$transaction(async (tx) => {
    await assertContext(tx, owner, input, prepared, ["ONLINE_EXPANDING"], ["BACKFILLING"]);
    await assertUnchangedPriorHistory(tx, expected);
    const steps = await assertSteps(tx, owner, expected);
    required3(steps.every((step) => step.state === "COMPLETE"), "ONLINE_EXPANSION_STEPS_NOT_COMPLETE");
    prepared.accepted.revalidate();
    await tx.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: "ACCEPTING" } });
    await tx.deploymentOperation.update({ where: { id: owner.deploymentId }, data: { phase: "ONLINE_ACCEPTING" } });
  }, { timeout: 15e3, maxWait: 1e3 });
  return { releaseId: owner.releaseId, phase: "ONLINE_ACCEPTING", qualifiedSchemaVerified: true, productionAdmission: false };
}

// backend/src/scripts/online-release-host-kernel.ts
init_onlineQualificationProvenance();
init_protectedFinancialQualificationProvenance();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PrismaDeploymentStore,
  acquireDeploymentLease,
  assertOwnedOnlineLease,
  assertProtectedOnlineBootstrap,
  finalizeProtectedOnlineBootstrap,
  finishDeployment,
  heartbeatDeployment,
  openProtectedFinancialQualificationDirectory,
  openTrustedOnlineQualification,
  prepareAcceptedOnlineExpansion,
  prepareProtectedOnlineBootstrap,
  productionImageInspectionSha256,
  readOnlineReleaseEvidence,
  recordOwnedOnlinePublication,
  registerAcceptedOnlineRelease,
  registerRetainedOnlineIncarnations,
  registerRetainedOnlineWorker,
  runAcceptedOnlineExpansion,
  transitionDeployment,
  validateProductionExecutionBindings,
  verifyOnlineQualificationOrigin,
  verifyOnlineStartupDecision
});
