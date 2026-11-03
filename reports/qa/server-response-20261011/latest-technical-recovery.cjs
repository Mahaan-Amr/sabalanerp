"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
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

// src/services/__tests__/partnerTechnicalRecovery.integration.test.ts
var import_strict = __toESM(require("node:assert/strict"));
var import_node_test = __toESM(require("node:test"));
var import_node_crypto4 = require("node:crypto");
var import_client14 = require("@prisma/client");
var import_partner_sales_contracts20 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/cases/technicalRecovery.ts
var import_client5 = require("@prisma/client");
var import_node_crypto = require("node:crypto");
var import_partner_sales_contracts6 = require("@sabalanerp/partner-sales-contracts");

// src/lib/prisma.ts
var import_client = require("@prisma/client");
var globalDatabaseClient = globalThis;
var prisma = globalDatabaseClient.sabalanPrismaClient ?? new import_client.PrismaClient();
if (process.env.NODE_ENV !== "production") {
  globalDatabaseClient.sabalanPrismaClient = prisma;
}

// src/services/contractEditSessionService.ts
var import_client2 = require("@prisma/client");

// src/services/contractRecoveryProtection.ts
var PARTNER_TECHNICAL_RECOVERY_KIND = "partner-technical-recovery";

// src/services/contractEditSessionService.ts
var CONTRACT_EDIT_LEASE_TTL_MS = 75e3;
var CONTRACT_CREATION_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
var toJson = (value) => JSON.parse(JSON.stringify(value));
var snapshotWhere = (expected) => ({
  draftId: expected.draftId,
  leaseToken: expected.leaseToken,
  ownerUserId: expected.ownerUserId,
  browserSessionId: expected.browserSessionId,
  contractId: expected.contractId,
  purpose: expected.purpose,
  baseRevision: expected.baseRevision,
  schemaVersion: expected.schemaVersion,
  createdAt: expected.createdAt,
  updatedAt: expected.updatedAt,
  takenOverAt: expected.takenOverAt,
  // JSON equality matters even when both updates share a millisecond.
  recovery: { equals: expected.recovery === null ? import_client2.Prisma.AnyNull : toJson(expected.recovery) }
});
var fromPrismaRecord = (record3) => ({
  ...record3,
  purpose: record3.purpose === "PARTNER_TECHNICAL" ? "PARTNER_TECHNICAL" : "STANDARD",
  recovery: record3.recovery
});
var PrismaContractEditSessionStore = class {
  constructor(prisma2) {
    this.prisma = prisma2;
  }
  transaction(work) {
    return "$transaction" in this.prisma ? this.prisma.$transaction(work) : work(this.prisma);
  }
  async load(draftId) {
    const record3 = await this.prisma.salesContractEditSession.findUnique({ where: { draftId } });
    return record3 ? fromPrismaRecord(record3) : null;
  }
  async create(record3) {
    const created = await this.prisma.salesContractEditSession.create({
      data: {
        draftId: record3.draftId,
        contractId: record3.contractId,
        ownerUserId: record3.ownerUserId,
        purpose: record3.purpose,
        browserSessionId: record3.browserSessionId,
        leaseToken: record3.leaseToken,
        schemaVersion: record3.schemaVersion,
        baseRevision: record3.baseRevision,
        recovery: record3.recovery === null ? import_client2.Prisma.JsonNull : toJson(record3.recovery),
        createdAt: record3.createdAt,
        updatedAt: record3.updatedAt,
        takenOverAt: record3.takenOverAt
      }
    });
    return fromPrismaRecord(created);
  }
  async compareAndReplace(expected, record3) {
    if (expected.draftId !== record3.draftId) return null;
    return this.transaction(async (tx) => {
      const updated = await tx.salesContractEditSession.updateMany({
        where: snapshotWhere(expected),
        data: {
          contractId: record3.contractId,
          ownerUserId: record3.ownerUserId,
          purpose: record3.purpose,
          browserSessionId: record3.browserSessionId,
          leaseToken: record3.leaseToken,
          schemaVersion: record3.schemaVersion,
          baseRevision: record3.baseRevision,
          recovery: record3.recovery === null ? import_client2.Prisma.JsonNull : toJson(record3.recovery),
          createdAt: record3.createdAt,
          updatedAt: record3.updatedAt,
          takenOverAt: record3.takenOverAt
        }
      });
      if (updated.count !== 1) return null;
      const current = await tx.salesContractEditSession.findUnique({ where: { draftId: record3.draftId } });
      return current ? fromPrismaRecord(current) : null;
    });
  }
  async remove(draftId, leaseToken) {
    const removed = await this.prisma.salesContractEditSession.deleteMany({
      where: { draftId, leaseToken }
    });
    return removed.count === 1;
  }
  async listCreationDrafts(ownerUserId) {
    const records = await this.prisma.salesContractEditSession.findMany({
      where: { ownerUserId, contractId: null },
      orderBy: { updatedAt: "desc" }
    });
    return records.map(fromPrismaRecord);
  }
  async purgeIfUnchanged(expected) {
    const removed = await this.prisma.salesContractEditSession.deleteMany({ where: snapshotWhere(expected) });
    return removed.count === 1;
  }
  async discardCreationDraft(draftId, ownerUserId, discardedAt) {
    return this.transaction(async (tx) => {
      const removed = await tx.salesContractEditSession.deleteMany({
        where: { draftId, ownerUserId, contractId: null }
      });
      if (removed.count !== 1) return false;
      await tx.salesContractDraftAudit.create({
        data: { draftId, ownerUserId, action: "DISCARDED", createdAt: discardedAt }
      });
      return true;
    });
  }
};
var prismaStore = new PrismaContractEditSessionStore(prisma);

// src/services/partnerSales/cases/technicalRecoveryRecords.ts
var import_partner_sales_contracts = require("@sabalanerp/partner-sales-contracts");
var object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
function decodeTechnicalRecovery(value) {
  const record3 = object(value);
  if (!record3 || record3.kind !== PARTNER_TECHNICAL_RECOVERY_KIND || record3.version !== 1 || typeof record3.recoveryRevision !== "number" || !Number.isSafeInteger(record3.recoveryRevision) || record3.recoveryRevision < 1 || typeof record3.updatedAt !== "number" || !Number.isSafeInteger(record3.updatedAt) || record3.updatedAt <= 0 || !Number.isFinite(new Date(record3.updatedAt).getTime())) return void 0;
  const draft = import_partner_sales_contracts.PartnerTechnicalDraftSchema.safeParse(record3.draft);
  if (!draft.success) return void 0;
  return {
    ...record3,
    kind: PARTNER_TECHNICAL_RECOVERY_KIND,
    version: 1,
    recoveryRevision: record3.recoveryRevision,
    updatedAt: record3.updatedAt,
    draft: draft.data
  };
}
function decodeTechnicalReceipt(value) {
  const record3 = object(value);
  if (!record3 || typeof record3.sessionId !== "string" || !record3.sessionId || Object.keys(record3).some((key2) => key2 !== "sessionId" && key2 !== "receipt")) return void 0;
  const receipt = import_partner_sales_contracts.PartnerTechnicalCheckpointReceiptSchema.safeParse(record3.receipt);
  return receipt.success ? { sessionId: record3.sessionId, receipt: receipt.data } : void 0;
}

// src/services/partnerSales/authorization/technicalRollout.ts
var import_partner_sales_contracts2 = require("@sabalanerp/partner-sales-contracts");
var PARTNER_OPERATIONS_CONTROL_ID = "partner-operations";
async function lockPartnerOperationsControl(tx) {
  await tx.$queryRaw`SELECT id FROM partner_operations_controls
    WHERE id = ${PARTNER_OPERATIONS_CONTROL_ID} FOR UPDATE`;
  return tx.partnerOperationsControl.findUnique({
    where: { id: PARTNER_OPERATIONS_CONTROL_ID },
    select: { cohortId: true, operationalPaused: true }
  });
}
async function authorizePartnerTechnicalRollout(tx, profileId, operation) {
  const direct = tx.partnerConversionDisposition && await tx.partnerConversionDisposition.findFirst({ where: {
    profileId,
    sourceType: "PARTNER_ACTIVATION",
    disposition: "DIRECT_V4"
  }, select: { id: true } });
  if (direct) return { ok: true, value: void 0 };
  const control = operation === "READ" ? await tx.partnerOperationsControl.findUnique({
    where: { id: PARTNER_OPERATIONS_CONTROL_ID },
    select: { cohortId: true, operationalPaused: true }
  }) : await lockPartnerOperationsControl(tx);
  if (!control) return { ok: false, error: (0, import_partner_sales_contracts2.partnerError)("COHORT_NOT_READY") };
  if (operation === "COMMITTED_FULFILLMENT") return { ok: true, value: void 0 };
  if (!control.cohortId) return { ok: false, error: (0, import_partner_sales_contracts2.partnerError)("COHORT_NOT_READY") };
  const memberships = await tx.partnerCohortMembership.findMany({ where: {
    profileId,
    cohortId: control.cohortId,
    cohort: { activationEnabled: true }
  }, select: { cohortId: true } });
  if (memberships.length !== 1) return { ok: false, error: (0, import_partner_sales_contracts2.partnerError)("COHORT_NOT_READY") };
  if (operation === "READ") return { ok: true, value: void 0 };
  const cohortId = memberships[0].cohortId;
  await tx.$queryRaw`SELECT id FROM partner_release_cohorts WHERE id = ${cohortId} FOR UPDATE`;
  const cohort = await tx.partnerReleaseCohort.findUnique({
    where: { id: cohortId },
    select: { activationEnabled: true, operationalPaused: true }
  });
  if (!cohort?.activationEnabled) return { ok: false, error: (0, import_partner_sales_contracts2.partnerError)("COHORT_NOT_READY") };
  return { ok: true, value: void 0 };
}

// src/services/partnerSales/cases/technicalEvidence.ts
var import_client4 = require("@prisma/client");
var import_contract_product_graph2 = require("@sabalanerp/contract-product-graph");
var import_partner_sales_contracts4 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/crm/technicalCatalog.ts
var import_contract_product_graph = require("@sabalanerp/contract-product-graph");
var import_client3 = require("@prisma/client");
var import_partner_sales_contracts3 = require("@sabalanerp/partner-sales-contracts");
function catalogMaterialRateToman(value, currency) {
  if (!["\u0631\u06CC\u0627\u0644", "IRR", "\u062A\u0648\u0645\u0627\u0646", "IRT"].includes(currency)) throw new Error("Unknown catalog currency");
  return (0, import_contract_product_graph.parseCanonicalDecimal)(new import_client3.Prisma.Decimal(value.toString()).div(currency === "\u0631\u06CC\u0627\u0644" || currency === "IRR" ? 10 : 1).toFixed());
}
function projectPartnerTechnicalOperation(source) {
  try {
    if (source.isActive !== true) return { ok: false, error: (0, import_partner_sales_contracts3.partnerError)("NOT_FOUND") };
    const identity = { catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString() };
    const operationUnit = (base) => base === "length" ? "meter" : base === "squareMeters" ? "squareMeter" : void 0;
    const item = source.kind === "LAYER" ? { ...identity, kind: source.kind, name: source.name, unit: source.calculationUnit } : {
      ...identity,
      kind: source.kind,
      name: source.namePersian,
      unit: operationUnit(source.calculationBase),
      ...source.kind === "FINISHING" ? { incompatibleCatalogItemIds: source.incompatibleCatalogItemIds } : {}
    };
    return { ok: true, value: import_partner_sales_contracts3.PartnerTechnicalOperationSchema.parse(item) };
  } catch {
    return { ok: false, error: (0, import_partner_sales_contracts3.partnerError)("INVALID_PAYLOAD") };
  }
}
function projectPartnerTechnicalProduct(source) {
  try {
    if (source.isActive !== true || source.deletedAt !== null) {
      return { ok: false, error: (0, import_partner_sales_contracts3.partnerError)("NOT_FOUND") };
    }
    const dimension = (value) => {
      if (value === null) return void 0;
      const normalized = (0, import_contract_product_graph.parseCanonicalDecimal)(value.toString());
      return normalized === "0" ? void 0 : normalized;
    };
    const families = [];
    if (source.availableInLongitudinalContracts) families.push("longitudinal");
    if (source.availableInStairContracts) families.push("stair");
    if (source.availableInSlabContracts) families.push("slab");
    if (source.availableInVolumetricContracts) families.push("prepared", "volumetric");
    return { ok: true, value: import_partner_sales_contracts3.PartnerTechnicalProductSchema.parse({
      catalogItemId: source.id,
      catalogSnapshotVersion: source.updatedAt.toISOString(),
      code: source.code,
      name: source.namePersian,
      families,
      ...source.basePrice != null && new import_client3.Prisma.Decimal(source.basePrice.toString()).gt(0) ? { suggestedRetailUnitPrice: { amount: catalogMaterialRateToman(source.basePrice, source.currency ?? ""), currency: "IRT" } } : {},
      salesUnits: { prepared: source.preparedSalesUnit, volumetric: source.volumetricSalesUnit },
      dimensions: {
        motherWidthCentimeters: dimension(source.widthValue),
        motherLengthMeters: dimension(source.motherLengthValue),
        thicknessCentimeters: dimension(source.thicknessValue)
      },
      attributes: {
        stoneType: source.stoneTypeNamePersian,
        mine: source.mineNamePersian,
        finish: source.finishNamePersian,
        color: source.colorNamePersian,
        quality: source.qualityNamePersian,
        cuttingDimension: source.cuttingDimensionNamePersian
      },
      isAvailable: source.isAvailable
    }) };
  } catch {
    return { ok: false, error: (0, import_partner_sales_contracts3.partnerError)("INVALID_PAYLOAD") };
  }
}

// src/services/partnerSales/cases/technicalEvidence.ts
var policyKeys = [
  "schemaVersion",
  "purpose",
  "calculationPolicy",
  "mandatoryPercentage",
  "mandatoryEnabled",
  "slabCuttingPricingMethod",
  "sawKerfMeters",
  "materialRateScale",
  "currency",
  "rates"
];
var versionKeys = ["calculation", "packing", "pricing", "rounding"];
var rateKeys = [
  "longitudinalCutRateToman",
  "crossCutRateToman",
  "calibrationCutRateToman",
  "verticalCutRateToman",
  "squareMeterCutRateToman"
];
function exactKeys(value, keys) {
  return Object.keys(value).length === keys.length && Object.keys(value).every((key2) => keys.includes(key2));
}
function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : void 0;
}
function decimal(value, positive = false) {
  if (typeof value !== "string") return void 0;
  try {
    const parsed = (0, import_contract_product_graph2.parseCanonicalDecimal)(value);
    if (parsed !== value || new import_client4.Prisma.Decimal(parsed).isNegative() || positive && new import_client4.Prisma.Decimal(parsed).isZero()) return void 0;
    return parsed;
  } catch {
    return void 0;
  }
}
function parsePartnerTechnicalSalesPolicySnapshot(value, identity) {
  const terms = record(value), calculationPolicy = record(terms?.calculationPolicy), rates = record(terms?.rates);
  if (!terms || !calculationPolicy || !rates || !exactKeys(terms, policyKeys) || !exactKeys(calculationPolicy, versionKeys) || !rateKeys.slice(0, 3).every((key2) => Object.prototype.hasOwnProperty.call(rates, key2)) || !Object.keys(rates).every((key2) => rateKeys.includes(key2)) || terms.schemaVersion !== 1 || terms.purpose !== "PARTNER_TECHNICAL_PRICING" || terms.currency !== "IRT" || typeof terms.mandatoryEnabled !== "boolean" || !["lineBased", "squareMeter"].includes(String(terms.slabCuttingPricingMethod)) || !versionKeys.every((key2) => typeof calculationPolicy[key2] === "string" && /^[A-Za-z0-9][A-Za-z0-9:_-]*$/.test(calculationPolicy[key2]))) {
    return void 0;
  }
  const mandatoryPercentage = decimal(terms.mandatoryPercentage), sawKerfMeters = decimal(terms.sawKerfMeters), materialRateScale = decimal(terms.materialRateScale, true);
  const parsedRates = Object.fromEntries(rateKeys.map((key2) => [key2, decimal(rates[key2])]));
  if (mandatoryPercentage === void 0 || new import_client4.Prisma.Decimal(mandatoryPercentage).gt(100) || sawKerfMeters === void 0 || materialRateScale === void 0 || rateKeys.some((key2, index) => parsedRates[key2] === void 0 && (index < 3 || Object.prototype.hasOwnProperty.call(rates, key2)))) return void 0;
  return {
    policyId: identity.id,
    version: identity.version,
    effectiveDate: typeof identity.effectiveDate === "string" ? identity.effectiveDate : identity.effectiveDate.toISOString().slice(0, 10),
    integrityHash: identity.integrityHash,
    calculationPolicy,
    mandatoryPercentage,
    mandatoryEnabled: terms.mandatoryEnabled,
    slabCuttingPricingMethod: terms.slabCuttingPricingMethod,
    sawKerfMeters,
    materialRateScale,
    currency: "IRT",
    rates: Object.fromEntries(Object.entries(parsedRates).filter(([, value2]) => value2 !== void 0))
  };
}
async function readPartnerTechnicalSalesPolicy(tx, actorId) {
  const [clock] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
  const profile = await tx.partnerProfile.findUnique({
    where: { userId: actorId },
    select: { commercialAccount: { select: { id: true } } }
  });
  const accountId = profile?.commercialAccount?.id;
  if (!accountId) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("NOT_FOUND") };
  const result = await readTechnicalPolicyForAccount(tx, accountId, clock.now);
  return result.ok ? { ok: true, value: result.value.policy } : result;
}
async function readTechnicalPolicyForAccount(tx, accountId, now) {
  const candidates = await tx.partnerCommercialTerms.findMany({
    where: { accountId },
    orderBy: { version: "desc" },
    select: {
      id: true,
      accountId: true,
      version: true,
      effectiveDate: true,
      terms: true,
      actorId: true,
      reason: true,
      integrityHash: true
    }
  });
  const accountVersion = candidates[0]?.version ?? 0;
  for (const candidate of candidates) {
    if (candidate.effectiveDate.getTime() > now.getTime()) continue;
    const raw = record(candidate.terms);
    if (raw?.purpose !== "PARTNER_TECHNICAL_PRICING") continue;
    let policyTerms = candidate.terms;
    if (typeof raw.policyId === "string") {
      const source = await tx.partnerTermsPolicy.findUnique({ where: { id: raw.policyId }, select: {
        id: true,
        purpose: true,
        label: true,
        effectiveDate: true,
        expiresAt: true,
        issuedAt: true,
        revokedAt: true,
        terms: true,
        integrityHash: true
      } });
      const sourceTerms = source && record(source.terms);
      if (!source || !sourceTerms || source.purpose !== "PARTNER_TECHNICAL_PRICING" || source.revokedAt || source.issuedAt > now || source.expiresAt && source.expiresAt <= now || source.effectiveDate.getTime() !== candidate.effectiveDate.getTime()) {
        return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
      }
      const sourceHash = await (0, import_partner_sales_contracts4.canonicalHash)({
        purpose: source.purpose,
        label: source.label,
        effectiveDate: source.effectiveDate.toISOString().slice(0, 10),
        terms: source.terms
      });
      const projected = { ...sourceTerms, purpose: source.purpose, policyId: source.id };
      if (source.integrityHash !== sourceHash || candidate.integrityHash !== source.integrityHash || await (0, import_partner_sales_contracts4.canonicalHash)(projected) !== await (0, import_partner_sales_contracts4.canonicalHash)(candidate.terms)) {
        return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
      }
      const obsoleteLocalQaPlaceholder = raw.policyId === "partner-local-qa-commercial-v1" && exactKeys(raw, ["localQa", "purpose", "policyId", "calculationPolicyVersion"]) && raw.localQa === true && raw.calculationPolicyVersion === "partner-v1" && exactKeys(sourceTerms, ["localQa", "calculationPolicyVersion"]) && sourceTerms.localQa === true && sourceTerms.calculationPolicyVersion === "partner-v1";
      if (obsoleteLocalQaPlaceholder) continue;
      policyTerms = { ...sourceTerms, purpose: source.purpose };
    } else {
      const expectedHash = await (0, import_partner_sales_contracts4.canonicalHash)({
        accountId: candidate.accountId,
        version: candidate.version,
        effectiveDate: candidate.effectiveDate.toISOString().slice(0, 10),
        terms: candidate.terms,
        actorId: candidate.actorId,
        reason: candidate.reason
      });
      if (candidate.integrityHash !== expectedHash) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
    }
    const policy2 = parsePartnerTechnicalSalesPolicySnapshot(policyTerms, candidate);
    return policy2 ? { ok: true, value: { policy: policy2, accountVersion } } : { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
  }
  const sources = await tx.partnerTermsPolicy.findMany({ where: {
    purpose: "PARTNER_TECHNICAL_PRICING",
    issuedAt: { lte: now },
    effectiveDate: { lte: now },
    revokedAt: null,
    OR: [{ expiresAt: null }, { expiresAt: { gt: now } }]
  }, orderBy: [{ effectiveDate: "desc" }, { issuedAt: "desc" }], select: {
    id: true,
    purpose: true,
    label: true,
    effectiveDate: true,
    expiresAt: true,
    issuedAt: true,
    revokedAt: true,
    terms: true,
    integrityHash: true
  } });
  for (const source of sources) {
    const sourceHash = await (0, import_partner_sales_contracts4.canonicalHash)({
      purpose: source.purpose,
      label: source.label,
      effectiveDate: source.effectiveDate.toISOString().slice(0, 10),
      terms: source.terms
    });
    if (source.integrityHash !== sourceHash) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
    const policy2 = parsePartnerTechnicalSalesPolicySnapshot(
      { ...record(source.terms) ?? {}, purpose: source.purpose },
      { id: source.id, version: 1, effectiveDate: source.effectiveDate, integrityHash: source.integrityHash }
    );
    if (policy2) return { ok: true, value: { policy: policy2, accountVersion } };
  }
  if (candidates.some((candidate) => record(candidate.terms)?.purpose === "PARTNER_TECHNICAL_PRICING") || await tx.partnerTermsPolicy.count({ where: { purpose: "PARTNER_TECHNICAL_PRICING" } })) {
    return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("STATE_CONFLICT") };
  }
  const cuts = await tx.cuttingType.findMany({
    where: { code: { in: ["LONG", "CROSS"] }, isActive: true },
    select: { id: true, code: true, pricePerMeter: true, updatedAt: true }
  });
  const longitudinal = cuts.find((cut) => cut.code === "LONG"), cross = cuts.find((cut) => cut.code === "CROSS");
  if (!longitudinal?.pricePerMeter || !cross?.pricePerMeter || longitudinal.pricePerMeter.isNegative() || cross.pricePerMeter.isNegative()) {
    return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("STATE_CONFLICT") };
  }
  const terms = {
    schemaVersion: 1,
    purpose: "PARTNER_TECHNICAL_PRICING",
    calculationPolicy: { calculation: "calculation-v1", packing: "packing-v1", pricing: "pricing-v1", rounding: "rounding-v1" },
    mandatoryEnabled: false,
    mandatoryPercentage: "20",
    slabCuttingPricingMethod: "lineBased",
    sawKerfMeters: "0.003",
    materialRateScale: "1",
    currency: "IRT",
    rates: {
      longitudinalCutRateToman: longitudinal.pricePerMeter.toFixed(),
      crossCutRateToman: cross.pricePerMeter.toFixed(),
      calibrationCutRateToman: longitudinal.pricePerMeter.toFixed()
    }
  };
  const integrityHash = await (0, import_partner_sales_contracts4.canonicalHash)({
    source: "SABALAN_SALE",
    terms,
    cuttingTypes: [longitudinal, cross].map((cut) => ({
      id: cut.id,
      code: cut.code,
      updatedAt: cut.updatedAt.toISOString(),
      rateToman: cut.pricePerMeter.toFixed()
    }))
  });
  const effectiveDate = new Date(Math.max(longitudinal.updatedAt.getTime(), cross.updatedAt.getTime()));
  const policy = parsePartnerTechnicalSalesPolicySnapshot(terms, {
    id: `sabalan-sale-${integrityHash.replace("sha256-v1:", "")}`,
    version: 1,
    effectiveDate,
    integrityHash
  });
  return policy ? { ok: true, value: { policy, accountVersion } } : { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
}
async function technicalConfigurationHash(row) {
  return (0, import_partner_sales_contracts4.canonicalHash)({
    schemaVersion: 2,
    pricingSubject: "MAIN_CATALOG_STONE",
    pricingBasis: "ordinary-sale-v1",
    catalogItemId: row.catalogItemId,
    family: row.family,
    unit: identityUnit(row)
  });
}
async function technicalDraftRowConfigurationHash(row, draft) {
  void draft;
  return technicalConfigurationHash(row);
}
function enteredMaterialPrice(draft, catalogItemId) {
  const root = draft.rows.find((row) => row.catalogItemId === catalogItemId && row.retailUnitPrice)?.retailUnitPrice;
  if (root) return root;
  for (const dependent of draft.dependents ?? []) {
    if (dependent.kind === "layer" && dependent.source?.kind === "new-material" && dependent.source.catalogItemId === catalogItemId && dependent.source.retailUnitPrice) return dependent.source.retailUnitPrice;
  }
  return void 0;
}
function operationsFromDraft(draft) {
  const intents = [
    ...draft.rows.flatMap((row) => "operations" in row && row.operations ? [row.operations] : []),
    ...(draft.dependents ?? []).flatMap((dependent) => dependent.kind === "remainder" && dependent.operations ? [dependent.operations] : dependent.kind === "layer" ? (dependent.sideOperations ?? []).map((side) => side.operations) : [])
  ];
  return {
    tools: intents.flatMap((intent) => intent.tools),
    finishings: intents.flatMap((intent) => intent.finishings),
    layers: (draft.dependents ?? []).filter((item) => item.kind === "layer")
  };
}
function productReferences(draft) {
  const values = [...draft.rows, ...(draft.dependents ?? []).flatMap((dependent) => {
    if (dependent.kind === "remainder") return [{
      catalogItemId: dependent.catalogItemId,
      catalogSnapshotVersion: dependent.catalogSnapshotVersion
    }];
    return dependent.source && dependent.source.kind !== "paid-remainder" ? [{ catalogItemId: dependent.source.catalogItemId, catalogSnapshotVersion: dependent.source.catalogSnapshotVersion }] : [];
  })];
  const unique = new Map(values.map((value) => [`${value.catalogItemId}\0${value.catalogSnapshotVersion}`, value]));
  return [...unique.values()];
}
function identityUnit(row) {
  if (!("family" in row)) return "squareMeter";
  if (row.family === "prepared" || row.family === "volumetric") return row.configuration.unit;
  return "squareMeter";
}
async function dependentConfigurationHash(row) {
  return (0, import_partner_sales_contracts4.canonicalHash)({
    schemaVersion: 2,
    pricingSubject: "MAIN_CATALOG_STONE",
    pricingBasis: "ordinary-sale-v1",
    catalogItemId: row.catalogItemId,
    family: "longitudinal",
    unit: identityUnit(row)
  });
}
function createPartnerTechnicalEvidenceResolver() {
  return async (tx, input) => {
    const previousContext = input.previous?.context;
    const priorPolicy = previousContext?.technicalPolicy;
    const parsedPriorPolicy = priorPolicy && parsePartnerTechnicalSalesPolicySnapshot({
      schemaVersion: 1,
      purpose: "PARTNER_TECHNICAL_PRICING",
      calculationPolicy: priorPolicy.calculationPolicy,
      mandatoryPercentage: priorPolicy.mandatoryPercentage,
      mandatoryEnabled: priorPolicy.mandatoryEnabled,
      slabCuttingPricingMethod: priorPolicy.slabCuttingPricingMethod,
      sawKerfMeters: priorPolicy.sawKerfMeters,
      materialRateScale: priorPolicy.materialRateScale,
      currency: priorPolicy.currency,
      rates: priorPolicy.rates
    }, {
      id: priorPolicy.policyId,
      version: priorPolicy.version,
      effectiveDate: priorPolicy.effectiveDate,
      integrityHash: priorPolicy.integrityHash
    });
    const identityRows = [
      ...input.draft.rows.map((row) => ({
        productRowId: row.productRowId,
        catalogItemId: row.catalogItemId,
        family: row.family,
        unit: identityUnit(row),
        hash: technicalDraftRowConfigurationHash(row, input.draft)
      })),
      ...(input.draft.dependents ?? []).filter((item) => item.kind === "remainder").map((row) => ({
        productRowId: row.productRowId,
        catalogItemId: row.catalogItemId,
        family: "longitudinal",
        unit: identityUnit(row),
        hash: dependentConfigurationHash(row)
      })),
      ...(input.draft.dependents ?? []).filter((item) => {
        if (item.kind !== "layer" || item.source?.kind !== "new-material") return false;
        const parent = input.draft.rows.find((row) => row.productRowId === item.parentProductRowId);
        return Boolean(parent && parent.catalogItemId !== item.source.catalogItemId);
      }).map((row) => ({
        productRowId: `layer-material:${row.layerConfigurationId}`,
        catalogItemId: row.source?.kind === "new-material" ? row.source.catalogItemId : "",
        family: "stair",
        unit: "squareMeter",
        hash: (0, import_partner_sales_contracts4.canonicalHash)({
          schemaVersion: 2,
          pricingSubject: "MAIN_CATALOG_STONE",
          pricingBasis: "ordinary-sale-v1",
          catalogItemId: row.source?.kind === "new-material" ? row.source.catalogItemId : "",
          family: "stair",
          unit: "squareMeter"
        })
      }))
    ];
    if (parsedPriorPolicy && previousContext && input.previous?.identities.length === identityRows.length) {
      const unchanged = await Promise.all(identityRows.map(async (row) => {
        const prior = input.previous.identities.find((item) => item.productRowId === row.productRowId);
        const configurationHash = await row.hash;
        return prior?.identity.catalogProductId === row.catalogItemId && prior.identity.family === row.family && prior.identity.unit === row.unit && prior.identity.configuration.some((item) => item.key === "pricingSubjectHash" && item.value === configurationHash);
      }));
      if (unchanged.every(Boolean)) return { ok: true, value: {
        context: previousContext,
        identities: input.previous.identities
      } };
    }
    const policy = await readPartnerTechnicalSalesPolicy(tx, input.actorId);
    if (!policy.ok) return policy;
    const frozenPolicy = parsedPriorPolicy ?? policy.value;
    const references = productReferences(input.draft);
    const products = await tx.product.findMany({
      where: { id: { in: references.map((item) => item.catalogItemId) } },
      select: {
        id: true,
        code: true,
        namePersian: true,
        updatedAt: true,
        widthValue: true,
        motherLengthValue: true,
        thicknessValue: true,
        stoneTypeNamePersian: true,
        mineNamePersian: true,
        finishNamePersian: true,
        colorNamePersian: true,
        qualityNamePersian: true,
        cuttingDimensionNamePersian: true,
        isActive: true,
        deletedAt: true,
        isAvailable: true,
        availableInLongitudinalContracts: true,
        availableInStairContracts: true,
        availableInSlabContracts: true,
        availableInVolumetricContracts: true,
        preparedSalesUnit: true,
        volumetricSalesUnit: true,
        basePrice: true,
        currency: true
      }
    });
    if (products.length !== references.length) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
    const publicProducts = [];
    for (const source of products) {
      const reference = references.find((item) => item.catalogItemId === source.id);
      if (!reference || source.updatedAt.toISOString() !== reference.catalogSnapshotVersion) {
        return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("ROW_STALE") };
      }
      if (source.basePrice === null) {
        const entered = enteredMaterialPrice(input.draft, source.id);
        if (!entered || new import_client4.Prisma.Decimal(entered.amount).lte(0))
          return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INVALID_PAYLOAD") };
      }
      const projected = projectPartnerTechnicalProduct(source);
      if (!projected.ok) return projected;
      publicProducts.push(projected.value);
    }
    const selections = operationsFromDraft(input.draft);
    const toolIds = [...new Set(selections.tools.map((item) => item.catalogItemId))];
    const finishingIds = [...new Set(selections.finishings.map((item) => item.catalogItemId))];
    const layerIds = [...new Set(selections.layers.map((item) => item.catalogItemId))];
    const [tools, finishings, layers] = await Promise.all([
      tx.subService.findMany({ where: { id: { in: toolIds } }, select: {
        id: true,
        updatedAt: true,
        isActive: true,
        namePersian: true,
        calculationBase: true,
        pricePerMeter: true
      } }),
      tx.stoneFinishing.findMany({ where: { id: { in: finishingIds } }, select: {
        id: true,
        updatedAt: true,
        isActive: true,
        namePersian: true,
        calculationBase: true,
        pricePerSquareMeter: true,
        unitPrice: true
      } }),
      tx.layerType.findMany({ where: { id: { in: layerIds } }, select: {
        id: true,
        updatedAt: true,
        isActive: true,
        name: true,
        calculationUnit: true,
        pricePerLayer: true
      } })
    ]);
    if (tools.length !== toolIds.length || finishings.length !== finishingIds.length || layers.length !== layerIds.length) {
      return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
    }
    const publicOperations = [];
    const operationEvidence = [];
    for (const source of tools) {
      const selected = selections.tools.find((item) => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("ROW_STALE") };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: "TOOL" });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      operationEvidence.push({ kind: "TOOL", catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString(), rateToman: source.pricePerMeter.toString() });
    }
    for (const source of finishings) {
      const selected = selections.finishings.find((item) => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("ROW_STALE") };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: "FINISHING", incompatibleCatalogItemIds: [] });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      operationEvidence.push({
        kind: "FINISHING",
        catalogItemId: source.id,
        catalogSnapshotVersion: source.updatedAt.toISOString(),
        rateToman: (source.unitPrice.isZero() ? source.pricePerSquareMeter : source.unitPrice).toString()
      });
    }
    const layerEvidence = [];
    for (const source of layers) {
      const selected = selections.layers.find((item) => item.catalogItemId === source.id);
      if (!selected || source.updatedAt.toISOString() !== selected.catalogSnapshotVersion) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("ROW_STALE") };
      const projected = projectPartnerTechnicalOperation({ ...source, kind: "LAYER" });
      if (!projected.ok) return projected;
      publicOperations.push(projected.value);
      layerEvidence.push({
        catalogItemId: source.id,
        catalogSnapshotVersion: source.updatedAt.toISOString(),
        layerRateToman: source.pricePerLayer.toString(),
        longitudinalCutRateToman: policy.value.rates.longitudinalCutRateToman,
        crossCutRateToman: policy.value.rates.crossCutRateToman,
        calibrationCutRateToman: policy.value.rates.calibrationCutRateToman
      });
    }
    const context = createContext(frozenPolicy, publicProducts, publicOperations, products, operationEvidence, layerEvidence, input.draft);
    if (previousContext?.products && Array.isArray(previousContext.products)) context.products = context.products.map((current) => previousContext.products.find((previous) => previous.catalogItemId === current.catalogItemId && previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    if (previousContext?.operations && Array.isArray(previousContext.operations)) context.operations = (context.operations ?? []).map((current) => previousContext.operations.find((previous) => previous.kind === current.kind && previous.catalogItemId === current.catalogItemId && previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    if (previousContext?.layers && Array.isArray(previousContext.layers)) context.layers = (context.layers ?? []).map((current) => previousContext.layers.find((previous) => previous.catalogItemId === current.catalogItemId && previous.catalogSnapshotVersion === current.catalogSnapshotVersion) ?? current);
    const identities = [];
    for (const row of identityRows) {
      const prior = input.previous?.identities.find((item) => item.productRowId === row.productRowId);
      const configurationHash = await row.hash;
      if (prior?.identity.configuration.some((item) => item.key === "pricingSubjectHash" && item.value === configurationHash)) {
        identities.push(prior);
        continue;
      }
      const product = products.find((item) => item.id === row.catalogItemId);
      const privateProductEvidence = context.products.find((item) => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === product.updatedAt.toISOString());
      if (!privateProductEvidence) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
      const materialRateHash = await (0, import_partner_sales_contracts4.canonicalHash)({
        schemaVersion: 2,
        pricingSubject: "MAIN_CATALOG_STONE",
        productId: product.id,
        family: row.family,
        unit: row.unit,
        currency: frozenPolicy.currency
      });
      const identity = import_partner_sales_contracts4.InquiryIdentitySchema.safeParse({
        schemaVersion: 1,
        partnerSellerId: input.actorId,
        catalogProductId: row.catalogItemId,
        family: row.family,
        unit: row.unit,
        configuration: [{ key: "pricingSubjectHash", value: configurationHash }],
        materialRateEvidenceId: `catalog-product:${product.id}`,
        materialRateHash,
        components: [],
        currency: frozenPolicy.currency,
        calculationPolicyVersion: "partner-main-stone-rate-v2",
        roundingPolicyVersion: "partner-main-stone-rate-v2"
      });
      if (!identity.success) return { ok: false, error: (0, import_partner_sales_contracts4.partnerError)("INTEGRITY_CONFLICT") };
      identities.push({ productRowId: row.productRowId, identity: identity.data });
    }
    return { ok: true, value: { context, identities } };
  };
}
function createContext(policy, publicProducts, publicOperations, products, operations, layers, draft) {
  const amount = (value) => (0, import_contract_product_graph2.parseCanonicalDecimal)(value);
  const rememberedMandatoryPercentage = !policy.mandatoryEnabled && new import_client4.Prisma.Decimal(policy.mandatoryPercentage).isZero() ? "20" : policy.mandatoryPercentage;
  return {
    technicalPolicy: policy,
    catalog: { products: publicProducts, operations: publicOperations, sawKerfMeters: policy.sawKerfMeters },
    policy: policy.calculationPolicy,
    products: products.map((product) => {
      const entered = enteredMaterialPrice(draft, product.id);
      const rate = product.basePrice === null ? (0, import_contract_product_graph2.parseCanonicalDecimal)(new import_client4.Prisma.Decimal(entered.amount).div(entered.currency === "IRR" ? 10 : 1).toFixed()) : catalogMaterialRateToman(product.basePrice, product.currency);
      const preparedRates = [...new Map(draft.rows.flatMap((row) => (row.family === "prepared" || row.family === "volumetric") && row.catalogItemId === product.id ? [[`${row.configuration.kind}:${row.configuration.unit}`, { kind: row.configuration.kind, unit: row.configuration.unit, rateToman: rate }]] : [])).values()];
      return {
        catalogItemId: product.id,
        catalogSnapshotVersion: product.updatedAt.toISOString(),
        layerMaterialRateToman: rate,
        preparedRates: preparedRates.map((item) => ({ ...item, rateToman: amount(item.rateToman) })),
        longitudinal: {
          baseRateToman: amount(rate),
          mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(rememberedMandatoryPercentage),
          rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman)
        },
        slab: {
          baseMaterialRateToman: amount(rate),
          cuttingPricingMethod: policy.slabCuttingPricingMethod,
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman),
          crossCutRateToman: amount(policy.rates.crossCutRateToman),
          ...policy.rates.squareMeterCutRateToman === void 0 ? {} : { squareMeterCutRateToman: amount(policy.rates.squareMeterCutRateToman) },
          ...policy.rates.verticalCutRateToman === void 0 ? {} : { verticalCutRateToman: amount(policy.rates.verticalCutRateToman) }
        },
        stair: {
          baseRateToman: amount(rate),
          mandatoryEnabled: policy.mandatoryEnabled,
          mandatoryPercentage: amount(rememberedMandatoryPercentage),
          rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman),
          crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman)
        },
        remainder: {
          mandatoryPercentage: amount(rememberedMandatoryPercentage),
          rememberedMandatoryPercentage: amount(rememberedMandatoryPercentage),
          longitudinalCutRateToman: amount(policy.rates.longitudinalCutRateToman),
          crossCutRateToman: amount(policy.rates.crossCutRateToman),
          calibrationCutRateToman: amount(policy.rates.calibrationCutRateToman)
        }
      };
    }),
    operations: operations.map((item) => ({ ...item, rateToman: amount(item.rateToman) })),
    layers: layers.map((item) => ({
      ...item,
      layerRateToman: amount(item.layerRateToman),
      longitudinalCutRateToman: amount(item.longitudinalCutRateToman),
      crossCutRateToman: amount(item.crossCutRateToman),
      calibrationCutRateToman: amount(item.calibrationCutRateToman)
    }))
  };
}

// src/services/partnerSales/cases/technicalSavedRecords.ts
var import_contract_product_graph3 = require("@sabalanerp/contract-product-graph");
var import_partner_sales_contracts5 = require("@sabalanerp/partner-sales-contracts");
function decodeTechnicalSaveOutcome(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return void 0;
  const record3 = value;
  if (Object.keys(record3).some((key2) => !["version", "sessionId", "recoveryRevision"].includes(key2)) || record3.version !== 1 || typeof record3.sessionId !== "string" || !record3.sessionId || typeof record3.recoveryRevision !== "number" || !Number.isSafeInteger(record3.recoveryRevision) || record3.recoveryRevision < 1) return void 0;
  return { version: 1, sessionId: record3.sessionId, recoveryRevision: record3.recoveryRevision };
}
async function encodeTechnicalSavedSnapshot(value) {
  const payload = technicalRecoveryJson(value);
  return { payload, integrityHash: await (0, import_partner_sales_contracts5.canonicalHash)(payload) };
}
async function decodeTechnicalSavedSnapshot(value) {
  try {
    const envelope = value;
    if (!envelope || Object.keys(envelope).some((key2) => !["payload", "integrityHash"].includes(key2)) || await (0, import_partner_sales_contracts5.canonicalHash)(envelope.payload) !== envelope.integrityHash) return void 0;
    const payload = envelope.payload;
    if (payload.version !== 1 || typeof payload.sessionId !== "string" || !payload.sessionId || !Array.isArray(payload.identities)) return void 0;
    const draft = import_partner_sales_contracts5.PartnerTechnicalDraftSchema.parse(payload.draft);
    const graph = (0, import_contract_product_graph3.parseCanonicalProductGraph)(payload.graph);
    const graphHash = await (0, import_partner_sales_contracts5.canonicalHash)({ purpose: "PARTNER_CASE_GRAPH", schemaVersion: 1, graph });
    const rawView = payload.view;
    const view = import_partner_sales_contracts5.PartnerTechnicalSavedViewSchema.parse({ ...rawView, graphHash: rawView.graphHash ?? graphHash });
    if (view.graphHash !== graphHash) return void 0;
    const identities = payload.identities.map((item) => ({ productRowId: item.productRowId, identity: import_partner_sales_contracts5.InquiryIdentitySchema.parse(item.identity) }));
    if (draft.inputRevision !== view.inputRevision || graph.rows.length !== view.rows.length || identities.length < graph.rows.length || new Set(identities.map((item) => item.productRowId)).size !== identities.length || graph.rows.some((row) => !view.rows.some((item) => item.configurationRef.productRowId === row.productRowId) || !identities.some((item) => item.productRowId === row.productRowId)) || (view.pricingSubjects ?? []).some((subject) => !identities.some((item) => item.productRowId === subject.configurationRef.productRowId))) return void 0;
    if (JSON.stringify((payload.serviceRows ?? []).map(({ serviceRowId, quantity, unit }) => ({ serviceRowId, quantity, unit }))) !== JSON.stringify(view.serviceRows ?? [])) return void 0;
    return { version: 1, sessionId: payload.sessionId, view, draft, graph, context: payload.context, identities, ...payload.serviceRows ? { serviceRows: payload.serviceRows } : {} };
  } catch {
    return void 0;
  }
}

// src/services/partnerSales/cases/technicalRecovery.ts
var technicalRecoveryJson = (value) => JSON.parse(JSON.stringify(value));
var json = technicalRecoveryJson;
var CHECKPOINT_OPERATION = "PARTNER_TECHNICAL_CHECKPOINT_V1";
var technicalDraftContent = (draft) => {
  const { inputRevision: _correlation, dependents = [], stairSystems = [], editingValues = [], ...content2 } = draft;
  return (0, import_partner_sales_contracts6.canonicalJson)(json({ ...content2, dependents, stairSystems, editingValues }));
};
function technicalRecoveryLease(dependencies) {
  return async function underLease(access, operation, work) {
    return dependencies.transaction(async (tx) => {
      await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions WHERE "draftId" = ${access.recoveryId} FOR UPDATE`;
      const session = await tx.salesContractEditSession.findUnique({ where: { draftId: access.recoveryId } });
      if (!session || session.ownerUserId !== dependencies.actorId) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("NOT_FOUND") };
      const authorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, recoveryId: access.recoveryId, operation });
      if (!authorized.ok) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)(authorized.error.code) };
      const [clock] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
      const now = clock.now;
      if (session.browserSessionId !== access.browserSessionId || session.leaseToken !== access.leaseToken || now.getTime() - session.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
        return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("FORBIDDEN") };
      }
      if (session.baseRevision !== access.baseRevision) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("ROW_STALE") };
      const recovery = session.recovery === null ? null : decodeTechnicalRecovery(session.recovery);
      if (recovery === void 0) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INTEGRITY_CONFLICT") };
      if (recovery && (recovery.updatedAt > now.getTime() || await technicalRecoveryExpired(tx, session.contractId, recovery, dependencies.actorId, now))) {
        return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("STATE_CONFLICT") };
      }
      return work(tx, session, recovery, now);
    }, operation);
  };
}
async function technicalRecoveryExpired(tx, contractId, recovery, actorId, now) {
  if (contractId || now.getTime() - recovery.updatedAt <= CONTRACT_CREATION_DRAFT_TTL_MS) return false;
  if (typeof recovery.partnerCaseId !== "string" || !recovery.partnerCaseId) return true;
  const bound = await tx.partnerSaleCase.findFirst({ where: {
    id: recovery.partnerCaseId,
    profile: { userId: actorId }
  }, select: { state: true } });
  return !bound || !(0, import_partner_sales_contracts6.isPartnerCaseEditableState)(bound.state);
}
function createPartnerTechnicalRecoveryService(dependencies) {
  const underLease = technicalRecoveryLease(dependencies);
  return {
    async read(input) {
      const parsed = import_partner_sales_contracts6.PartnerTechnicalRecoveryAccessSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INVALID_PAYLOAD") };
      return underLease(parsed.data, "READ", async (tx, session, recovery) => {
        const policy = await readPartnerTechnicalSalesPolicy(tx, dependencies.actorId);
        const records = recovery?.validatedSnapshots ?? [];
        if (!Array.isArray(records)) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INTEGRITY_CONFLICT") };
        const latest = records.length ? await decodeTechnicalSavedSnapshot(records.at(-1)) : void 0;
        if (records.length && (!latest || latest.sessionId !== session.id || latest.view.recoveryId !== session.draftId)) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INTEGRITY_CONFLICT") };
        const savedContext = latest?.context;
        const catalog = savedContext?.catalog ? import_partner_sales_contracts6.PartnerTechnicalPreviewCatalogSchema.safeParse(savedContext.catalog) : void 0;
        if (latest && (!catalog || !catalog.success)) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INTEGRITY_CONFLICT") };
        const savedPolicy = savedContext?.technicalPolicy;
        const defaultPercentage = savedPolicy?.mandatoryPercentage ?? (policy.ok ? policy.value.mandatoryPercentage : "20");
        const retainedIds = catalog && catalog.success ? [...new Set(catalog.data.products.map((item) => item.catalogItemId))] : [];
        const activeProducts = retainedIds.length ? await tx.product.findMany({ where: {
          id: { in: retainedIds },
          isActive: true,
          isAvailable: true,
          deletedAt: null
        }, select: { id: true } }) : [];
        const activeIds = new Set(activeProducts.map((item) => item.id));
        return { ok: true, value: {
          schemaVersion: 1,
          recoveryId: session.draftId,
          recoveryRevision: recovery?.recoveryRevision ?? 0,
          updatedAt: recovery ? new Date(recovery.updatedAt).toISOString() : session.updatedAt.toISOString(),
          draft: recovery?.draft ?? null,
          ...savedPolicy || policy.ok ? { mandatoryDefaults: {
            enabled: savedPolicy?.mandatoryEnabled ?? (policy.ok ? policy.value.mandatoryEnabled : false),
            percentage: defaultPercentage === "0" ? "20" : defaultPercentage
          } } : {},
          ...catalog && catalog.success ? { retainedCatalog: {
            ...catalog.data,
            products: catalog.data.products.filter((item) => activeIds.has(item.catalogItemId))
          } } : {}
        } };
      });
    },
    async checkpoint(input) {
      const parsed = import_partner_sales_contracts6.PartnerTechnicalCheckpointSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INVALID_PAYLOAD") };
      const command = parsed.data;
      const payloadHash = await (0, import_partner_sales_contracts6.canonicalHash)(json({
        schemaVersion: command.schemaVersion,
        recoveryId: command.recoveryId,
        baseRevision: command.baseRevision,
        expectedRecoveryRevision: command.expectedRecoveryRevision,
        draft: command.draft
      }));
      return underLease(command, "CHECKPOINT", async (tx, session, recovery, now) => {
        const identity = {
          actorId: dependencies.actorId,
          operation: CHECKPOINT_OPERATION,
          targetScope: session.draftId,
          key: command.idempotencyKey
        };
        const previous = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
        if (previous) {
          if (previous.payloadHash !== payloadHash) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("IDEMPOTENCY_CONFLICT") };
          const stored = decodeTechnicalReceipt(previous.outcome);
          if (!stored || stored.sessionId !== session.id || stored.receipt.recoveryId !== session.draftId || !recovery || stored.receipt.recoveryRevision > recovery.recoveryRevision) {
            return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("INTEGRITY_CONFLICT") };
          }
          return { ok: true, value: { ...stored.receipt, replayed: true } };
        }
        const revision = recovery?.recoveryRevision ?? 0;
        if (revision !== command.expectedRecoveryRevision || revision === Number.MAX_SAFE_INTEGER) {
          return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("ROW_STALE") };
        }
        const next = {
          ...recovery,
          kind: PARTNER_TECHNICAL_RECOVERY_KIND,
          version: 1,
          recoveryRevision: revision + 1,
          updatedAt: recovery && technicalDraftContent(recovery.draft) === technicalDraftContent(command.draft) ? recovery.updatedAt : now.getTime(),
          draft: command.draft
        };
        const written = await tx.salesContractEditSession.updateMany({ where: {
          draftId: session.draftId,
          leaseToken: session.leaseToken,
          baseRevision: session.baseRevision,
          recovery: { equals: session.recovery === null ? import_client5.Prisma.AnyNull : json(session.recovery) }
        }, data: { recovery: json(next), updatedAt: now } });
        if (written.count !== 1) return { ok: false, error: (0, import_partner_sales_contracts6.partnerError)("ROW_STALE") };
        const receipt = import_partner_sales_contracts6.PartnerTechnicalCheckpointReceiptSchema.parse({
          schemaVersion: 1,
          recoveryId: session.draftId,
          recoveryRevision: next.recoveryRevision,
          inputRevision: command.draft.inputRevision,
          updatedAt: new Date(next.updatedAt).toISOString(),
          replayed: false
        });
        await tx.partnerCommandOutcome.create({ data: {
          id: (0, import_node_crypto.randomUUID)(),
          ...identity,
          payloadHash,
          outcome: json({ sessionId: session.id, receipt }),
          recordedAt: now
        } });
        return { ok: true, value: receipt };
      });
    }
  };
}

// src/services/partnerSales/cases/technicalSave.ts
var import_node_crypto2 = require("node:crypto");
var import_client11 = require("@prisma/client");
var import_partner_sales_contracts11 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/cases/technicalSavedGraph.ts
var import_partner_sales_contracts9 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/cases/technicalGraph.ts
var import_contract_product_graph8 = require("@sabalanerp/contract-product-graph");
var import_client9 = require("@prisma/client");
var import_partner_sales_contracts8 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/cases/technicalGraphOperations.ts
var import_contract_product_graph4 = require("@sabalanerp/contract-product-graph");
function technicalGraphOperations(intent, geometry, context) {
  const catalog = (selection, kind) => {
    const matches = context.catalog.operations.filter((item) => item.kind === kind && item.catalogItemId === selection.catalogItemId && item.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    const evidence = context.operations?.filter((item) => item.kind === kind && item.catalogItemId === selection.catalogItemId && item.catalogSnapshotVersion === selection.catalogSnapshotVersion) ?? [];
    if (matches.length !== 1 || evidence.length !== 1) throw new Error("Missing or ambiguous operation evidence");
    return { item: matches[0], rateToman: (0, import_contract_product_graph4.parseCanonicalDecimal)(evidence[0].rateToman) };
  };
  const override = (value) => value && {
    ...value,
    value: (0, import_contract_product_graph4.parseCanonicalDecimal)(value.value),
    automaticQuantitySnapshot: (0, import_contract_product_graph4.parseCanonicalDecimal)(value.automaticQuantitySnapshot)
  };
  return {
    ...geometry,
    policyVersion: context.policy.calculation,
    pricingPolicyVersion: context.policy.pricing,
    roundingPolicyVersion: context.policy.rounding,
    groups: intent.groups.map((group) => ({
      operationGroupId: (0, import_contract_product_graph4.parseStableIdentity)("operation-group", group.operationGroupId),
      scope: (0, import_contract_product_graph4.parseCanonicalDecimal)(group.scope)
    })),
    tools: intent.tools.map((tool) => {
      const { item, rateToman } = catalog(tool, "TOOL");
      if (item.kind !== "TOOL") throw new Error("Wrong operation evidence");
      return {
        ...tool,
        toolSelectionId: (0, import_contract_product_graph4.parseStableIdentity)("tool-selection", tool.toolSelectionId),
        operationGroupId: (0, import_contract_product_graph4.parseStableIdentity)("operation-group", tool.operationGroupId),
        name: item.name,
        unit: item.unit,
        rateToman,
        quantityOverride: override(tool.quantityOverride)
      };
    }),
    finishings: intent.finishings.map((finishing) => {
      const { item, rateToman } = catalog(finishing, "FINISHING");
      if (item.kind !== "FINISHING") throw new Error("Wrong operation evidence");
      return {
        ...finishing,
        finishingSelectionId: (0, import_contract_product_graph4.parseStableIdentity)("finishing-selection", finishing.finishingSelectionId),
        operationGroupId: (0, import_contract_product_graph4.parseStableIdentity)("operation-group", finishing.operationGroupId),
        name: item.name,
        unit: item.unit,
        incompatibleCatalogItemIds: item.incompatibleCatalogItemIds,
        rateToman,
        quantityOverride: override(finishing.quantityOverride)
      };
    })
  };
}

// src/services/partnerSales/cases/technicalGraphRemainder.ts
var import_contract_product_graph5 = require("@sabalanerp/contract-product-graph");
function technicalGraphRemainder(intent, preview, graph, context) {
  if (preview.kind !== "remainder" || !preview.calculation.ok) throw new Error("Invalid remainder preview");
  const allocation = preview.calculation.result.allocations[0];
  const stock = graph.remainingStones.find((stock2) => stock2.remainingStoneId === allocation.sourceRemainingStoneId);
  const products = context.catalog.products.filter((item) => item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  const evidence = context.products.filter((item) => item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  if (!stock || products.length !== 1 || evidence.length !== 1 || !evidence[0].remainder) throw new Error("Missing remainder evidence");
  const rates = evidence[0].remainder;
  const lengthMeters = (0, import_contract_product_graph5.parseCanonicalDecimal)(intent.lengthMeters), widthMeters = (0, import_contract_product_graph5.parseCanonicalDecimal)(intent.widthMeters);
  const productRowId = (0, import_contract_product_graph5.parseStableIdentity)("product-row", intent.productRowId);
  const sourceProductRowId = (0, import_contract_product_graph5.parseStableIdentity)("product-row", intent.sourceProductRowId);
  const quantity = intent.quantity;
  return {
    row: {
      productRowId,
      catalogProductId: intent.catalogItemId,
      catalogSnapshotVersion: intent.catalogSnapshotVersion,
      productType: "longitudinal",
      contractualTitle: products[0].name,
      sourceProductRowId,
      parentProductRowId: sourceProductRowId,
      commercial: {}
    },
    productPolicyInput: {
      calculationPolicyVersion: context.policy.calculation,
      packingPolicyVersion: context.policy.packing,
      pricingPolicyVersion: context.policy.pricing,
      roundingPolicyVersion: context.policy.rounding,
      sourceBatchId: stock.sourceBatchId,
      motherWidthMeters: stock.widthMeters,
      lengthMeters,
      widthMeters,
      quantity,
      lastManualField: "quantity",
      lastManualDimension: "length",
      lengthDisplayUnit: intent.lengthDisplayUnit,
      widthDisplayUnit: intent.widthDisplayUnit,
      baseMaterialPricing: "paid-source-zero",
      baseRateToman: (0, import_contract_product_graph5.parseCanonicalDecimal)("0"),
      mandatoryEnabled: false,
      mandatoryPercentage: rates.mandatoryPercentage,
      rememberedMandatoryPercentage: rates.rememberedMandatoryPercentage,
      sawKerfEnabled: intent.sawKerfEnabled,
      sawKerfMeters: (0, import_contract_product_graph5.parseCanonicalDecimal)(context.catalog.sawKerfMeters),
      calibrationEnabled: intent.calibrationEnabled,
      calibrationSelection: "manual",
      longitudinalCutRateToman: rates.longitudinalCutRateToman,
      calibrationCutRateToman: rates.calibrationCutRateToman
    },
    remainderChildPolicyInput: {
      ...rates,
      allocationId: (0, import_contract_product_graph5.parseStableIdentity)("allocation", intent.allocationId),
      allocationOrder: intent.creationOrder,
      sourceProductRowId,
      selectedRemainingStoneId: intent.selectedRemainingStoneId === void 0 ? void 0 : (0, import_contract_product_graph5.parseStableIdentity)("remaining-stone", intent.selectedRemainingStoneId),
      lengthMeters,
      widthMeters,
      quantity,
      kerfMeters: (0, import_contract_product_graph5.parseCanonicalDecimal)(intent.sawKerfEnabled ? context.catalog.sawKerfMeters : "0"),
      calibrationEnabled: intent.calibrationEnabled,
      sourcePieceQuantities: intent.sourcePieceQuantities,
      secondaryOwnerProductRowId: intent.secondaryOwnerProductRowId === void 0 ? void 0 : (0, import_contract_product_graph5.parseStableIdentity)("product-row", intent.secondaryOwnerProductRowId)
    },
    ...intent.operations ? { operationPolicyInput: technicalGraphOperations(intent.operations, { productRowId, lengthMeters, widthMeters, quantity }, context) } : {}
  };
}

// src/services/partnerSales/cases/technicalGraphLayers.ts
var import_contract_product_graph6 = require("@sabalanerp/contract-product-graph");
var import_client6 = require("@prisma/client");
function technicalGraphLayer(intent, preview, context) {
  if (preview.kind !== "layer" || !preview.calculation.ok || !intent.source) throw new Error("Incomplete layer");
  const items = context.catalog.operations.filter((item2) => item2.kind === "LAYER" && item2.catalogItemId === intent.catalogItemId && item2.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  const evidence = context.layers?.filter((item2) => item2.catalogItemId === intent.catalogItemId && item2.catalogSnapshotVersion === intent.catalogSnapshotVersion) ?? [];
  if (items.length !== 1 || evidence.length !== 1 || items[0].kind !== "LAYER") throw new Error("Missing layer evidence");
  const item = items[0];
  const parentProductRowId = (0, import_contract_product_graph6.parseStableIdentity)("product-row", intent.parentProductRowId);
  let source;
  if (intent.source.kind === "paid-remainder") source = {
    kind: "paid-remainder",
    selectedRemainingStoneIds: intent.source.selectedRemainingStoneIds.map((id) => (0, import_contract_product_graph6.parseStableIdentity)("remaining-stone", id))
  };
  else {
    const selection = intent.source;
    const materials = context.products.filter((item2) => item2.catalogItemId === selection.catalogItemId && item2.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    if (materials.length !== 1 || materials[0].layerMaterialRateToman === void 0) throw new Error("Missing layer material evidence");
    const common = {
      catalogProductId: selection.catalogItemId,
      catalogSnapshotVersion: selection.catalogSnapshotVersion,
      materialRateToman: selection.kind === "new-material" && selection.retailUnitPrice ? (0, import_contract_product_graph6.parseCanonicalDecimal)(new import_client6.Prisma.Decimal(selection.retailUnitPrice.amount).div(selection.retailUnitPrice.currency === "IRR" ? 10 : 1).toFixed()) : (0, import_contract_product_graph6.parseCanonicalDecimal)(materials[0].layerMaterialRateToman),
      sourceRows: selection.sourceRows.map((row) => ({
        sourceRowId: (0, import_contract_product_graph6.parseStableIdentity)("layer-source-row", row.sourceRowId),
        lengthMeters: (0, import_contract_product_graph6.parseCanonicalDecimal)(row.lengthMeters),
        widthMeters: (0, import_contract_product_graph6.parseCanonicalDecimal)(row.widthMeters),
        quantity: row.quantity
      }))
    };
    source = selection.kind === "new-material" ? { kind: "new-material", ...common } : { kind: "parent-material", ...common, selectedRemainingStoneIds: selection.selectedRemainingStoneIds.map((id) => (0, import_contract_product_graph6.parseStableIdentity)("remaining-stone", id)) };
  }
  return {
    ...evidence[0],
    calculationPolicyVersion: context.policy.calculation,
    packingPolicyVersion: context.policy.packing,
    pricingPolicyVersion: context.policy.pricing,
    roundingPolicyVersion: context.policy.rounding,
    layerConfigurationId: (0, import_contract_product_graph6.parseStableIdentity)("layer-configuration", intent.layerConfigurationId),
    parentProductRowId,
    sourceBatchId: (0, import_contract_product_graph6.parseStableIdentity)("source-batch", intent.sourceBatchId),
    creationOrder: intent.creationOrder,
    layerCatalogItemId: item.catalogItemId,
    layerCatalogSnapshotVersion: item.catalogSnapshotVersion,
    layerTitle: item.name,
    layerUnit: item.unit,
    layersPerParentPiece: intent.layersPerParentPiece,
    widthMeters: (0, import_contract_product_graph6.parseCanonicalDecimal)(intent.widthMeters),
    widthDisplayUnit: intent.widthDisplayUnit,
    targetSides: intent.targetSides,
    source,
    kerfMeters: (0, import_contract_product_graph6.parseCanonicalDecimal)(intent.sawKerfEnabled ? context.catalog.sawKerfMeters : "0"),
    calibrationEnabled: intent.calibrationEnabled,
    ...intent.description?.trim() ? { description: intent.description.trim() } : {},
    sideOperations: (intent.sideOperations ?? []).map((side) => {
      const strip = preview.calculation.ok ? preview.calculation.result.physicalStrips.find((strip2) => strip2.side === side.side) : void 0;
      if (!strip) throw new Error("Missing layer strip");
      return {
        side: side.side,
        scopeIntent: side.scopeIntent,
        operationCollectionId: (0, import_contract_product_graph6.parseStableIdentity)("layer-operation-collection", side.operationCollectionId),
        operations: technicalGraphOperations(side.operations, {
          productRowId: parentProductRowId,
          operationScopeId: side.operationCollectionId,
          lengthMeters: strip.lengthMeters,
          widthMeters: strip.widthMeters,
          quantity: strip.quantity
        }, context)
      };
    })
  };
}

// src/services/partnerSales/cases/technicalGraphMeasures.ts
var import_partner_sales_contracts7 = require("@sabalanerp/partner-sales-contracts");
var import_client8 = require("@prisma/client");

// src/services/partnerSales/cases/canonicalWholesale.ts
var import_client7 = require("@prisma/client");
var import_contract_product_graph7 = require("@sabalanerp/contract-product-graph");
var canonical = (value) => (0, import_contract_product_graph7.parseCanonicalDecimal)(new import_client7.Prisma.Decimal(value).toFixed());
var isObjectRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
function readWholesaleMandatory(value) {
  if (value == null) return void 0;
  if (!isObjectRecord(value) || typeof value.enabled !== "boolean" || typeof value.percentage !== "string" || !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.percentage) || new import_client7.Prisma.Decimal(value.percentage).gt(100)) throw new Error("Invalid wholesale mandatory policy");
  return { enabled: value.enabled, percentage: value.percentage };
}
function partnerQuotedQuantity(row) {
  const snapshot = row.commercial.calculationSnapshot;
  if (snapshot?.partnerPricingBasis === "ordinary-sale-v1") {
    if (row.productType !== "prepared") {
      const lines = Array.isArray(snapshot.pricingLines) ? snapshot.pricingLines.filter((line) => isObjectRecord(line) && line.lineId === "base-material") : [];
      const material = row.productType === "slab" && isObjectRecord(snapshot.materialPricingLine) ? snapshot.materialPricingLine : lines.length === 1 ? lines[0] : void 0;
      if (isObjectRecord(material) && typeof material.quantity === "string") return new import_client7.Prisma.Decimal(material.quantity);
      if (snapshot.pricingLines !== void 0 || snapshot.materialPricingLine !== void 0 || row.productType === "longitudinal") {
        throw new Error("Canonical material pricing quantity is missing");
      }
    }
    if (row.productType === "stair") {
      if (typeof snapshot.consumedMotherAreaSquareMeters !== "string") throw new Error("Canonical stair material area is missing");
      return new import_client7.Prisma.Decimal(snapshot.consumedMotherAreaSquareMeters);
    }
    if (row.productType === "slab") {
      if (typeof snapshot.materialAreaSquareMeters !== "string") throw new Error("Canonical slab material area is missing");
      return new import_client7.Prisma.Decimal(snapshot.materialAreaSquareMeters);
    }
  }
  if (row.productType === "longitudinal") {
    return new import_client7.Prisma.Decimal(row.commercial.requestedAreaSquareMeters ?? "0");
  }
  if (row.productType === "stair" || row.productType === "prepared") {
    return new import_client7.Prisma.Decimal(row.commercial.requestedQuantity ?? "0");
  }
  if (row.productType === "slab") {
    const snapshot2 = row.commercial.calculationSnapshot;
    const packingPlan = snapshot2?.packingPlan;
    const consumedSources = isObjectRecord(packingPlan) ? packingPlan.consumedSources : void 0;
    if (!Array.isArray(consumedSources)) {
      throw new Error("Canonical slab consumed-source evidence is missing");
    }
    return new import_client7.Prisma.Decimal(consumedSources.length);
  }
  throw new Error("Partner pricing is not supported for this product family");
}
function calculatePartnerCanonicalWholesale(row, approvedMaterialRateToman, layers = [], additionalMaterialRates = /* @__PURE__ */ new Map(), wholesaleMandatory, additionalMandatoryPolicies = /* @__PURE__ */ new Map()) {
  const base = new import_client7.Prisma.Decimal(row.commercial.baseAmountToman ?? "0");
  const total = new import_client7.Prisma.Decimal(row.commercial.totalAmountToman ?? "0");
  const snapshot = row.commercial.calculationSnapshot;
  const chargeMaterial = !base.isZero();
  const materialQuantity = chargeMaterial ? partnerQuotedQuantity(row) : new import_client7.Prisma.Decimal(0);
  if (chargeMaterial && materialQuantity.lte(0)) throw new Error("Canonical Partner pricing quantity is missing");
  const rowLayers = layers.filter((layer) => layer.parentProductRowId === row.productRowId && layer.input.source.kind === "new-material");
  const originalLayerMaterial = rowLayers.reduce((sum2, layer) => sum2.plus(layer.result.materialSourceSplit.newMaterialAmountToman), new import_client7.Prisma.Decimal(0));
  const repricedLayerMaterial = rowLayers.reduce((sum2, layer) => {
    if (layer.input.source.kind !== "new-material") return sum2;
    const rate = layer.input.source.catalogProductId === row.catalogProductId ? approvedMaterialRateToman : additionalMaterialRates.get(layer.input.source.catalogProductId);
    if (!rate) throw new Error("Approved additional material rate is missing");
    return sum2.plus(new import_client7.Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters).mul(rate));
  }, new import_client7.Prisma.Decimal(0));
  const materialAmount = materialQuantity.mul(approvedMaterialRateToman);
  let componentAmount = total.minus(base).minus(originalLayerMaterial);
  const explicitMandatory = readWholesaleMandatory(wholesaleMandatory);
  const mandatoryCharges = [];
  const addMandatory = (subjectId, basis, percentage) => {
    const amount = basis.mul(percentage).div(100);
    mandatoryCharges.push({ subjectId, basisAmount: canonical(basis), percentage, amount: canonical(amount) });
    return amount;
  };
  if (chargeMaterial && snapshot?.partnerPricingBasis === "ordinary-sale-v1" && snapshot.mandatoryEnabled === true) {
    if (typeof snapshot.mandatoryPercentage !== "string" || typeof snapshot.mandatoryAmountToman !== "string") {
      throw new Error("Canonical mandatory pricing evidence is missing");
    }
    const percentage = new import_client7.Prisma.Decimal(snapshot.mandatoryPercentage);
    const originalMandatory = new import_client7.Prisma.Decimal(snapshot.mandatoryAmountToman);
    if (percentage.isNegative() || percentage.gt(100) || originalMandatory.isNegative()) {
      throw new Error("Canonical mandatory pricing evidence is invalid");
    }
    componentAmount = componentAmount.minus(originalMandatory);
    if (componentAmount.isNegative()) throw new Error("Canonical component amount is invalid");
    if (explicitMandatory === void 0) componentAmount = componentAmount.plus(addMandatory(row.productRowId, materialAmount, canonical(percentage)));
  }
  if (chargeMaterial && explicitMandatory) {
    if (explicitMandatory.enabled) componentAmount = componentAmount.plus(addMandatory(row.productRowId, materialAmount, explicitMandatory.percentage));
    const lines = Array.isArray(snapshot?.pricingLines) ? snapshot.pricingLines.filter(isObjectRecord) : [];
    const crossCuts = lines.filter((line) => line.lineId === "crossCutRateToman" || line.lineId === "cross-cut");
    for (const line of crossCuts) {
      if (typeof line.amountToman !== "string" || typeof line.quantity !== "string" || typeof line.rateToman !== "string") {
        throw new Error("Missing frozen cross-cut pricing evidence");
      }
      componentAmount = componentAmount.minus(line.amountToman);
      if (!explicitMandatory.enabled) componentAmount = componentAmount.plus(new import_client7.Prisma.Decimal(line.quantity).mul(line.rateToman));
    }
  }
  for (const layer of rowLayers) {
    if (layer.input.source.kind !== "new-material") continue;
    const mainStone = layer.input.source.catalogProductId === row.catalogProductId;
    const policy = mainStone ? explicitMandatory : readWholesaleMandatory(additionalMandatoryPolicies.get(layer.layerConfigurationId));
    if (!policy) continue;
    const rate = mainStone ? approvedMaterialRateToman : additionalMaterialRates.get(layer.input.source.catalogProductId);
    if (!rate) throw new Error("Approved additional material rate is missing");
    if (policy.enabled) componentAmount = componentAmount.plus(addMandatory(
      `layer-material:${layer.layerConfigurationId}`,
      new import_client7.Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters).mul(rate),
      policy.percentage
    ));
    for (const line of layer.result.cuttingPricingLines ?? []) if (line.lineId.endsWith(":cut:cross")) {
      componentAmount = componentAmount.minus(line.amountToman);
      if (!policy.enabled) componentAmount = componentAmount.plus(new import_client7.Prisma.Decimal(line.quantity).mul(line.rateToman));
    }
  }
  if (componentAmount.isNegative()) throw new Error("Canonical component amount is invalid");
  const finalMaterial = canonical(materialAmount.plus(repricedLayerMaterial));
  const finalTotal = canonical(materialAmount.plus(repricedLayerMaterial).plus(componentAmount));
  return {
    materialQuantity: canonical(materialQuantity),
    materialAmount: finalMaterial,
    componentAmount: canonical(componentAmount),
    totalAmount: finalTotal,
    ...explicitMandatory || additionalMandatoryPolicies.size ? { wholesalePricing: {
      materialAmount: finalMaterial,
      componentAmount: canonical(componentAmount.minus(mandatoryCharges.reduce((sum2, line) => sum2.plus(line.amount), new import_client7.Prisma.Decimal(0)))),
      totalAmount: finalTotal,
      mandatoryCharges
    } } : {}
  };
}

// src/services/partnerSales/cases/technicalGraphMeasures.ts
function technicalGraphMeasures(graph) {
  return graph.rows.map((row) => {
    const facts = row.commercial;
    let unit, quantity;
    if (facts.calculationSnapshot?.partnerPricingBasis === "ordinary-sale-v1" && ["longitudinal", "stair", "slab"].includes(row.productType)) {
      return { productRowId: row.productRowId, unit: "squareMeter", quantity: import_partner_sales_contracts7.QuantitySchema.parse(partnerQuotedQuantity(row).toFixed()) };
    }
    switch (row.productType) {
      case "prepared":
      case "volumetric": {
        const selectedUnit = facts.calculationSnapshot?.unit;
        if (selectedUnit !== "ton" && selectedUnit !== "count" && selectedUnit !== "squareMeter") throw new Error("Missing prepared unit");
        unit = selectedUnit === "ton" ? "ton" : selectedUnit === "count" ? "count" : "squareMeter";
        quantity = import_partner_sales_contracts7.QuantitySchema.parse(facts.requestedQuantity);
        break;
      }
      case "longitudinal": {
        unit = "meter";
        const length = import_partner_sales_contracts7.QuantitySchema.parse(facts.requestedLengthMeters);
        const mode = facts.calculationSnapshot?.quantityMode;
        if (mode === "total-linear-meters") quantity = length;
        else if (mode === "piece-count") {
          const count = import_partner_sales_contracts7.QuantitySchema.parse(facts.requestedQuantity);
          const ExactDecimal = import_client8.Prisma.Decimal.clone({ precision: length.length + count.length + 2 });
          quantity = new ExactDecimal(length).mul(count).toFixed();
        } else throw new Error("Missing longitudinal quantity mode");
        break;
      }
      case "slab":
        unit = "squareMeter";
        quantity = import_partner_sales_contracts7.QuantitySchema.parse(facts.requestedAreaSquareMeters);
        break;
      case "stair":
        unit = "count";
        quantity = import_partner_sales_contracts7.QuantitySchema.parse(facts.requestedQuantity);
        break;
      default:
        throw new Error("Unsupported canonical product family");
    }
    return { productRowId: row.productRowId, unit, quantity };
  });
}

// src/services/partnerSales/cases/technicalGraph.ts
function technicalProductSnapshot(product) {
  const meters = (centimeters) => centimeters === void 0 ? void 0 : (0, import_contract_product_graph8.parseCanonicalDecimal)(new import_client9.Prisma.Decimal(centimeters).div(100).toFixed());
  return {
    catalogProductId: product.catalogItemId,
    snapshotVersion: product.catalogSnapshotVersion,
    facts: {
      attributes: product.attributes,
      motherWidthMeters: meters(product.dimensions.motherWidthCentimeters),
      thicknessMeters: meters(product.dimensions.thicknessCentimeters),
      ...product.dimensions.motherLengthMeters === void 0 ? {} : { motherLengthMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(product.dimensions.motherLengthMeters) }
    }
  };
}
function compilePartnerTechnicalGraph(input, context) {
  const parsed = import_partner_sales_contracts8.PartnerTechnicalDraftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
  const draft = parsed.data;
  if (draft.rows.some((row) => row.family === "volumetric")) {
    return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
  }
  const preview = (0, import_partner_sales_contracts8.previewPartnerTechnicalDraft)(draft, context.catalog);
  if (!preview.ok) return preview;
  if (draft.rows.length === 0 && !draft.serviceRows?.length || preview.value.conflicts.length || preview.value.rows.some((row) => !row.calculation.ok || row.operations && !row.operations.ok) || preview.value.dependents.some((item) => !item.calculation.ok || "operations" in item && item.operations && !item.operations.ok)) {
    return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
  }
  let graph = {
    schemaVersion: 1,
    revision: 0,
    calculationPolicy: context.policy,
    catalogSnapshots: [],
    rows: [],
    stairSystems: [],
    layerConfigurations: [],
    sourceBatches: [],
    remainingStones: [],
    allocations: [],
    operationGroups: [],
    toolSelections: [],
    finishingSelections: []
  };
  try {
    const rowIntents = /* @__PURE__ */ new Map();
    const decimal4 = (value) => value === void 0 ? void 0 : (0, import_contract_product_graph8.parseCanonicalDecimal)(value);
    const versions = {
      calculationPolicyVersion: context.policy.calculation,
      packingPolicyVersion: context.policy.packing,
      pricingPolicyVersion: context.policy.pricing,
      roundingPolicyVersion: context.policy.rounding
    };
    for (const row of draft.rows) {
      const products = context.catalog.products.filter((item) => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      const evidence = context.products.filter((item) => item.catalogItemId === row.catalogItemId && item.catalogSnapshotVersion === row.catalogSnapshotVersion);
      if (products.length !== 1 || evidence.length !== 1) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
      const snapshot = technicalProductSnapshot(products[0]);
      const enteredRate = row.retailUnitPrice ? (0, import_contract_product_graph8.parseCanonicalDecimal)(new import_client9.Prisma.Decimal(row.retailUnitPrice.amount).div(row.retailUnitPrice.currency === "IRR" ? 10 : 1).toFixed()) : void 0;
      if (enteredRate !== void 0 && new import_client9.Prisma.Decimal(enteredRate).lte(0))
        return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
      let intent = { row: {
        productRowId: (0, import_contract_product_graph8.parseStableIdentity)("product-row", row.productRowId),
        catalogProductId: row.catalogItemId,
        catalogSnapshotVersion: row.catalogSnapshotVersion,
        productType: row.family,
        contractualTitle: row.contractualTitle?.trim() || products[0].name,
        ...row.description ? { description: row.description } : {},
        commercial: {}
      } };
      if (row.family === "prepared" || row.family === "volumetric") {
        const rates = evidence[0].preparedRates?.filter((rate) => rate.kind === row.configuration.kind && rate.unit === row.configuration.unit) ?? [];
        if (rates.length !== 1) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
        const quantity = (0, import_contract_product_graph8.parseCanonicalDecimal)(row.configuration.quantity);
        const rateToman = enteredRate ?? (0, import_contract_product_graph8.parseCanonicalDecimal)(rates[0].rateToman);
        const pricing = (0, import_contract_product_graph8.calculatePricing)({
          policyVersion: context.policy.pricing,
          roundingPolicyVersion: context.policy.rounding,
          lines: [{ lineId: row.productRowId, quantity, rateToman }]
        });
        intent = { row: {
          ...intent.row,
          commercial: {
            requestedQuantity: quantity,
            baseRateToman: rateToman,
            baseAmountToman: pricing.totalAmountToman,
            totalAmountToman: pricing.totalAmountToman,
            calculationSnapshot: {
              kind: row.configuration.kind,
              unit: row.configuration.unit,
              quantity,
              squareMeters: row.configuration.unit === "squareMeter" ? quantity : "0",
              pricingPolicyVersion: context.policy.pricing,
              roundingPolicyVersion: context.policy.rounding,
              inputHash: pricing.inputHash,
              resultHash: pricing.resultHash
            }
          }
        } };
      } else if (row.family === "longitudinal") {
        const pricing = evidence[0].longitudinal;
        if (!pricing || !snapshot.facts.motherWidthMeters) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
        intent = { ...intent, productPolicyInput: {
          ...pricing,
          ...row.configuration,
          ...enteredRate === void 0 ? {} : { baseRateToman: enteredRate },
          ...versions,
          mandatoryPercentage: decimal4(row.configuration.mandatoryPercentage) ?? pricing.mandatoryPercentage,
          rememberedMandatoryPercentage: decimal4(row.configuration.mandatoryPercentage) ?? pricing.rememberedMandatoryPercentage,
          sourceBatchId: (0, import_contract_product_graph8.parseStableIdentity)("source-batch", row.configuration.sourceBatchId),
          motherWidthMeters: snapshot.facts.motherWidthMeters,
          sawKerfMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(context.catalog.sawKerfMeters),
          lengthMeters: decimal4(row.configuration.lengthMeters),
          widthMeters: decimal4(row.configuration.widthMeters),
          requestedAreaSquareMeters: decimal4(row.configuration.requestedAreaSquareMeters)
        } };
      } else if (row.family === "slab") {
        const pricing = evidence[0].slab;
        if (!pricing) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
        const { sawKerfEnabled, ...configuration } = row.configuration;
        intent = { ...intent, slabPolicyInput: {
          ...pricing,
          ...configuration,
          ...versions,
          ...enteredRate === void 0 ? {} : { baseMaterialRateToman: enteredRate },
          sourceBatchId: (0, import_contract_product_graph8.parseStableIdentity)("source-batch", configuration.sourceBatchId),
          lengthMeters: decimal4(configuration.lengthMeters),
          widthMeters: decimal4(configuration.widthMeters),
          areaSquareMeters: decimal4(configuration.areaSquareMeters),
          kerfMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(sawKerfEnabled ? context.catalog.sawKerfMeters : "0"),
          sourceRows: configuration.sourceRows.map((source) => ({
            ...source,
            sourceRowId: (0, import_contract_product_graph8.parseStableIdentity)("slab-source-row", source.sourceRowId),
            lengthMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(source.lengthMeters),
            widthMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(source.widthMeters),
            quantity: source.quantity
          }))
        } };
      } else if (row.family === "stair") {
        const pricing = evidence[0].stair;
        if (!pricing) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
        const system = draft.stairSystems?.find((system2) => system2.stairSystemId === row.configuration.stairSystemId);
        if (!system) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
        const { quantityMode, ...configuration } = row.configuration;
        intent = { ...intent, stairPartPolicyInput: {
          ...pricing,
          ...configuration,
          ...versions,
          ...enteredRate === void 0 ? {} : { baseRateToman: enteredRate },
          mandatoryPercentage: decimal4(configuration.mandatoryPercentage) ?? pricing.mandatoryPercentage,
          rememberedMandatoryPercentage: decimal4(configuration.mandatoryPercentage) ?? pricing.rememberedMandatoryPercentage,
          stairSystemId: (0, import_contract_product_graph8.parseStableIdentity)("stair-system", configuration.stairSystemId),
          sourceBatchId: (0, import_contract_product_graph8.parseStableIdentity)("source-batch", configuration.sourceBatchId),
          motherWidthMeters: snapshot.facts.motherWidthMeters,
          motherLengthMeters: decimal4(configuration.motherLengthMeters),
          lengthMeters: decimal4(configuration.lengthMeters),
          crossDimensionMeters: decimal4(configuration.crossDimensionMeters),
          quantity: quantityMode === "system" ? (0, import_contract_product_graph8.resolveStaircaseQuantity)(system.quantity).totalSteps : configuration.quantity,
          sawKerfMeters: (0, import_contract_product_graph8.parseCanonicalDecimal)(context.catalog.sawKerfMeters)
        } };
      } else return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
      if ("operations" in row && row.operations) {
        const technical = preview.value.rows.find((value) => value.productRowId === row.productRowId)?.calculation;
        if (!technical?.ok || !("lengthMeters" in technical.result)) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
        const facts = technical.result;
        intent = { ...intent, operationPolicyInput: technicalGraphOperations(row.operations, {
          productRowId: intent.row.productRowId,
          lengthMeters: facts.lengthMeters,
          widthMeters: "widthMeters" in facts ? facts.widthMeters : facts.crossDimensionMeters,
          quantity: "quantityMode" in facts ? (0, import_contract_product_graph8.longitudinalOperationsQuantity)(facts) : facts.quantity
        }, context) };
      }
      let command = {
        commandId: (0, import_contract_product_graph8.parseStableIdentity)("audit-mutation", `technical:${row.productRowId}`),
        type: "add-row",
        baseRevision: graph.revision,
        calculationPolicy: context.policy,
        catalogSnapshots: [snapshot],
        sellerIntent: intent
      };
      if (row.family === "stair" && !graph.stairSystems.some((system) => system.stairSystemId === row.configuration.stairSystemId)) {
        const system = draft.stairSystems.find((system2) => system2.stairSystemId === row.configuration.stairSystemId);
        command = { ...command, type: "add-stair-system", sellerIntent: {
          stairSystemId: (0, import_contract_product_graph8.parseStableIdentity)("stair-system", system.stairSystemId),
          quantity: system.quantity,
          parts: [intent]
        } };
      }
      const applied = (0, import_contract_product_graph8.executeProductGraphCommand)({ graph, command });
      if (!applied.ok) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
      graph = applied.graph;
      rowIntents.set(row.productRowId, { intent, snapshot });
    }
    if (new Set(draft.rows.flatMap((row) => row.family === "stair" ? [row.configuration.stairSystemId] : [])).size !== graph.stairSystems.length) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
    const dependents = (draft.dependents ?? []).map((intent) => ({
      intent,
      kind: intent.kind,
      order: intent.creationOrder,
      identity: intent.kind === "layer" ? intent.layerConfigurationId : intent.allocationId
    })).sort(import_contract_product_graph8.compareProductDependentOrder);
    for (const { intent } of dependents) {
      if (intent.kind === "layer") {
        const parent = rowIntents.get(intent.parentProductRowId);
        const technical2 = preview.value.dependents.find((item) => item.kind === "layer" && item.layerConfigurationId === intent.layerConfigurationId);
        if (!parent) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INVALID_PAYLOAD") };
        const layer = technicalGraphLayer(intent, technical2, context);
        const snapshots = [parent.snapshot];
        if (layer.source.kind === "new-material") {
          const source = layer.source;
          const matches = context.catalog.products.filter((item) => item.catalogItemId === source.catalogProductId && item.catalogSnapshotVersion === source.catalogSnapshotVersion);
          if (matches.length !== 1) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
          if (!snapshots.some((item) => item.catalogProductId === source.catalogProductId && item.snapshotVersion === source.catalogSnapshotVersion)) {
            snapshots.push(technicalProductSnapshot(matches[0]));
          }
        }
        const applied2 = (0, import_contract_product_graph8.executeProductGraphCommand)({ graph, command: {
          commandId: (0, import_contract_product_graph8.parseStableIdentity)("audit-mutation", `technical:${intent.layerConfigurationId}`),
          type: "replace-row",
          baseRevision: graph.revision,
          calculationPolicy: context.policy,
          catalogSnapshots: snapshots,
          sellerIntent: {
            ...parent.intent,
            layerConfigurationInputs: [...graph.layerConfigurations.filter((item) => item.parentProductRowId === intent.parentProductRowId).map((item) => item.input), layer]
          }
        } });
        if (!applied2.ok) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
        graph = applied2.graph;
        continue;
      }
      const technical = preview.value.dependents.find((item) => item.kind === "remainder" && item.allocationId === intent.allocationId);
      const sellerIntent = technicalGraphRemainder(intent, technical, graph, context);
      const snapshot = graph.catalogSnapshots.find((item) => item.catalogProductId === intent.catalogItemId && item.snapshotVersion === intent.catalogSnapshotVersion);
      if (!snapshot) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
      const applied = (0, import_contract_product_graph8.executeProductGraphCommand)({ graph, command: {
        commandId: (0, import_contract_product_graph8.parseStableIdentity)("audit-mutation", `technical:${intent.allocationId}`),
        type: "add-row",
        baseRevision: graph.revision,
        calculationPolicy: context.policy,
        catalogSnapshots: [snapshot],
        sellerIntent
      } });
      if (!applied.ok) return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
      graph = applied.graph;
    }
  } catch {
    return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
  }
  graph = { ...graph, rows: graph.rows.map((row) => ({ ...row, commercial: {
    ...row.commercial,
    calculationSnapshot: { ...row.commercial.calculationSnapshot, partnerPricingBasis: "ordinary-sale-v1" }
  } })) };
  try {
    return { ok: true, value: { graph, preview: preview.value, measures: technicalGraphMeasures(graph) } };
  } catch {
    return { ok: false, error: (0, import_partner_sales_contracts8.partnerError)("INTEGRITY_CONFLICT") };
  }
}

// src/services/partnerSales/cases/technicalSavedGraph.ts
var canonical2 = (value) => (0, import_partner_sales_contracts9.canonicalJson)(JSON.parse(JSON.stringify(value)));
var content = ({ inputRevision: _correlation, ...draft }) => canonical2(draft);
function compileOrReuseTechnicalSavedGraph(draft, context, previous) {
  if (previous && !draft.editingValues?.length && !previous.draft.editingValues?.length && !draft.rows.some((row) => row.family === "volumetric") && previous.graph.rows.every((row) => row.commercial.calculationSnapshot?.partnerPricingBasis === "ordinary-sale-v1") && content(draft) === content(previous.draft) && canonical2(context) === canonical2(previous.context)) {
    return { ok: true, value: { graph: previous.graph, measures: technicalGraphMeasures(previous.graph) } };
  }
  return compilePartnerTechnicalGraph(draft, context);
}

// src/services/partnerSales/cases/technicalServices.ts
var import_client10 = require("@prisma/client");
var import_partner_sales_contracts10 = require("@sabalanerp/partner-sales-contracts");
async function resolvePartnerTechnicalServices(tx, draft) {
  const rows = [];
  const ids = new Set(draft.rows.map((row) => row.productRowId));
  for (const intent of draft.serviceRows ?? []) {
    if (ids.has(intent.serviceRowId)) return { ok: false, error: (0, import_partner_sales_contracts10.partnerError)("INVALID_PAYLOAD") };
    ids.add(intent.serviceRowId);
    const source = intent.sourceType === "tool" ? await tx.subService.findUnique({ where: { id: intent.catalogItemId } }) : intent.sourceType === "cutting" ? await tx.cuttingType.findUnique({ where: { id: intent.catalogItemId } }) : await tx.stoneFinishing.findUnique({ where: { id: intent.catalogItemId } });
    if (!source || !source.isActive || source.updatedAt.toISOString() !== intent.catalogSnapshotVersion) {
      return { ok: false, error: (0, import_partner_sales_contracts10.partnerError)("ROW_STALE") };
    }
    const unit = "calculationBase" in source && source.calculationBase === "squareMeters" ? "squareMeter" : "meter";
    const rate = "unitPrice" in source ? source.unitPrice : source.pricePerMeter;
    if (!rate || rate.isNegative() || intent.unit !== unit || !intent.quantity || !intent.retailUnitPrice || new import_client10.Prisma.Decimal(intent.quantity).lte(0) || new import_client10.Prisma.Decimal(intent.retailUnitPrice.amount).lte(0)) {
      return { ok: false, error: (0, import_partner_sales_contracts10.partnerError)("INVALID_PAYLOAD") };
    }
    const ExactDecimal = import_client10.Prisma.Decimal.clone({ precision: intent.retailUnitPrice.amount.length + 4 });
    const retail = new ExactDecimal(intent.retailUnitPrice.amount).div(intent.retailUnitPrice.currency === "IRR" ? 10 : 1).toFixed();
    const rateEvidenceId = await (0, import_partner_sales_contracts10.canonicalHash)({
      purpose: "PARTNER_SERVICE_RATE",
      sourceType: intent.sourceType,
      catalogItemId: intent.catalogItemId,
      catalogSnapshotVersion: intent.catalogSnapshotVersion,
      unit,
      amount: rate.toFixed(),
      currency: "IRT"
    });
    rows.push({
      ...intent,
      title: intent.title.trim() || source.namePersian,
      quantity: intent.quantity,
      retailUnitPrice: { amount: retail, currency: "IRT" },
      wholesaleUnitPriceAmount: rate.toFixed(),
      rateEvidenceId
    });
  }
  return { ok: true, value: rows };
}

// src/services/partnerSales/cases/technicalSave.ts
var SAVE_OPERATION = "PARTNER_TECHNICAL_SAVE_V1";
function createPartnerTechnicalSaveService(dependencies) {
  const underLease = technicalRecoveryLease(dependencies);
  return {
    async readSaved(input) {
      const parsed = import_partner_sales_contracts11.PartnerTechnicalSavedReadSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INVALID_PAYLOAD") };
      return underLease(parsed.data, "READ", async (_tx, session, recovery) => {
        const history = recovery?.validatedSnapshots;
        if (!Array.isArray(history)) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)(history === void 0 ? "NOT_FOUND" : "INTEGRITY_CONFLICT") };
        for (const record3 of history) {
          const snapshot = await decodeTechnicalSavedSnapshot(record3);
          if (!snapshot || snapshot.sessionId !== session.id || snapshot.view.recoveryId !== session.draftId || snapshot.view.recoveryRevision > recovery.recoveryRevision) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          if (snapshot.view.recoveryRevision === parsed.data.recoveryRevision) return { ok: true, value: snapshot.view };
        }
        return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("NOT_FOUND") };
      });
    },
    async save(input) {
      const parsed = import_partner_sales_contracts11.PartnerTechnicalSaveSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INVALID_PAYLOAD") };
      const command = parsed.data;
      const payloadHash = await (0, import_partner_sales_contracts11.canonicalHash)(technicalRecoveryJson({
        schemaVersion: 1,
        recoveryId: command.recoveryId,
        baseRevision: command.baseRevision,
        expectedRecoveryRevision: command.expectedRecoveryRevision,
        draft: command.draft
      }));
      return underLease(command, "SAVE", async (tx, session, recovery, now) => {
        const history = recovery?.validatedSnapshots ?? [];
        if (!Array.isArray(history)) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
        const snapshots = [];
        for (const record3 of history) {
          const snapshot2 = await decodeTechnicalSavedSnapshot(record3);
          if (!snapshot2 || snapshot2.sessionId !== session.id || snapshot2.view.recoveryId !== session.draftId || snapshot2.view.recoveryRevision > (recovery?.recoveryRevision ?? 0) || snapshot2.view.recoveryRevision <= (snapshots.at(-1)?.view.recoveryRevision ?? 0)) {
            return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          }
          snapshots.push(snapshot2);
        }
        const identity = {
          actorId: dependencies.actorId,
          operation: SAVE_OPERATION,
          targetScope: session.draftId,
          key: command.idempotencyKey
        };
        const priorOutcome = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
        if (priorOutcome) {
          if (priorOutcome.payloadHash !== payloadHash) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("IDEMPOTENCY_CONFLICT") };
          const outcome = decodeTechnicalSaveOutcome(priorOutcome.outcome);
          const snapshot2 = snapshots.find((item) => item.view.recoveryRevision === outcome?.recoveryRevision);
          if (outcome?.sessionId !== session.id || !snapshot2) {
            return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          }
          return { ok: true, value: { ...snapshot2.view, replayed: true } };
        }
        const revision = recovery?.recoveryRevision ?? 0;
        if (revision !== command.expectedRecoveryRevision || revision === Number.MAX_SAFE_INTEGER) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("ROW_STALE") };
        const reserved = await tx.partnerCommandOutcome.findMany({ where: { operation: SAVE_OPERATION, targetScope: session.draftId }, select: { outcome: true } });
        let highestRevision = revision;
        for (const record3 of reserved) {
          const outcome = decodeTechnicalSaveOutcome(record3.outcome);
          if (!outcome) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          highestRevision = Math.max(highestRevision, outcome.recoveryRevision);
        }
        if (highestRevision === Number.MAX_SAFE_INTEGER) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("ROW_STALE") };
        const savedRevision = highestRevision + 1;
        const previous = snapshots.at(-1) ?? null;
        const evidence = await dependencies.resolveEvidence(tx, {
          actorId: dependencies.actorId,
          recoveryId: session.draftId,
          draft: command.draft,
          previous
        });
        if (!evidence.ok) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)(evidence.error.code) };
        const services = await resolvePartnerTechnicalServices(tx, command.draft);
        if (!services.ok) return services;
        const compiled = compileOrReuseTechnicalSavedGraph(command.draft, evidence.value.context, previous);
        if (!compiled.ok) return compiled;
        const graph = compiled.value.graph;
        if (services.value.some((service) => graph.rows.some((row) => row.productRowId === service.serviceRowId))) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INVALID_PAYLOAD") };
        const graphHash = await (0, import_partner_sales_contracts11.canonicalHash)({ purpose: "PARTNER_CASE_GRAPH", schemaVersion: 1, graph });
        const identities = evidence.value.identities;
        if (identities.length < graph.rows.length || new Set(identities.map((item) => item.productRowId)).size !== identities.length || graph.rows.some((row) => !identities.some((item) => item.productRowId === row.productRowId))) {
          return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
        }
        const rows = [];
        for (const row of graph.rows) {
          for (const saved of snapshots) {
            const original = saved.graph.rows.find((item) => item.productRowId === row.productRowId);
            if (original && (!previous?.graph.rows.some((item) => item.productRowId === row.productRowId) || original.productType !== row.productType || original.catalogProductId !== row.catalogProductId || original.parentProductRowId !== row.parentProductRowId || original.sourceProductRowId !== row.sourceProductRowId || original.stairPart?.part !== row.stairPart?.part || original.stairPart?.stairSystemId !== row.stairPart?.stairSystemId)) {
              return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
            }
          }
          const inquiry = import_partner_sales_contracts11.InquiryIdentitySchema.safeParse(identities.find((item) => item.productRowId === row.productRowId)?.identity);
          const mainStoneRate = inquiry.success && inquiry.data.configuration.some((item) => item.key === "pricingSubjectHash") && inquiry.data.calculationPolicyVersion === "partner-main-stone-rate-v2" && inquiry.data.roundingPolicyVersion === "partner-main-stone-rate-v2";
          if (!inquiry.success || inquiry.data.partnerSellerId !== dependencies.actorId || inquiry.data.catalogProductId !== row.catalogProductId || inquiry.data.family !== row.productType || !mainStoneRate && (inquiry.data.calculationPolicyVersion !== graph.calculationPolicy.calculation || inquiry.data.roundingPolicyVersion !== graph.calculationPolicy.rounding)) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          const measure = compiled.value.measures.find((item) => item.productRowId === row.productRowId);
          if (!measure || !mainStoneRate && measure.unit !== inquiry.data.unit) {
            return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
          }
          const old = previous?.identities.find((item) => item.productRowId === row.productRowId);
          const configurationChange = !old ? "NEW" : await (0, import_partner_sales_contracts11.canonicalHash)(technicalRecoveryJson(old.identity)) === await (0, import_partner_sales_contracts11.canonicalHash)(technicalRecoveryJson(inquiry.data)) ? "UNCHANGED" : "CHANGED";
          rows.push({
            configurationRef: { recoveryId: session.draftId, recoveryRevision: savedRevision, productRowId: row.productRowId },
            quantity: measure.quantity,
            unit: measure.unit,
            configurationChange
          });
        }
        const updatedAt = recovery && technicalDraftContent(recovery.draft) === technicalDraftContent(command.draft) ? recovery.updatedAt : now.getTime();
        const paidChildren = new Set((command.draft.dependents ?? []).flatMap((row) => row.kind === "remainder" ? [row.productRowId] : []));
        const pricingSubjects = identities.filter((identity2) => !paidChildren.has(identity2.productRowId)).map((identity2) => ({
          configurationRef: {
            recoveryId: session.draftId,
            recoveryRevision: savedRevision,
            productRowId: identity2.productRowId
          },
          role: graph.rows.some((row) => row.productRowId === identity2.productRowId) ? "PRIMARY" : "ADDITIONAL_MATERIAL"
        }));
        const view = import_partner_sales_contracts11.PartnerTechnicalSavedViewSchema.safeParse({
          schemaVersion: 1,
          recoveryId: session.draftId,
          recoveryRevision: savedRevision,
          inputRevision: command.draft.inputRevision,
          graphHash,
          updatedAt: new Date(updatedAt).toISOString(),
          rows,
          pricingSubjects,
          ...services.value.length ? { serviceRows: services.value.map(({ serviceRowId, quantity, unit }) => ({ serviceRowId, quantity, unit })) } : {}
        });
        if (!view.success) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("INTEGRITY_CONFLICT") };
        const snapshot = await encodeTechnicalSavedSnapshot({
          version: 1,
          sessionId: session.id,
          view: view.data,
          draft: command.draft,
          graph,
          context: evidence.value.context,
          identities,
          ...services.value.length ? { serviceRows: services.value } : {}
        });
        const stillAuthorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, recoveryId: session.draftId, operation: "SAVE" });
        if (!stillAuthorized.ok) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)(stillAuthorized.error.code) };
        const current = await tx.salesContractEditSession.findUnique({ where: { draftId: session.draftId } });
        const [commitClock] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
        if (!current || current.id !== session.id || current.ownerUserId !== dependencies.actorId || current.browserSessionId !== command.browserSessionId || current.leaseToken !== command.leaseToken || commitClock.now.getTime() - current.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
          return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("FORBIDDEN") };
        }
        if (recovery && commitClock.now.getTime() - recovery.updatedAt > CONTRACT_CREATION_DRAFT_TTL_MS) {
          return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("STATE_CONFLICT") };
        }
        const next = {
          ...recovery,
          kind: PARTNER_TECHNICAL_RECOVERY_KIND,
          version: 1,
          recoveryRevision: savedRevision,
          updatedAt,
          draft: command.draft,
          validatedSnapshots: [...history, snapshot]
        };
        const written = await tx.salesContractEditSession.updateMany({ where: {
          draftId: session.draftId,
          leaseToken: session.leaseToken,
          baseRevision: session.baseRevision,
          recovery: { equals: session.recovery === null ? import_client11.Prisma.AnyNull : technicalRecoveryJson(session.recovery) },
          id: session.id,
          contractId: session.contractId
        }, data: { recovery: technicalRecoveryJson(next), updatedAt: commitClock.now } });
        if (written.count !== 1) return { ok: false, error: (0, import_partner_sales_contracts11.partnerError)("ROW_STALE") };
        const receipt = { ...view.data, replayed: false };
        await tx.partnerCommandOutcome.create({ data: {
          id: (0, import_node_crypto2.randomUUID)(),
          ...identity,
          payloadHash,
          outcome: technicalRecoveryJson({ version: 1, sessionId: session.id, recoveryRevision: savedRevision }),
          recordedAt: commitClock.now
        } });
        return { ok: true, value: receipt };
      });
    }
  };
}

// src/services/__tests__/partnerTechnicalRecovery.integration.test.ts
var import_testing = require("@sabalanerp/partner-sales-contracts/testing");

// src/services/partnerSales/authorization/technicalRecovery.ts
var import_partner_sales_contracts17 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/cases/commercialEditPermission.ts
var import_partner_sales_contracts12 = require("@sabalanerp/partner-sales-contracts");
async function readPartnerCommercialEditPermission(tx, contractId, actorId, now = /* @__PURE__ */ new Date()) {
  const requests = await tx.accountingCorrectionRequest.findMany({ where: { contractId, status: "APPROVED_FOR_SALES_EDIT" }, select: { id: true, accountantNote: true } });
  const duty = await tx.crossWorkspaceDuty.findFirst({ where: {
    sourceType: "SALES_CONTRACT_CORRECTION",
    sourceId: { in: requests.map((item) => item.id) },
    sourceActionCode: "SALES_EDIT_CONTRACT_CORRECTION",
    status: "OPEN",
    dueAt: { gt: now },
    currentAssigneeUserId: actorId
  } });
  if (!duty) return null;
  const decision = await tx.crossWorkspaceDuty.findFirst({
    where: {
      sourceId: duty.sourceId,
      sourceType: "SALES_CONTRACT_CORRECTION",
      sourceActionCode: "ACCOUNTING_DECIDE_CONTRACT_CORRECTION",
      status: "COMPLETED"
    },
    orderBy: { respondedAt: "desc" }
  });
  if (!decision?.respondedByUserId || !decision.respondedAt || decision.structuredResultJson?.actionCode !== "APPROVE") return null;
  return { ...duty, accountantNote: requests.find((item) => item.id === duty.sourceId).accountantNote, managerApprovedBy: decision.respondedByUserId, managerApprovedAt: decision.respondedAt };
}
async function partnerTechnicalCaseIsEditable(tx, input) {
  if ((0, import_partner_sales_contracts12.isPartnerCaseEditableState)(input.caseState)) return true;
  if (input.caseState !== "COMMITTED") return false;
  const contract = await tx.salesContract.findUnique({ where: { id: input.contractId }, select: {
    isInactive: true,
    status: true,
    firstFinancialRecordAt: true,
    commercialExpiresAt: true
  } });
  const now = /* @__PURE__ */ new Date();
  if (!contract || contract.isInactive || ["CANCELLED", "EXPIRED"].includes(contract.status) || !contract.firstFinancialRecordAt && contract.commercialExpiresAt && contract.commercialExpiresAt <= now) return false;
  return !!await readPartnerCommercialEditPermission(tx, input.contractId, input.actorId, now);
}

// src/services/partnerSales/authorization/audited.ts
var import_partner_sales_contracts16 = require("@sabalanerp/partner-sales-contracts");

// src/services/effectiveAuthorization/audit.ts
var import_node_crypto3 = require("node:crypto");
async function appendAuthorizationDecision(tx, event) {
  const id = (0, import_node_crypto3.randomUUID)();
  await tx.$executeRaw`INSERT INTO effective_authorization_audit
    (id, domain, "actorId", action, "rootKind", "rootId", purpose, channel, allowed, "isAdmin", code, scope, reason,
      "correlationId", "authorizationRevision", "lifecycleRevision", "assignmentId", "assignmentRevision", "evaluatedAt", "evaluatedGrantIds")
    VALUES (${id}, ${event.domain}, ${event.actorId}, ${event.action}, ${event.rootKind}, ${event.rootId}, ${event.purpose},
      ${event.channel}, ${event.allowed}, ${event.isAdmin}, ${event.code}, ${event.scope}, ${event.reason}, ${event.correlationId},
      ${event.authorizationRevision}, ${event.lifecycleRevision}, ${event.assignmentId}, ${event.assignmentRevision},
      ${event.evaluatedAt}, ${JSON.stringify(event.evaluatedGrantIds)}::jsonb)`;
  return { id };
}

// src/services/partnerSales/cases/operationalDeletion.ts
async function partnerContractWasDeleted(client, contractId) {
  return Boolean(await client.contractLifecycleRequest.findFirst({ where: { contractId, kind: "DELETE", status: "EXECUTED" }, select: { id: true } }));
}

// src/services/partnerSales/authorization/prisma.ts
var import_partner_sales_contracts14 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/authorization/service.ts
var import_partner_sales_contracts13 = require("@sabalanerp/partner-sales-contracts");

// src/services/partnerSales/authorization/capabilities.ts
var partnerCapabilities = {
  PROFILE_READ: [["PROFILE", "ONBOARDING"]],
  CUSTOMER_READ: [["CUSTOMER", "CRM"]],
  CUSTOMER_WRITE: [["CUSTOMER", "CRM"]],
  INQUIRY_READ: [["INQUIRY", "PARTNER"]],
  // The first inquiry does not exist yet, so creation is authorized against
  // the owning Profile. Existing inquiry mutations remain rooted in Inquiry.
  INQUIRY_WRITE: [["INQUIRY", "PARTNER"], ["PROFILE", "PARTNER"]],
  // Before Case creation the creator-private technical draft is rooted in the
  // owning Profile. This never grants another actor access to a recovery id.
  CASE_READ: [["CASE", "PARTNER"], ["PROFILE", "PARTNER"]],
  CASE_DRAFT_WRITE: [["CASE", "PARTNER"], ["PROFILE", "PARTNER"]],
  // The Case does not exist at final submission time, so creation is rooted in
  // the already-authorized Profile. Existing Case mutations remain Case-rooted.
  CASE_SUBMIT: [["CASE", "PARTNER"], ["PROFILE", "PARTNER"]],
  CASE_CANCEL: [["CASE", "PARTNER"]],
  CUSTOMER_OUTPUT: [["CASE", "CUSTOMER_OUTPUT"]],
  // Permission to execute the signed/printed command, not a lifecycle bypass.
  CASE_COMMIT: [["CASE", "PARTNER"]],
  RETAIL_COLLECTION_WRITE: [["CASE", "PARTNER"]],
  CORRECTION_REQUEST: [["CASE", "PARTNER"]],
  RETAIL_CORRECTION_SAVE: [["CASE", "PARTNER"]],
  VOID_REQUEST: [["CASE", "PARTNER"]],
  ACCOUNTING_READ: [["PROFILE", "PARTNER"]],
  FULFILLMENT_READ: [["CASE", "PARTNER"]],
  REPORT_READ: [["PROFILE", "PARTNER"], ["CASE", "PARTNER"]]
};
var partnerCapabilitiesV2 = {
  ...partnerCapabilities,
  CUSTOMER_LIST: [["PROFILE", "CRM"]],
  CUSTOMER_CREATE: [["PROFILE", "CRM"]],
  // Cross-owner duplicate disclosure is produced only after authorizing the
  // active requester's own Profile. The service then returns the fixed masked
  // witness; this Profile capability never grants target Customer access.
  CUSTOMER_DUPLICATE_MATCH: [["PROFILE", "CRM"]],
  CUSTOMER_TRANSFER_REQUEST: [["PROFILE", "CRM"]]
};
var internalCapabilities = {
  PROFILE_READ: [["PROFILE", "ONBOARDING"]],
  IDENTITY_VERIFY: [["PROFILE", "ONBOARDING"]],
  PROFILE_CREATE: [["PROFILE", "ONBOARDING"]],
  PROFILE_ACTIVATE: [["PROFILE", "ONBOARDING"]],
  PROFILE_SUSPEND: [["PROFILE", "ONBOARDING"]],
  PROFILE_TERMINATE: [["PROFILE", "ONBOARDING"]],
  RESPONDER_ASSIGN: [["PROFILE", "MANAGEMENT"]],
  RESPONDER_REASSIGN: [["INQUIRY", "MANAGEMENT"]],
  CUSTOMER_READ: [["CUSTOMER", "CRM"]],
  CUSTOMER_TRANSFER_DECIDE: [["CUSTOMER", "CRM"]],
  INQUIRY_READ: [["INQUIRY", "RESPONDER"], ["INQUIRY", "MANAGEMENT"]],
  ACCOUNTING_READ: [["CASE", "ACCOUNTING"]],
  ACCOUNTING_WRITE: [["CASE", "ACCOUNTING"]],
  FULFILLMENT_READ: [["CASE", "FULFILLMENT"]],
  FULFILLMENT_WRITE: [["CASE", "FULFILLMENT"]],
  CASE_READ: [["CASE", "MANAGEMENT"]],
  CASE_CANCEL: [["CASE", "MANAGEMENT"]],
  CASE_COMMIT: [["CASE", "MANAGEMENT"]],
  CUSTOMER_OUTPUT: [["CASE", "CUSTOMER_OUTPUT"]],
  CORRECTION_SCOPE_APPROVE: [["CASE", "MANAGEMENT"]],
  INTERNAL_REMEDIATION: [["CASE", "MANAGEMENT"], ["INQUIRY", "MANAGEMENT"]],
  CREDIT_TERMS_MANAGE: [["PROFILE", "ACCOUNTING"]],
  FINANCIAL_VERIFY: [["CASE", "ACCOUNTING"]],
  REPORT_READ: [["PROFILE", "MANAGEMENT"], ["CASE", "MANAGEMENT"], ["PROFILE", "ACCOUNTING"], ["CASE", "ACCOUNTING"]],
  AUDIT_READ: [["PROFILE", "AUDIT"], ["CUSTOMER", "AUDIT"], ["INQUIRY", "AUDIT"], ["CASE", "AUDIT"]],
  OPERATIONS_MANAGE: [["PROFILE", "OPERATIONS"]],
  INQUIRY_RESPOND: [["INQUIRY", "RESPONDER"]],
  FINANCIAL_PROCESS: [["CASE", "ACCOUNTING"]],
  FINANCIAL_APPROVE: [["CASE", "ACCOUNTING"]],
  VOID_REMEDIATION_REQUEST: [["CASE", "MANAGEMENT"]]
};
var internalCapabilitiesV2 = {
  ...internalCapabilities,
  COMMERCIAL_TERMS_MANAGE: [["PROFILE", "MANAGEMENT"]],
  PROFILE_CONVERSION_MANAGE: [["PROFILE", "MANAGEMENT"]],
  CUSTOMER_DUPLICATE_MATCH: [["CUSTOMER", "CRM"]],
  CUSTOMER_TRANSFER_REQUEST: [["CUSTOMER", "CRM"]]
};
var readActions = /* @__PURE__ */ new Set([
  "PROFILE_READ",
  "CUSTOMER_READ",
  "INQUIRY_READ",
  "CASE_READ",
  "CUSTOMER_OUTPUT",
  "ACCOUNTING_READ",
  "FULFILLMENT_READ",
  "REPORT_READ",
  "AUDIT_READ",
  "CUSTOMER_LIST"
]);

// src/services/partnerSales/authorization/service.ts
function createPartnerAuthorizationV2(source, binding) {
  return createAuthorization(source, binding, 2);
}
function createAuthorization(source, binding, version) {
  const actionSchema = version === 1 ? import_partner_sales_contracts13.PartnerActionSchema : import_partner_sales_contracts13.PartnerActionV2Schema;
  const internal = version === 1 ? internalCapabilities : internalCapabilitiesV2;
  return { async authorize(action, root) {
    if (!actionSchema.safeParse(action).success || !import_partner_sales_contracts13.PermissionContextSchema.shape.root.safeParse(root).success) {
      return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("INVALID_PAYLOAD") };
    }
    if (binding.channel === "PUBLIC" && action !== "CUSTOMER_OUTPUT") return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("FORBIDDEN") };
    const evidence = await source.read(binding.actorId, root);
    const { actor, resource } = evidence;
    if (!actor.active || actor.id !== binding.actorId || !resource || resource.root.id !== root.id || resource.root.kind !== root.kind) {
      return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("NOT_FOUND") };
    }
    const partner = actor.partnerProfile;
    const admin = !partner && actor.role === "ADMIN";
    if (partner && (resource.partnerSellerId !== actor.id || partner.state === "PENDING" && !(action === "PROFILE_READ" && root.kind === "PROFILE" && binding.purpose === "ONBOARDING"))) {
      return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("NOT_FOUND") };
    }
    if (partner && partner.state !== resource.partnerStatus) return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("INTEGRITY_CONFLICT") };
    const grants = evidence.grants.filter((grant) => grant.rootKind === root.kind && grant.purpose === binding.purpose && internal[grant.action]?.some(([kind, purpose]) => kind === root.kind && purpose === binding.purpose) && (!grant.expiresAt || Date.parse(grant.expiresAt) > Date.parse(evidence.evaluatedAt)) && (grant.scope === "COMPANY" || grant.scope === "DEPARTMENT" && actor.departmentId && actor.departmentId === resource.departmentId || grant.scope === "ASSIGNED" && binding.purpose === "RESPONDER" && resource.assignment?.actorId === actor.id && resource.assignment.eligible || grant.scope === "PURPOSE_BOUND" && ["ACCOUNTING", "FULFILLMENT"].includes(binding.purpose) && grant.boundRootId === root.id));
    if (!partner && !admin && !grants.length) return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("NOT_FOUND") };
    const actionGrant = grants.find((grant) => grant.action === action);
    const companyResponderOverride = binding.purpose === "RESPONDER" && (admin || actionGrant?.scope === "COMPANY");
    if (binding.purpose === "RESPONDER" && !companyResponderOverride && (!resource.assignment?.eligible || resource.assignment.actorId !== actor.id)) {
      return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("NOT_ASSIGNED") };
    }
    const capabilities = partner ? version === 1 ? partnerCapabilities : partnerCapabilitiesV2 : internal;
    const context = {
      ...binding,
      root: { kind: root.kind, id: root.id },
      persona: partner ? "PARTNER" : "INTERNAL",
      isAdmin: admin,
      partnerSellerId: resource.partnerSellerId,
      partnerStatus: resource.partnerStatus,
      scope: partner ? "OWN" : admin ? "COMPANY" : (actionGrant ?? grants[0]).scope,
      resourceVisible: true,
      departmentId: actor.departmentId,
      actionGranted: (Boolean(partner) || admin || Boolean(actionGrant)) && (capabilities[action]?.some(([kind, purpose]) => kind === root.kind && purpose === binding.purpose) ?? false),
      authorizationRevision: evidence.authorizationRevision,
      lifecycleRevision: resource.lifecycleRevision,
      evaluatedAt: evidence.evaluatedAt,
      grantExpiresAt: actionGrant?.expiresAt,
      assignment: resource.assignment,
      requesterId: resource.requesterId
    };
    const parsed = import_partner_sales_contracts13.PermissionContextSchema.safeParse(context);
    if (!parsed.success) return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("INTEGRITY_CONFLICT") };
    const legacy = import_partner_sales_contracts13.PartnerActionSchema.safeParse(action);
    const denial = legacy.success ? (0, import_partner_sales_contracts13.checkPartnerDomainRestrictions)(legacy.data, parsed.data) : !parsed.data.actionGranted ? (0, import_partner_sales_contracts13.partnerError)("FORBIDDEN") : null;
    if (denial) return { ok: false, error: denial };
    if (partner && !readActions.has(action) && partner.state !== "ACTIVE") return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("PARTNER_NOT_ACTIVE") };
    const internalVoidingGate = !partner && action === "CORRECTION_SCOPE_APPROVE" && resource.correctionScope === "VOID";
    if (["CASE_COMMIT", "CORRECTION_SCOPE_APPROVE"].includes(action) && resource.partnerStatus !== "ACTIVE" && !internalVoidingGate) {
      return { ok: false, error: (0, import_partner_sales_contracts13.partnerError)("PARTNER_NOT_ACTIVE") };
    }
    return { ok: true, value: parsed.data };
  } };
}

// src/services/partnerSales/authorization/prisma.ts
function prismaAuthorizationSource(tx, resolveAuthority, target) {
  return { read: async (actorId, root) => {
    let resource = null;
    let profileId = root.kind === "PROFILE" ? root.id : null;
    if (root.kind === "PROFILE" && target && "prospectiveProfileOwnerId" in target) {
      for (const id of [.../* @__PURE__ */ new Set([actorId, target.prospectiveProfileOwnerId])].sort()) {
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
      }
      const prospective = await tx.user.findUnique({
        where: { id: target.prospectiveProfileOwnerId },
        select: { isActive: true, departmentId: true, partnerProfile: { select: { id: true } } }
      });
      if (prospective?.isActive && !prospective.partnerProfile) {
        resource = {
          root,
          partnerSellerId: target.prospectiveProfileOwnerId,
          partnerStatus: "PENDING",
          lifecycleRevision: 1,
          ...prospective.departmentId ? { departmentId: prospective.departmentId } : {}
        };
      }
      profileId = null;
    }
    if (root.kind === "INQUIRY") {
      await tx.$queryRaw`SELECT id FROM partner_inquiries WHERE id = ${root.id} FOR UPDATE`;
      profileId = (await tx.partnerInquiry.findUnique({ where: { id: root.id }, select: { profileId: true } }))?.profileId ?? null;
    }
    if (root.kind === "CASE") {
      await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${root.id} FOR UPDATE`;
      const sale = await tx.partnerSaleCase.findUnique({ where: { id: root.id }, select: { profileId: true, customerContractId: true } });
      profileId = sale && (!sale.customerContractId || !await partnerContractWasDeleted(tx, sale.customerContractId)) ? sale.profileId : null;
    }
    if (root.kind === "CUSTOMER") {
      await tx.$queryRaw`SELECT id FROM crm_customers WHERE id = ${root.id} FOR UPDATE`;
      const customer = await tx.crmCustomer.findUnique({ where: { id: root.id }, select: {
        ownerUserId: true,
        partnerRevision: true,
        isActive: true
      } });
      if (customer?.isActive && customer.ownerUserId && target && "customerTransferId" in target) {
        await tx.$queryRaw`SELECT id FROM partner_customer_transfers WHERE id = ${target.customerTransferId} FOR UPDATE`;
        const transfer = await tx.partnerCustomerTransfer.findUnique({ where: { id: target.customerTransferId }, select: {
          customerId: true,
          fromOwnerUserId: true,
          fromProfileId: true,
          toProfileId: true,
          revision: true,
          status: true,
          fromProfile: { select: { state: true, revision: true } },
          toProfile: { select: { userId: true } }
        } });
        if (transfer?.customerId === root.id) {
          for (const id of [...new Set([transfer.fromProfileId, transfer.toProfileId].filter((item) => Boolean(item)))].sort()) {
            await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${id} FOR UPDATE`;
          }
          for (const id of [.../* @__PURE__ */ new Set([actorId, transfer.fromOwnerUserId, transfer.toProfile.userId])].sort()) {
            await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
          }
          const owner = await tx.user.findUnique({ where: { id: transfer.fromOwnerUserId }, select: {
            isActive: true,
            departmentId: true
          } });
          if (owner) resource = {
            root,
            partnerSellerId: transfer.fromOwnerUserId,
            partnerStatus: transfer.fromProfile?.state ?? "ACTIVE",
            lifecycleRevision: transfer.fromProfile?.revision ?? customer.partnerRevision ?? transfer.revision,
            ...owner.departmentId ? { departmentId: owner.departmentId } : {}
          };
        }
        profileId = null;
      } else if (customer?.isActive && customer.ownerUserId && target && "directTransferProfileId" in target) {
        const owner = await tx.user.findUnique({ where: { id: customer.ownerUserId }, select: { departmentId: true } });
        if (owner) resource = {
          root,
          partnerSellerId: customer.ownerUserId,
          partnerStatus: "ACTIVE",
          lifecycleRevision: customer.partnerRevision ?? 1,
          ...owner.departmentId ? { departmentId: owner.departmentId } : {}
        };
      } else if (customer?.isActive && customer.ownerUserId) {
        profileId = (await tx.partnerProfile.findUnique({ where: { userId: customer.ownerUserId }, select: { id: true } }))?.id ?? null;
      }
    }
    if (profileId) {
      await tx.$queryRaw`SELECT id FROM partner_profiles WHERE id = ${profileId} FOR UPDATE`;
      const profile = await tx.partnerProfile.findUnique({ where: { id: profileId }, select: { userId: true, state: true, revision: true } });
      if (profile) {
        const userIds = [.../* @__PURE__ */ new Set([actorId, profile.userId])].sort();
        for (const id of userIds) await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const owner = await tx.user.findUnique({ where: { id: profile.userId }, select: { departmentId: true } });
        resource = {
          root,
          partnerSellerId: profile.userId,
          partnerStatus: profile.state,
          lifecycleRevision: profile.revision,
          ...owner?.departmentId ? { departmentId: owner.departmentId } : {}
        };
      }
    }
    const actor = await tx.user.findUnique({ where: { id: actorId }, select: {
      id: true,
      isActive: true,
      role: true,
      departmentId: true,
      partnerProfile: { select: { state: true, revision: true } }
    } });
    if (root.kind === "INQUIRY" && resource) {
      const assignment = await tx.partnerInquiryAssignment.findFirst({
        where: { inquiryId: root.id },
        orderBy: { revision: "desc" },
        select: { id: true, revision: true, responderId: true }
      });
      if (assignment) resource.assignment = {
        actorId: assignment.responderId,
        assignmentId: assignment.id,
        revision: assignment.revision,
        eligible: assignment.responderId === actorId && Boolean(actor?.isActive) && !actor?.partnerProfile
      };
    }
    if (target && "correctionOpportunityId" in target && resource) {
      const opportunity = await tx.partnerCorrectionOpportunity.findUnique({
        where: { id: target.correctionOpportunityId },
        select: { caseId: true, requesterId: true, scope: true }
      });
      if (root.kind !== "CASE" || opportunity?.caseId !== root.id) resource = null;
      else {
        await tx.$queryRaw`SELECT id FROM partner_correction_opportunities WHERE id = ${target.correctionOpportunityId} FOR UPDATE`;
        resource.requesterId = opportunity.requesterId;
        resource.correctionScope = opportunity.scope;
      }
    }
    const authority = actor?.isActive && resource ? await resolveAuthority(tx, { actorId, root }) : { grants: [], authorizationRevision: 1 };
    const [clock] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
    return { ...authority, evaluatedAt: clock.now.toISOString(), resource, actor: {
      id: actorId,
      active: actor?.isActive ?? false,
      role: actor?.role ?? "USER",
      ...actor?.departmentId ? { departmentId: actor.departmentId } : {},
      ...actor?.partnerProfile ? { partnerProfile: actor.partnerProfile } : {}
    } };
  } };
}

// src/services/partnerSales/authorization/centralAuthority.ts
var import_partner_sales_contracts15 = require("@sabalanerp/partner-sales-contracts");

// src/services/narrowFeatureAccess.ts
var levels = ["view", "edit", "admin"];
var activeAt = (permission2, at) => Boolean(
  permission2?.isActive && (!permission2.expiresAt || permission2.expiresAt.getTime() > at.getTime())
);
var evaluateNarrowFeatureAccess = (input, at = /* @__PURE__ */ new Date()) => {
  if (input.role === "ADMIN") return { allowed: true, permissionLevel: "admin" };
  const directFeature = activeAt(input.userFeature, at) ? input.userFeature : null;
  const directWorkspace = activeAt(input.userWorkspace, at) ? input.userWorkspace : null;
  const roleFeature = activeAt(input.roleFeature, at) ? input.roleFeature : null;
  const roleWorkspace = activeAt(input.roleWorkspace, at) ? input.roleWorkspace : null;
  const permissionLevelValue = directWorkspace?.permissionLevel === "admin" ? "admin" : directFeature?.permissionLevel ?? (!directWorkspace ? roleFeature?.permissionLevel : void 0) ?? (!directWorkspace && roleWorkspace?.permissionLevel === "admin" ? "admin" : void 0);
  const permissionLevel = levels.includes(permissionLevelValue) ? permissionLevelValue : void 0;
  const allowed = Boolean(permissionLevel && levels.indexOf(permissionLevel) >= levels.indexOf(input.requiredPermission));
  return { allowed, permissionLevel: allowed ? permissionLevel : null };
};
var resolveNarrowFeatureAccess = async (prisma2, input, at = /* @__PURE__ */ new Date()) => {
  const [userFeature, roleFeature, userWorkspace, roleWorkspace] = await Promise.all([
    prisma2.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: input.userId, workspace: input.workspace, feature: input.feature } } }),
    prisma2.roleFeaturePermission.findUnique({ where: { role_workspace_feature: { role: input.role, workspace: input.workspace, feature: input.feature } } }),
    prisma2.workspacePermission.findUnique({ where: { userId_workspace: { userId: input.userId, workspace: input.workspace } } }),
    prisma2.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: input.role, workspace: input.workspace } } })
  ]);
  return evaluateNarrowFeatureAccess({ role: input.role, requiredPermission: input.requiredPermission, userFeature, roleFeature, userWorkspace, roleWorkspace }, at);
};

// src/middleware/feature.ts
var FEATURE_PERMISSIONS = {
  VIEW: "view",
  EDIT: "edit",
  ADMIN: "admin"
};
var FEATURES = {
  // Core/Admin Features
  CORE_DASHBOARD_STATS_VIEW: "core_dashboard_stats_view",
  CORE_DASHBOARD_PROFILE_VIEW: "core_dashboard_profile_view",
  CORE_DEPARTMENTS_VIEW: "core_departments_view",
  CORE_DEPARTMENTS_CREATE: "core_departments_create",
  CORE_DEPARTMENTS_EDIT: "core_departments_edit",
  CORE_DEPARTMENTS_DELETE: "core_departments_delete",
  CORE_POSTS_VIEW: "core_posts_view",
  CORE_POSTS_CREATE: "core_posts_create",
  CORE_POSTS_EDIT: "core_posts_edit",
  CORE_POSTS_DELETE: "core_posts_delete",
  CORE_ORDERS_VIEW: "core_orders_view",
  CORE_ORDERS_CREATE: "core_orders_create",
  CORE_ORDERS_EDIT: "core_orders_edit",
  CORE_ORDERS_DELETE: "core_orders_delete",
  CORE_ORDERS_UPDATE_STATUS: "core_orders_update_status",
  // CRM Features
  CRM_CUSTOMERS_VIEW: "crm_customers_view",
  CRM_CUSTOMERS_VIEW_ALL: "crm_customers_view_all",
  CRM_CUSTOMERS_CREATE: "crm_customers_create",
  CRM_CUSTOMERS_EDIT: "crm_customers_edit",
  CRM_CUSTOMERS_DELETE: "crm_customers_delete",
  CRM_CUSTOMERS_BLACKLIST: "crm_customers_blacklist",
  CRM_CUSTOMERS_LOCK: "crm_customers_lock",
  CRM_CUSTOMERS_ASSIGN_OWNER: "crm_customers_assign_owner",
  CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE: "crm_partner_customer_transfers_manage",
  CRM_PROJECT_ADDRESSES_CREATE: "crm_project_addresses_create",
  CRM_PROJECT_ADDRESSES_EDIT: "crm_project_addresses_edit",
  CRM_PROJECT_ADDRESSES_DELETE: "crm_project_addresses_delete",
  CRM_PHONE_NUMBERS_CREATE: "crm_phone_numbers_create",
  CRM_PHONE_NUMBERS_EDIT: "crm_phone_numbers_edit",
  CRM_PHONE_NUMBERS_DELETE: "crm_phone_numbers_delete",
  CRM_CONTACTS_VIEW: "crm_contacts_view",
  CRM_CONTACTS_CREATE: "crm_contacts_create",
  CRM_CONTACTS_EDIT: "crm_contacts_edit",
  CRM_CONTACTS_DELETE: "crm_contacts_delete",
  CRM_LEADS_VIEW: "crm_leads_view",
  CRM_LEADS_CREATE: "crm_leads_create",
  CRM_LEADS_EDIT: "crm_leads_edit",
  CRM_LEADS_DELETE: "crm_leads_delete",
  CRM_COMMUNICATIONS_VIEW: "crm_communications_view",
  CRM_COMMUNICATIONS_CREATE: "crm_communications_create",
  CRM_COMMUNICATIONS_EDIT: "crm_communications_edit",
  CRM_COMMUNICATIONS_DELETE: "crm_communications_delete",
  CRM_POTENTIAL_PROJECTS_VIEW: "crm_potential_projects_view",
  CRM_POTENTIAL_PROJECTS_CREATE: "crm_potential_projects_create",
  CRM_POTENTIAL_PROJECTS_EDIT: "crm_potential_projects_edit",
  CRM_POTENTIAL_PROJECTS_REASSIGN: "crm_potential_projects_reassign",
  CRM_FOLLOW_UPS_VIEW: "crm_follow_ups_view",
  CRM_FOLLOW_UPS_CREATE: "crm_follow_ups_create",
  CRM_NEXT_ACTIONS_VIEW: "crm_next_actions_view",
  CRM_NEXT_ACTIONS_EDIT: "crm_next_actions_edit",
  CRM_DASHBOARD_VIEW: "crm_dashboard_view",
  // Sales Features
  SALES_CONTRACTS_VIEW: "sales_contracts_view",
  SALES_CONTRACTS_CREATE: "sales_contracts_create",
  SALES_CONTRACTS_EDIT: "sales_contracts_edit",
  SALES_CONTRACTS_DELETE: "sales_contracts_delete",
  SALES_CONTRACTS_CANCEL_AFTER_APPROVAL: "sales_contracts_cancel_after_approval",
  SALES_CONTRACTS_APPROVE: "sales_contracts_approve",
  SALES_CONTRACTS_REJECT: "sales_contracts_reject",
  SALES_CONTRACTS_SIGN: "sales_contracts_sign",
  SALES_CONTRACTS_PRINT: "sales_contracts_print",
  SALES_CONTRACT_ITEMS_CREATE: "sales_contract_items_create",
  SALES_DELIVERIES_VIEW: "sales_deliveries_view",
  SALES_DELIVERIES_CREATE: "sales_deliveries_create",
  SALES_PAYMENTS_VIEW: "sales_payments_view",
  SALES_PAYMENTS_CREATE: "sales_payments_create",
  SALES_VERIFICATION_SEND: "sales_verification_send",
  SALES_VERIFICATION_VERIFY: "sales_verification_verify",
  SALES_VERIFICATION_TIME: "sales_verification_time",
  SALES_DASHBOARD_VIEW: "sales_dashboard_view",
  SALES_CONTRACT_NUMBER_VIEW: "sales_contract_number_view",
  SALES_CONTRACT_TEMPLATES_VIEW: "sales_contract_templates_view",
  SALES_CONTRACT_TEMPLATES_CREATE: "sales_contract_templates_create",
  SALES_CONTRACT_TEMPLATES_EDIT: "sales_contract_templates_edit",
  SALES_CONTRACT_TEMPLATES_DELETE: "sales_contract_templates_delete",
  SALES_CONTRACT_TEMPLATES_GENERATE: "sales_contract_templates_generate",
  SALES_PRODUCTS_VIEW: "sales_products_view",
  SALES_PRODUCTS_CREATE: "sales_products_create",
  SALES_PRODUCTS_EDIT: "sales_products_edit",
  SALES_PRODUCTS_DELETE: "sales_products_delete",
  SALES_PRODUCTS_IMPORT: "sales_products_import",
  SALES_PRODUCTS_EXPORT: "sales_products_export",
  SALES_PRODUCTS_TEMPLATE: "sales_products_template",
  SALES_PRODUCTS_STATS: "sales_products_stats",
  SALES_PRODUCTS_ATTRIBUTES: "sales_products_attributes",
  SALES_CUSTOMERS_VIEW: "sales_customers_view",
  SALES_CUSTOMERS_CREATE: "sales_customers_create",
  SALES_CUSTOMERS_EDIT: "sales_customers_edit",
  SALES_CUSTOMERS_DELETE: "sales_customers_delete",
  SALES_CUSTOMERS_ASSIGN_OWNER: "sales_customers_assign_owner",
  SALES_LEGACY_CONTRACTS_VIEW: "sales_legacy_contracts_view",
  SALES_LEGACY_CONTRACTS_CREATE: "sales_legacy_contracts_create",
  SALES_LEGACY_CONTRACTS_EDIT: "sales_legacy_contracts_edit",
  SALES_LEGACY_CONTRACTS_DELETE: "sales_legacy_contracts_delete",
  SALES_LEGACY_CONTRACTS_APPROVE: "sales_legacy_contracts_approve",
  SALES_LEGACY_CONTRACTS_REJECT: "sales_legacy_contracts_reject",
  SALES_LEGACY_CONTRACTS_SIGN: "sales_legacy_contracts_sign",
  SALES_LEGACY_CONTRACTS_PRINT: "sales_legacy_contracts_print",
  SALES_PARTNER_INQUIRIES_VIEW: "sales_partner_inquiries_view",
  SALES_PARTNER_INQUIRIES_RESPOND: "sales_partner_inquiries_respond",
  SALES_PARTNER_SELLERS_MANAGE: "sales_partner_sellers_manage",
  // Inventory Features
  INVENTORY_CUT_TYPES_VIEW: "inventory_cut_types_view",
  INVENTORY_CUT_TYPES_CREATE: "inventory_cut_types_create",
  INVENTORY_CUT_TYPES_EDIT: "inventory_cut_types_edit",
  INVENTORY_CUT_TYPES_DELETE: "inventory_cut_types_delete",
  INVENTORY_STONE_MATERIALS_VIEW: "inventory_stone_materials_view",
  INVENTORY_STONE_MATERIALS_CREATE: "inventory_stone_materials_create",
  INVENTORY_STONE_MATERIALS_EDIT: "inventory_stone_materials_edit",
  INVENTORY_STONE_MATERIALS_DELETE: "inventory_stone_materials_delete",
  INVENTORY_CUT_WIDTHS_VIEW: "inventory_cut_widths_view",
  INVENTORY_CUT_WIDTHS_CREATE: "inventory_cut_widths_create",
  INVENTORY_CUT_WIDTHS_EDIT: "inventory_cut_widths_edit",
  INVENTORY_CUT_WIDTHS_DELETE: "inventory_cut_widths_delete",
  INVENTORY_THICKNESSES_VIEW: "inventory_thicknesses_view",
  INVENTORY_THICKNESSES_CREATE: "inventory_thicknesses_create",
  INVENTORY_THICKNESSES_EDIT: "inventory_thicknesses_edit",
  INVENTORY_THICKNESSES_DELETE: "inventory_thicknesses_delete",
  INVENTORY_MINES_VIEW: "inventory_mines_view",
  INVENTORY_MINES_CREATE: "inventory_mines_create",
  INVENTORY_MINES_EDIT: "inventory_mines_edit",
  INVENTORY_MINES_DELETE: "inventory_mines_delete",
  INVENTORY_FINISH_TYPES_VIEW: "inventory_finish_types_view",
  INVENTORY_FINISH_TYPES_CREATE: "inventory_finish_types_create",
  INVENTORY_FINISH_TYPES_EDIT: "inventory_finish_types_edit",
  INVENTORY_FINISH_TYPES_DELETE: "inventory_finish_types_delete",
  INVENTORY_COLORS_VIEW: "inventory_colors_view",
  INVENTORY_COLORS_CREATE: "inventory_colors_create",
  INVENTORY_COLORS_EDIT: "inventory_colors_edit",
  INVENTORY_COLORS_DELETE: "inventory_colors_delete",
  INVENTORY_SERVICES_VIEW: "inventory_services_view",
  INVENTORY_SERVICES_CREATE: "inventory_services_create",
  INVENTORY_SERVICES_EDIT: "inventory_services_edit",
  INVENTORY_SERVICES_DELETE: "inventory_services_delete",
  INVENTORY_SERVICES_TOGGLE: "inventory_services_toggle",
  INVENTORY_CUTTING_TYPES_VIEW: "inventory_cutting_types_view",
  INVENTORY_CUTTING_TYPES_CREATE: "inventory_cutting_types_create",
  INVENTORY_CUTTING_TYPES_EDIT: "inventory_cutting_types_edit",
  INVENTORY_CUTTING_TYPES_DELETE: "inventory_cutting_types_delete",
  INVENTORY_CUTTING_TYPES_TOGGLE: "inventory_cutting_types_toggle",
  INVENTORY_SUB_SERVICES_VIEW: "inventory_sub_services_view",
  INVENTORY_SUB_SERVICES_CREATE: "inventory_sub_services_create",
  INVENTORY_SUB_SERVICES_EDIT: "inventory_sub_services_edit",
  INVENTORY_SUB_SERVICES_DELETE: "inventory_sub_services_delete",
  INVENTORY_SUB_SERVICES_TOGGLE: "inventory_sub_services_toggle",
  INVENTORY_STAIR_STANDARD_LENGTHS_VIEW: "inventory_stair_standard_lengths_view",
  INVENTORY_STAIR_STANDARD_LENGTHS_CREATE: "inventory_stair_standard_lengths_create",
  INVENTORY_STAIR_STANDARD_LENGTHS_EDIT: "inventory_stair_standard_lengths_edit",
  INVENTORY_STAIR_STANDARD_LENGTHS_DELETE: "inventory_stair_standard_lengths_delete",
  INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE: "inventory_stair_standard_lengths_toggle",
  INVENTORY_LAYER_TYPES_VIEW: "inventory_layer_types_view",
  INVENTORY_LAYER_TYPES_CREATE: "inventory_layer_types_create",
  INVENTORY_LAYER_TYPES_EDIT: "inventory_layer_types_edit",
  INVENTORY_LAYER_TYPES_DELETE: "inventory_layer_types_delete",
  INVENTORY_LAYER_TYPES_TOGGLE: "inventory_layer_types_toggle",
  INVENTORY_STONE_FINISHINGS_VIEW: "inventory_stone_finishings_view",
  INVENTORY_STONE_FINISHINGS_CREATE: "inventory_stone_finishings_create",
  INVENTORY_STONE_FINISHINGS_EDIT: "inventory_stone_finishings_edit",
  INVENTORY_STONE_FINISHINGS_DELETE: "inventory_stone_finishings_delete",
  INVENTORY_STONE_FINISHINGS_TOGGLE: "inventory_stone_finishings_toggle",
  INVENTORY_COST_EVIDENCE_MANAGE: "inventory_cost_evidence_manage",
  // Accounting Features
  ACCOUNTING_DASHBOARD_VIEW: "accounting_dashboard_view",
  ACCOUNTING_CONTRACTS_VIEW: "accounting_contracts_view",
  ACCOUNTING_INVOICE_CANDIDATES_MANAGE: "accounting_invoice_candidates_manage",
  ACCOUNTING_RECEIVABLES_MANAGE: "accounting_receivables_manage",
  ACCOUNTING_PAYMENTS_MANAGE: "accounting_payments_manage",
  ACCOUNTING_TAX_MANAGE: "accounting_tax_manage",
  ACCOUNTING_CORRECTIONS_MANAGE: "accounting_corrections_manage",
  ACCOUNTING_CORRECTIONS_CREATE: "accounting_corrections_create",
  ACCOUNTING_CORRECTIONS_APPROVE: "accounting_corrections_approve",
  ACCOUNTING_CORRECTIONS_VERIFY: "accounting_corrections_verify",
  ACCOUNTING_AUDIT_VIEW: "accounting_audit_view",
  ACCOUNTING_RECORDS_APPROVE_VOID: "accounting_records_approve_void",
  ACCOUNTING_ACTIONS_MANAGE: "accounting_actions_manage",
  ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW: "accounting_biometric_diagnostics_view",
  ACCOUNTING_DISPATCH_CANDIDATES_VIEW: "accounting_dispatch_candidates_view",
  ACCOUNTING_DISPATCH_CANDIDATES_MANAGE: "accounting_dispatch_candidates_manage",
  ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE: "accounting_dispatch_confirmation_manage",
  ACCOUNTING_PARTNER_TERMS_MANAGE: "accounting_partner_terms_manage",
  ACCOUNTING_CUSTOMER_POSTING_MANAGE: "accounting_customer_posting_manage",
  ACCOUNTING_TREASURY_MANAGE: "accounting_treasury_manage",
  ACCOUNTING_EVIDENCE_MANAGE: "accounting_evidence_manage",
  ACCOUNTING_TAX_SUBMISSIONS_MANAGE: "accounting_tax_submissions_manage",
  ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT: "accounting_customer_statements_export",
  // BI Features
  BI_DASHBOARD_VIEW: "bi_dashboard_view",
  BI_PARTNER_REPORTS_VIEW: "bi_partner_reports_view",
  // Logistics Features
  LOGISTICS_DASHBOARD_VIEW: "logistics_dashboard_view",
  LOGISTICS_LOADINGS_VIEW: "logistics_loadings_view",
  LOGISTICS_LOADINGS_CREATE: "logistics_loadings_create",
  LOGISTICS_LOADINGS_EDIT: "logistics_loadings_edit",
  LOGISTICS_LOADINGS_FINALIZE: "logistics_loadings_finalize",
  LOGISTICS_LOADINGS_CANCEL: "logistics_loadings_cancel",
  LOGISTICS_CORRECTIONS_CREATE: "logistics_corrections_create",
  LOGISTICS_DRIVERS_VIEW: "logistics_drivers_view",
  LOGISTICS_DRIVERS_MANAGE: "logistics_drivers_manage",
  // HR-hosted Driver and Vehicle Operations Features
  HR_INTERNAL_DRIVERS_VIEW: "hr_internal_drivers_view",
  HR_INTERNAL_DRIVERS_MANAGE: "hr_internal_drivers_manage",
  HR_VEHICLE_OPERATIONS_VIEW: "hr_vehicle_operations_view",
  HR_VEHICLE_OPERATIONS_MANAGE: "hr_vehicle_operations_manage",
  HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE: "hr_internal_driver_eligibility_manage",
  HR_DRIVER_BIOMETRIC_AUDIT_VIEW: "hr_driver_biometric_audit_view",
  HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE: "hr_driver_biometric_enrollment_manage",
  HR_DRIVER_PROFILES_MANAGE: "hr_driver_profiles_manage",
  HR_COMPANY_VEHICLES_MANAGE: "hr_company_vehicles_manage",
  HR_VEHICLE_PLATES_MANAGE: "hr_vehicle_plates_manage",
  HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE: "hr_driver_vehicle_assignments_manage",
  HR_VEHICLE_OPERATIONS_AUDIT_VIEW: "hr_vehicle_operations_audit_view",
  // Human Resources Features
  HR_DASHBOARD_VIEW: "hr_dashboard_view",
  HR_ORGANIZATION_VIEW: "hr_organization_view",
  HR_ORGANIZATION_CREATE: "hr_organization_create",
  HR_ORGANIZATION_EDIT: "hr_organization_edit",
  HR_ORGANIZATION_ARCHIVE: "hr_organization_archive",
  HR_ORGANIZATION_DELETE: "hr_organization_delete",
  HR_PERSONNEL_VIEW: "hr_personnel_view",
  HR_PERSONNEL_EDIT: "hr_personnel_edit",
  HR_RECRUITMENT_VIEW: "hr_recruitment_view",
  HR_RECRUITMENT_EDIT: "hr_recruitment_edit",
  HR_ASSESSMENTS_EDIT: "hr_assessments_edit",
  HR_WORK_MANAGEMENT_VIEW: "hr_work_management_view",
  HR_WORK_MANAGEMENT_EDIT: "hr_work_management_edit",
  HR_PERMISSIONS_VIEW: "hr_permissions_view",
  HR_PERMISSIONS_EDIT: "hr_permissions_edit",
  HR_MIGRATION_VIEW: "hr_migration_view",
  HR_MIGRATION_EDIT: "hr_migration_edit",
  HR_USERS_VIEW: "hr_users_view",
  HR_USERS_CREATE: "hr_users_create",
  HR_USERS_EDIT: "hr_users_edit",
  HR_USERS_DELETE: "hr_users_delete",
  // Security Features
  SECURITY_SHIFTS_VIEW: "security_shifts_view",
  SECURITY_SHIFTS_CREATE: "security_shifts_create",
  SECURITY_SHIFTS_START: "security_shifts_start",
  SECURITY_SHIFTS_END: "security_shifts_end",
  SECURITY_ATTENDANCE_CHECKIN: "security_attendance_checkin",
  SECURITY_ATTENDANCE_CHECKOUT: "security_attendance_checkout",
  SECURITY_ATTENDANCE_EXCEPTION: "security_attendance_exception",
  SECURITY_ATTENDANCE_DAILY_VIEW: "security_attendance_daily_view",
  SECURITY_DASHBOARD_VIEW: "security_dashboard_view",
  SECURITY_PERSONNEL_VIEW: "security_personnel_view",
  SECURITY_PERSONNEL_ASSIGN: "security_personnel_assign",
  SECURITY_EXCEPTIONS_REQUEST: "security_exceptions_request",
  SECURITY_EXCEPTIONS_VIEW: "security_exceptions_view",
  SECURITY_EXCEPTIONS_APPROVE: "security_exceptions_approve",
  SECURITY_EXCEPTIONS_REJECT: "security_exceptions_reject",
  SECURITY_MISSIONS_ASSIGN: "security_missions_assign",
  SECURITY_MISSIONS_VIEW: "security_missions_view",
  SECURITY_MISSIONS_APPROVE: "security_missions_approve",
  SECURITY_SIGNATURE_UPDATE: "security_signature_update",
  SECURITY_SIGNATURE_VIEW: "security_signature_view",
  SECURITY_SIGNATURE_VALIDATE: "security_signature_validate",
  SECURITY_EXTERNAL_DRIVERS_VIEW: "security_external_drivers_view",
  SECURITY_EXTERNAL_DRIVERS_MANAGE: "security_external_drivers_manage",
  SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE: "security_external_driver_vehicle_manage",
  SECURITY_DISPATCH_EVIDENCE_VIEW: "security_dispatch_evidence_view",
  SECURITY_DISPATCH_CONFIRMATION_APPROVE: "security_dispatch_confirmation_approve",
  SUPPORT_SECURITY_INCIDENT_HANDLE: "support_security_incident_handle"
};
var permissionLevels = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT,
  FEATURE_PERMISSIONS.ADMIN
];
var FEATURE_WORKSPACE_MAP = {
  // Core/Admin Features
  [FEATURES.CORE_DASHBOARD_STATS_VIEW]: "sales",
  [FEATURES.CORE_DASHBOARD_PROFILE_VIEW]: "sales",
  [FEATURES.CORE_DEPARTMENTS_VIEW]: "sales",
  [FEATURES.CORE_DEPARTMENTS_CREATE]: "sales",
  [FEATURES.CORE_DEPARTMENTS_EDIT]: "sales",
  [FEATURES.CORE_DEPARTMENTS_DELETE]: "sales",
  [FEATURES.CORE_POSTS_VIEW]: "sales",
  [FEATURES.CORE_POSTS_CREATE]: "sales",
  [FEATURES.CORE_POSTS_EDIT]: "sales",
  [FEATURES.CORE_POSTS_DELETE]: "sales",
  [FEATURES.CORE_ORDERS_VIEW]: "sales",
  [FEATURES.CORE_ORDERS_CREATE]: "sales",
  [FEATURES.CORE_ORDERS_EDIT]: "sales",
  [FEATURES.CORE_ORDERS_DELETE]: "sales",
  [FEATURES.CORE_ORDERS_UPDATE_STATUS]: "sales",
  // CRM Features
  [FEATURES.CRM_CUSTOMERS_VIEW]: "crm",
  [FEATURES.CRM_CUSTOMERS_VIEW_ALL]: "crm",
  [FEATURES.CRM_CUSTOMERS_CREATE]: "crm",
  [FEATURES.CRM_CUSTOMERS_EDIT]: "crm",
  [FEATURES.CRM_CUSTOMERS_DELETE]: "crm",
  [FEATURES.CRM_CUSTOMERS_BLACKLIST]: "crm",
  [FEATURES.CRM_CUSTOMERS_LOCK]: "crm",
  [FEATURES.CRM_CUSTOMERS_ASSIGN_OWNER]: "crm",
  [FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_CREATE]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_EDIT]: "crm",
  [FEATURES.CRM_PROJECT_ADDRESSES_DELETE]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_CREATE]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_EDIT]: "crm",
  [FEATURES.CRM_PHONE_NUMBERS_DELETE]: "crm",
  [FEATURES.CRM_CONTACTS_VIEW]: "crm",
  [FEATURES.CRM_CONTACTS_CREATE]: "crm",
  [FEATURES.CRM_CONTACTS_EDIT]: "crm",
  [FEATURES.CRM_CONTACTS_DELETE]: "crm",
  [FEATURES.CRM_LEADS_VIEW]: "crm",
  [FEATURES.CRM_LEADS_CREATE]: "crm",
  [FEATURES.CRM_LEADS_EDIT]: "crm",
  [FEATURES.CRM_LEADS_DELETE]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_VIEW]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_CREATE]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_EDIT]: "crm",
  [FEATURES.CRM_COMMUNICATIONS_DELETE]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_VIEW]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_CREATE]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_EDIT]: "crm",
  [FEATURES.CRM_POTENTIAL_PROJECTS_REASSIGN]: "crm",
  [FEATURES.CRM_FOLLOW_UPS_VIEW]: "crm",
  [FEATURES.CRM_FOLLOW_UPS_CREATE]: "crm",
  [FEATURES.CRM_NEXT_ACTIONS_VIEW]: "crm",
  [FEATURES.CRM_NEXT_ACTIONS_EDIT]: "crm",
  [FEATURES.CRM_DASHBOARD_VIEW]: "crm",
  // Sales Features
  [FEATURES.SALES_CONTRACTS_VIEW]: "sales",
  [FEATURES.SALES_CONTRACTS_CREATE]: "sales",
  [FEATURES.SALES_CONTRACTS_EDIT]: "sales",
  [FEATURES.SALES_CONTRACTS_DELETE]: "sales",
  [FEATURES.SALES_CONTRACTS_CANCEL_AFTER_APPROVAL]: "sales",
  [FEATURES.SALES_CONTRACTS_APPROVE]: "sales",
  [FEATURES.SALES_CONTRACTS_REJECT]: "sales",
  [FEATURES.SALES_CONTRACTS_SIGN]: "sales",
  [FEATURES.SALES_CONTRACTS_PRINT]: "sales",
  [FEATURES.SALES_CONTRACT_ITEMS_CREATE]: "sales",
  [FEATURES.SALES_DELIVERIES_VIEW]: "sales",
  [FEATURES.SALES_DELIVERIES_CREATE]: "sales",
  [FEATURES.SALES_PAYMENTS_VIEW]: "sales",
  [FEATURES.SALES_PAYMENTS_CREATE]: "sales",
  [FEATURES.SALES_VERIFICATION_SEND]: "sales",
  [FEATURES.SALES_VERIFICATION_VERIFY]: "sales",
  [FEATURES.SALES_VERIFICATION_TIME]: "sales",
  [FEATURES.SALES_DASHBOARD_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_NUMBER_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_VIEW]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_CREATE]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_EDIT]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_DELETE]: "sales",
  [FEATURES.SALES_CONTRACT_TEMPLATES_GENERATE]: "sales",
  [FEATURES.SALES_PRODUCTS_VIEW]: "sales",
  [FEATURES.SALES_PRODUCTS_CREATE]: "sales",
  [FEATURES.SALES_PRODUCTS_EDIT]: "sales",
  [FEATURES.SALES_PRODUCTS_DELETE]: "sales",
  [FEATURES.SALES_PRODUCTS_IMPORT]: "sales",
  [FEATURES.SALES_PRODUCTS_EXPORT]: "sales",
  [FEATURES.SALES_PRODUCTS_TEMPLATE]: "sales",
  [FEATURES.SALES_PRODUCTS_STATS]: "sales",
  [FEATURES.SALES_PRODUCTS_ATTRIBUTES]: "sales",
  [FEATURES.SALES_CUSTOMERS_VIEW]: "sales",
  [FEATURES.SALES_CUSTOMERS_CREATE]: "sales",
  [FEATURES.SALES_CUSTOMERS_EDIT]: "sales",
  [FEATURES.SALES_CUSTOMERS_DELETE]: "sales",
  [FEATURES.SALES_CUSTOMERS_ASSIGN_OWNER]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_VIEW]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_CREATE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_EDIT]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_DELETE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_APPROVE]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_REJECT]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_SIGN]: "sales",
  [FEATURES.SALES_LEGACY_CONTRACTS_PRINT]: "sales",
  [FEATURES.SALES_PARTNER_INQUIRIES_VIEW]: "sales",
  [FEATURES.SALES_PARTNER_INQUIRIES_RESPOND]: "sales",
  [FEATURES.SALES_PARTNER_SELLERS_MANAGE]: "sales",
  // Inventory Features
  [FEATURES.INVENTORY_CUT_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUT_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STONE_MATERIALS_DELETE]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUT_WIDTHS_DELETE]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_VIEW]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_CREATE]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_EDIT]: "inventory",
  [FEATURES.INVENTORY_THICKNESSES_DELETE]: "inventory",
  [FEATURES.INVENTORY_MINES_VIEW]: "inventory",
  [FEATURES.INVENTORY_MINES_CREATE]: "inventory",
  [FEATURES.INVENTORY_MINES_EDIT]: "inventory",
  [FEATURES.INVENTORY_MINES_DELETE]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_FINISH_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_COLORS_VIEW]: "inventory",
  [FEATURES.INVENTORY_COLORS_CREATE]: "inventory",
  [FEATURES.INVENTORY_COLORS_EDIT]: "inventory",
  [FEATURES.INVENTORY_COLORS_DELETE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_VIEW]: "inventory",
  [FEATURES.INVENTORY_SERVICES_CREATE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_EDIT]: "inventory",
  [FEATURES.INVENTORY_SERVICES_DELETE]: "inventory",
  [FEATURES.INVENTORY_SERVICES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_CUTTING_TYPES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_VIEW]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_CREATE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_EDIT]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_DELETE]: "inventory",
  [FEATURES.INVENTORY_SUB_SERVICES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_DELETE]: "inventory",
  [FEATURES.INVENTORY_STAIR_STANDARD_LENGTHS_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_VIEW]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_CREATE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_EDIT]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_DELETE]: "inventory",
  [FEATURES.INVENTORY_LAYER_TYPES_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_VIEW]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_CREATE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_EDIT]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_DELETE]: "inventory",
  [FEATURES.INVENTORY_STONE_FINISHINGS_TOGGLE]: "inventory",
  [FEATURES.INVENTORY_COST_EVIDENCE_MANAGE]: "inventory",
  // Accounting Features
  [FEATURES.ACCOUNTING_DASHBOARD_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_CONTRACTS_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_RECEIVABLES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_PAYMENTS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TAX_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_CREATE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_APPROVE]: "accounting",
  [FEATURES.ACCOUNTING_CORRECTIONS_VERIFY]: "accounting",
  [FEATURES.ACCOUNTING_AUDIT_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID]: "accounting",
  [FEATURES.ACCOUNTING_ACTIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_DISPATCH_CONFIRMATION_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CUSTOMER_POSTING_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TREASURY_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_EVIDENCE_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_TAX_SUBMISSIONS_MANAGE]: "accounting",
  [FEATURES.ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT]: "accounting",
  // BI Features
  [FEATURES.BI_DASHBOARD_VIEW]: "bi",
  [FEATURES.BI_PARTNER_REPORTS_VIEW]: "bi",
  // Logistics Features
  [FEATURES.LOGISTICS_DASHBOARD_VIEW]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_VIEW]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_CREATE]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_EDIT]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_FINALIZE]: "logistics",
  [FEATURES.LOGISTICS_LOADINGS_CANCEL]: "logistics",
  [FEATURES.LOGISTICS_CORRECTIONS_CREATE]: "logistics",
  [FEATURES.LOGISTICS_DRIVERS_VIEW]: "logistics",
  [FEATURES.LOGISTICS_DRIVERS_MANAGE]: "logistics",
  [FEATURES.HR_INTERNAL_DRIVERS_VIEW]: "hr",
  [FEATURES.HR_INTERNAL_DRIVERS_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_VIEW]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_MANAGE]: "hr",
  [FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_BIOMETRIC_AUDIT_VIEW]: "hr",
  [FEATURES.HR_DRIVER_BIOMETRIC_ENROLLMENT_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_PROFILES_MANAGE]: "hr",
  [FEATURES.HR_COMPANY_VEHICLES_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_PLATES_MANAGE]: "hr",
  [FEATURES.HR_DRIVER_VEHICLE_ASSIGNMENTS_MANAGE]: "hr",
  [FEATURES.HR_VEHICLE_OPERATIONS_AUDIT_VIEW]: "hr",
  // Human Resources Features
  [FEATURES.HR_DASHBOARD_VIEW]: "hr",
  [FEATURES.HR_ORGANIZATION_VIEW]: "hr",
  [FEATURES.HR_ORGANIZATION_CREATE]: "hr",
  [FEATURES.HR_ORGANIZATION_EDIT]: "hr",
  [FEATURES.HR_ORGANIZATION_ARCHIVE]: "hr",
  [FEATURES.HR_ORGANIZATION_DELETE]: "hr",
  [FEATURES.HR_PERSONNEL_VIEW]: "hr",
  [FEATURES.HR_PERSONNEL_EDIT]: "hr",
  [FEATURES.HR_RECRUITMENT_VIEW]: "hr",
  [FEATURES.HR_RECRUITMENT_EDIT]: "hr",
  [FEATURES.HR_ASSESSMENTS_EDIT]: "hr",
  [FEATURES.HR_WORK_MANAGEMENT_VIEW]: "hr",
  [FEATURES.HR_WORK_MANAGEMENT_EDIT]: "hr",
  [FEATURES.HR_PERMISSIONS_VIEW]: "hr",
  [FEATURES.HR_PERMISSIONS_EDIT]: "hr",
  [FEATURES.HR_MIGRATION_VIEW]: "hr",
  [FEATURES.HR_MIGRATION_EDIT]: "hr",
  [FEATURES.HR_USERS_VIEW]: "hr",
  [FEATURES.HR_USERS_CREATE]: "hr",
  [FEATURES.HR_USERS_EDIT]: "hr",
  [FEATURES.HR_USERS_DELETE]: "hr",
  // Security Features
  [FEATURES.SECURITY_SHIFTS_VIEW]: "security",
  [FEATURES.SECURITY_SHIFTS_CREATE]: "security",
  [FEATURES.SECURITY_SHIFTS_START]: "security",
  [FEATURES.SECURITY_SHIFTS_END]: "security",
  [FEATURES.SECURITY_ATTENDANCE_CHECKIN]: "security",
  [FEATURES.SECURITY_ATTENDANCE_CHECKOUT]: "security",
  [FEATURES.SECURITY_ATTENDANCE_EXCEPTION]: "security",
  [FEATURES.SECURITY_ATTENDANCE_DAILY_VIEW]: "security",
  [FEATURES.SECURITY_DASHBOARD_VIEW]: "security",
  [FEATURES.SECURITY_PERSONNEL_VIEW]: "security",
  [FEATURES.SECURITY_PERSONNEL_ASSIGN]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_REQUEST]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_VIEW]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_APPROVE]: "security",
  [FEATURES.SECURITY_EXCEPTIONS_REJECT]: "security",
  [FEATURES.SECURITY_MISSIONS_ASSIGN]: "security",
  [FEATURES.SECURITY_MISSIONS_VIEW]: "security",
  [FEATURES.SECURITY_MISSIONS_APPROVE]: "security",
  [FEATURES.SECURITY_SIGNATURE_UPDATE]: "security",
  [FEATURES.SECURITY_SIGNATURE_VIEW]: "security",
  [FEATURES.SECURITY_SIGNATURE_VALIDATE]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVERS_MANAGE]: "security",
  [FEATURES.SECURITY_EXTERNAL_DRIVER_VEHICLE_MANAGE]: "security",
  [FEATURES.SECURITY_DISPATCH_EVIDENCE_VIEW]: "security",
  [FEATURES.SECURITY_DISPATCH_CONFIRMATION_APPROVE]: "security",
  [FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE]: "security"
};
var FEATURE_SUBJECT_LABELS_FA = {
  core_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0633\u0627\u0645\u0627\u0646\u0647",
  core_departments: "\u0628\u062E\u0634\u200C\u0647\u0627",
  core_posts: "\u0633\u0645\u062A\u200C\u0647\u0627",
  core_orders: "\u0633\u0641\u0627\u0631\u0634\u200C\u0647\u0627",
  crm_customers: "\u0645\u0634\u062A\u0631\u06CC\u0627\u0646",
  crm_project_addresses: "\u0646\u0634\u0627\u0646\u06CC\u200C\u0647\u0627\u06CC \u067E\u0631\u0648\u0698\u0647",
  crm_phone_numbers: "\u0634\u0645\u0627\u0631\u0647\u200C\u0647\u0627\u06CC \u062A\u0645\u0627\u0633",
  crm_contacts: "\u0645\u062E\u0627\u0637\u0628\u0627\u0646",
  crm_leads: "\u0633\u0631\u0646\u062E\u200C\u0647\u0627",
  crm_communications: "\u0627\u0631\u062A\u0628\u0627\u0637\u0627\u062A \u0645\u0634\u062A\u0631\u06CC",
  crm_potential_projects: "\u067E\u0631\u0648\u0698\u0647\u200C\u0647\u0627\u06CC \u0627\u062D\u062A\u0645\u0627\u0644\u06CC",
  crm_follow_ups: "\u067E\u06CC\u06AF\u06CC\u0631\u06CC\u200C\u0647\u0627",
  crm_next_actions: "\u0627\u0642\u062F\u0627\u0645\u200C\u0647\u0627\u06CC \u0628\u0639\u062F\u06CC",
  crm_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0627\u0631\u062A\u0628\u0627\u0637 \u0628\u0627 \u0645\u0634\u062A\u0631\u06CC",
  sales_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_contract_items: "\u0627\u0642\u0644\u0627\u0645 \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u0641\u0631\u0648\u0634",
  sales_deliveries: "\u062A\u062D\u0648\u06CC\u0644\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_payments: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634",
  sales_verification: "\u062A\u0623\u06CC\u06CC\u062F \u0641\u0631\u0648\u0634",
  sales_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0641\u0631\u0648\u0634",
  sales_contract_number: "\u0634\u0645\u0627\u0631\u0647 \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u0641\u0631\u0648\u0634",
  sales_contract_templates: "\u0627\u0644\u06AF\u0648\u0647\u0627\u06CC \u0642\u0631\u0627\u0631\u062F\u0627\u062F",
  sales_products: "\u0645\u062D\u0635\u0648\u0644\u0627\u062A \u0641\u0631\u0648\u0634",
  sales_customers: "\u0645\u0634\u062A\u0631\u06CC\u0627\u0646 \u0641\u0631\u0648\u0634",
  sales_legacy_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u0642\u062F\u06CC\u0645\u06CC",
  sales_partner_inquiries: "\u0627\u0633\u062A\u0639\u0644\u0627\u0645\u200C\u0647\u0627\u06CC \u0647\u0645\u06A9\u0627\u0631",
  sales_partner_sellers: "\u0641\u0631\u0648\u0634\u0646\u062F\u06AF\u0627\u0646 \u0648 \u067E\u0627\u0633\u062E\u200C\u062F\u0647\u0646\u062F\u06AF\u0627\u0646 \u0647\u0645\u06A9\u0627\u0631",
  inventory_cut_types: "\u0627\u0646\u0648\u0627\u0639 \u0628\u0631\u0634",
  inventory_stone_materials: "\u062C\u0646\u0633\u200C\u0647\u0627\u06CC \u0633\u0646\u06AF",
  inventory_cut_widths: "\u0639\u0631\u0636\u200C\u0647\u0627\u06CC \u0628\u0631\u0634",
  inventory_thicknesses: "\u0636\u062E\u0627\u0645\u062A\u200C\u0647\u0627",
  inventory_mines: "\u0645\u0639\u0627\u062F\u0646",
  inventory_finish_types: "\u0627\u0646\u0648\u0627\u0639 \u067E\u0631\u062F\u0627\u062E\u062A",
  inventory_colors: "\u0631\u0646\u06AF\u200C\u0647\u0627",
  inventory_services: "\u062E\u062F\u0645\u0627\u062A \u0627\u0646\u0628\u0627\u0631",
  inventory_cutting_types: "\u0631\u0648\u0634\u200C\u0647\u0627\u06CC \u0628\u0631\u0634",
  inventory_sub_services: "\u0632\u06CC\u0631\u062E\u062F\u0645\u062A\u200C\u0647\u0627",
  inventory_stair_standard_lengths: "\u0637\u0648\u0644\u200C\u0647\u0627\u06CC \u0627\u0633\u062A\u0627\u0646\u062F\u0627\u0631\u062F \u067E\u0644\u0647",
  inventory_layer_types: "\u0627\u0646\u0648\u0627\u0639 \u0644\u0627\u06CC\u0647",
  inventory_stone_finishings: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627\u06CC \u0633\u0646\u06AF",
  inventory_cost_evidence: "\u0634\u0648\u0627\u0647\u062F \u0628\u0647\u0627\u06CC \u0645\u0648\u062C\u0648\u062F\u06CC",
  accounting_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_contracts: "\u0642\u0631\u0627\u0631\u062F\u0627\u062F\u0647\u0627\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_invoice_candidates: "\u06AF\u0632\u06CC\u0646\u0647\u200C\u0647\u0627\u06CC \u0635\u062F\u0648\u0631 \u0635\u0648\u0631\u062A\u200C\u062D\u0633\u0627\u0628",
  accounting_receivables: "\u062F\u0631\u06CC\u0627\u0641\u062A\u0646\u06CC\u200C\u0647\u0627",
  accounting_payments: "\u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0647\u0627",
  accounting_tax: "\u0645\u0627\u0644\u06CC\u0627\u062A",
  accounting_corrections: "\u0627\u0635\u0644\u0627\u062D\u0627\u062A \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_audit: "\u0645\u0645\u06CC\u0632\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_records: "\u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_actions: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_biometric_diagnostics: "\u0639\u06CC\u0628\u200C\u06CC\u0627\u0628\u06CC \u0627\u062A\u0635\u0627\u0644 \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_dispatch_candidates: "\u06AF\u0632\u06CC\u0646\u0647\u200C\u0647\u0627\u06CC \u0627\u0631\u0633\u0627\u0644 \u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_dispatch_confirmation: "\u062A\u0623\u06CC\u06CC\u062F \u0627\u0631\u0633\u0627\u0644 \u0627\u0633\u0646\u0627\u062F \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_partner_terms: "\u0634\u0631\u0627\u06CC\u0637 \u062A\u062C\u0627\u0631\u06CC \u0648 \u0627\u0639\u062A\u0628\u0627\u0631 \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
  accounting_customer_posting: "\u062B\u0628\u062A \u0641\u0631\u0648\u0634 \u0648 \u062F\u0631\u06CC\u0627\u0641\u062A\u0646\u06CC \u0645\u0634\u062A\u0631\u06CC",
  accounting_treasury: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0632\u0627\u0646\u0647\u200C\u062F\u0627\u0631\u06CC",
  accounting_evidence: "\u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06CC\u0627\u062A\u06CC \u062D\u0633\u0627\u0628\u062F\u0627\u0631\u06CC",
  accounting_tax_submissions: "\u0627\u0631\u0633\u0627\u0644 \u0635\u0648\u0631\u062A\u062D\u0633\u0627\u0628 \u0645\u0627\u0644\u06CC\u0627\u062A\u06CC",
  accounting_customer_statements: "\u0635\u0648\u0631\u062A\u062D\u0633\u0627\u0628 \u0645\u0634\u062A\u0631\u06CC",
  bi_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0647\u0648\u0634 \u062A\u062C\u0627\u0631\u06CC",
  bi_partner_reports: "\u06AF\u0632\u0627\u0631\u0634\u200C\u0647\u0627 \u0648 \u062D\u0633\u0627\u0628\u200C\u0647\u0627\u06CC \u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
  logistics_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0644\u062C\u0633\u062A\u06CC\u06A9",
  logistics_loadings: "\u0628\u0627\u0631\u06AF\u06CC\u0631\u06CC\u200C\u0647\u0627",
  logistics_corrections: "\u0627\u0635\u0644\u0627\u062D\u0627\u062A \u0644\u062C\u0633\u062A\u06CC\u06A9",
  logistics_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u0644\u062C\u0633\u062A\u06CC\u06A9",
  hr_internal_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_vehicle_operations: "\u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_internal_driver_eligibility: "\u0635\u0644\u0627\u062D\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_driver_biometric_audit: "\u0645\u0645\u06CC\u0632\u06CC \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_driver_biometric_enrollment: "\u062B\u0628\u062A \u0632\u06CC\u0633\u062A\u200C\u0633\u0646\u062C\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_driver_profiles: "\u0646\u0645\u0627\u06CC\u0647\u200C\u0647\u0627\u06CC \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_company_vehicles: "\u062E\u0648\u062F\u0631\u0648\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
  hr_vehicle_plates: "\u067E\u0644\u0627\u06A9 \u062E\u0648\u062F\u0631\u0648\u0647\u0627",
  hr_driver_vehicle_assignments: "\u062A\u062E\u0635\u06CC\u0635 \u0631\u0627\u0646\u0646\u062F\u0647 \u0648 \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_audit: "\u0645\u0645\u06CC\u0632\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC",
  hr_organization: "\u0633\u0627\u062E\u062A\u0627\u0631 \u0633\u0627\u0632\u0645\u0627\u0646\u06CC",
  hr_personnel: "\u067E\u0631\u0633\u0646\u0644",
  hr_recruitment: "\u067E\u0631\u0648\u0646\u062F\u0647\u200C\u0647\u0627\u06CC \u062C\u0630\u0628",
  hr_assessments: "\u0645\u0635\u0627\u062D\u0628\u0647 \u0648 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645",
  hr_work_management: "\u0648\u0638\u0627\u06CC\u0641 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC",
  hr_permissions: "\u0627\u062E\u062A\u06CC\u0627\u0631 \u0648 \u0645\u0633\u0626\u0648\u0644\u06CC\u062A",
  hr_migration: "\u0645\u0647\u0627\u062C\u0631\u062A \u0648 \u062A\u0637\u0628\u06CC\u0642",
  hr_users: "\u06A9\u0627\u0631\u0628\u0631\u0627\u0646",
  security_shifts: "\u0634\u06CC\u0641\u062A\u200C\u0647\u0627\u06CC \u0627\u0645\u0646\u06CC\u062A",
  security_attendance: "\u062D\u0636\u0648\u0631 \u0648 \u063A\u06CC\u0627\u0628 \u0627\u0645\u0646\u06CC\u062A",
  security_dashboard: "\u062F\u0627\u0634\u0628\u0648\u0631\u062F \u0627\u0645\u0646\u06CC\u062A",
  security_personnel: "\u067E\u0631\u0633\u0646\u0644 \u0627\u0645\u0646\u06CC\u062A",
  security_exceptions: "\u0627\u0633\u062A\u062B\u0646\u0627\u0647\u0627\u06CC \u062D\u0636\u0648\u0631",
  security_missions: "\u0645\u0623\u0645\u0648\u0631\u06CC\u062A\u200C\u0647\u0627",
  security_signature: "\u0627\u0645\u0636\u0627",
  security_external_drivers: "\u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u0628\u06CC\u0631\u0648\u0646\u06CC",
  security_external_driver_vehicle: "\u062E\u0648\u062F\u0631\u0648\u06CC \u0631\u0627\u0646\u0646\u062F\u0647 \u0628\u06CC\u0631\u0648\u0646\u06CC",
  security_dispatch_evidence: "\u0634\u0648\u0627\u0647\u062F \u0627\u0631\u0633\u0627\u0644",
  security_dispatch_confirmation: "\u062A\u0623\u06CC\u06CC\u062F \u0627\u0631\u0633\u0627\u0644",
  support_security_incident: "\u0631\u062E\u062F\u0627\u062F \u0627\u0645\u0646\u06CC\u062A\u06CC \u067E\u0634\u062A\u06CC\u0628\u0627\u0646\u06CC"
};
var FEATURE_ACTION_LABELS_FA = [
  ["cancel_after_approval", "\u0644\u063A\u0648 \u067E\u0633 \u0627\u0632 \u062A\u0623\u06CC\u06CC\u062F"],
  ["stats_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0622\u0645\u0627\u0631"],
  ["profile_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0645\u0627\u06CC\u0647"],
  ["daily_view", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0631\u0648\u0632\u0627\u0646\u0647"],
  ["assign_owner", "\u062A\u062E\u0635\u06CC\u0635 \u0645\u0633\u0626\u0648\u0644"],
  ["update_status", "\u062A\u063A\u06CC\u06CC\u0631 \u0648\u0636\u0639\u06CC\u062A"],
  ["approve_void", "\u062A\u0623\u06CC\u06CC\u062F \u06CC\u0627 \u0627\u0628\u0637\u0627\u0644"],
  ["checkin", "\u062B\u0628\u062A \u0648\u0631\u0648\u062F"],
  ["checkout", "\u062B\u0628\u062A \u062E\u0631\u0648\u062C"],
  ["blacklist", "\u0627\u0641\u0632\u0648\u062F\u0646 \u0628\u0647 \u0641\u0647\u0631\u0633\u062A \u0645\u0633\u062F\u0648\u062F"],
  ["reassign", "\u062A\u062E\u0635\u06CC\u0635 \u062F\u0648\u0628\u0627\u0631\u0647"],
  ["attributes", "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648\u06CC\u0698\u06AF\u06CC\u200C\u0647\u0627\u06CC"],
  ["template", "\u062F\u0631\u06CC\u0627\u0641\u062A \u0627\u0644\u06AF\u0648\u06CC"],
  ["stats", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0622\u0645\u0627\u0631"],
  ["create", "\u0627\u06CC\u062C\u0627\u062F"],
  ["delete", "\u062D\u0630\u0641"],
  ["edit", "\u0648\u06CC\u0631\u0627\u06CC\u0634"],
  ["view", "\u0645\u0634\u0627\u0647\u062F\u0647"],
  ["manage", "\u0645\u062F\u06CC\u0631\u06CC\u062A"],
  ["approve", "\u062A\u0623\u06CC\u06CC\u062F"],
  ["reject", "\u0631\u062F"],
  ["sign", "\u0627\u0645\u0636\u0627\u06CC"],
  ["print", "\u0686\u0627\u067E"],
  ["send", "\u0627\u0631\u0633\u0627\u0644 \u06A9\u062F"],
  ["verify", "\u0628\u0631\u0631\u0633\u06CC \u06A9\u062F"],
  ["time", "\u0645\u0634\u0627\u0647\u062F\u0647 \u0632\u0645\u0627\u0646 \u0627\u0639\u062A\u0628\u0627\u0631"],
  ["generate", "\u062A\u0648\u0644\u06CC\u062F"],
  ["import", "\u062F\u0631\u0648\u0646\u200C\u0631\u06CC\u0632\u06CC"],
  ["export", "\u0628\u0631\u0648\u0646\u200C\u0631\u06CC\u0632\u06CC"],
  ["toggle", "\u0641\u0639\u0627\u0644 \u06CC\u0627 \u063A\u06CC\u0631\u0641\u0639\u0627\u0644\u200C\u06A9\u0631\u062F\u0646"],
  ["finalize", "\u0646\u0647\u0627\u06CC\u06CC\u200C\u06A9\u0631\u062F\u0646"],
  ["cancel", "\u0644\u063A\u0648"],
  ["archive", "\u0628\u0627\u06CC\u06AF\u0627\u0646\u06CC"],
  ["start", "\u0634\u0631\u0648\u0639"],
  ["end", "\u067E\u0627\u06CC\u0627\u0646"],
  ["exception", "\u062B\u0628\u062A \u0627\u0633\u062A\u062B\u0646\u0627\u06CC"],
  ["request", "\u062F\u0631\u062E\u0648\u0627\u0633\u062A"],
  ["respond", "\u067E\u0627\u0633\u062E\u200C\u06AF\u0648\u06CC\u06CC \u0628\u0647"],
  ["assign", "\u062A\u062E\u0635\u06CC\u0635"],
  ["update", "\u0628\u0647\u200C\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06CC"],
  ["validate", "\u0627\u0639\u062A\u0628\u0627\u0631\u0633\u0646\u062C\u06CC"],
  ["lock", "\u0642\u0641\u0644\u200C\u06A9\u0631\u062F\u0646"],
  ["handle", "\u0631\u0633\u06CC\u062F\u06AF\u06CC \u0628\u0647"]
];
var featureLabelFa = (feature) => {
  if (feature === FEATURES.CRM_CUSTOMERS_VIEW_ALL) return "\u0645\u0634\u0627\u0647\u062F\u0647 \u0647\u0645\u0647 \u0645\u0634\u062A\u0631\u06CC\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC \u0648 \u0647\u0645\u06A9\u0627\u0631";
  if (feature === FEATURES.CRM_CUSTOMERS_DELETE) return "\u062D\u0630\u0641 \u062F\u0627\u0626\u0645\u06CC \u0645\u0634\u062A\u0631\u06CC \u0628\u062F\u0648\u0646 \u0633\u0627\u0628\u0642\u0647";
  const action = FEATURE_ACTION_LABELS_FA.find(([suffix2]) => feature.endsWith(`_${suffix2}`));
  if (!action) throw new Error(`Missing Persian action label for feature: ${feature}`);
  const [suffix, actionLabel] = action;
  const subjectKey = feature.slice(0, -(suffix.length + 1));
  const subjectLabel = FEATURE_SUBJECT_LABELS_FA[subjectKey];
  if (!subjectLabel) throw new Error(`Missing Persian subject label for feature: ${feature}`);
  return `${actionLabel} ${subjectLabel}`;
};
var FEATURE_LABELS = Object.fromEntries(
  Object.values(FEATURES).map((feature) => [feature, feature === FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE ? "\u0628\u0631\u0631\u0633\u06CC \u0648 \u062A\u0635\u0645\u06CC\u0645 \u0627\u0646\u062A\u0642\u0627\u0644 \u0645\u0634\u062A\u0631\u06CC \u0628\u0647 \u0647\u0645\u06A9\u0627\u0631" : featureLabelFa(feature)])
);

// src/services/hrActionPermissionCatalog.ts
var LEGACY_PERFORMANCE_ACTION_PERMISSIONS = [
  { code: "REQUEST_PERFORMANCE_PRIVACY_CASE", labelFa: "\u062B\u0628\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_PRIVACY_CASE", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "ACKNOWLEDGE_PERFORMANCE_PRIVACY_CASE", labelFa: "\u0627\u0639\u0644\u0627\u0645 \u062F\u0631\u06CC\u0627\u0641\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "VERIFY_PERFORMANCE_PRIVACY_IDENTITY", labelFa: "\u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_PRIVACY_ACCESS", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u062F\u0633\u062A\u0631\u0633\u06CC \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "REGISTER_PERFORMANCE_CORRECTION", labelFa: "\u062B\u0628\u062A \u0627\u0635\u0644\u0627\u062D \u0646\u0633\u062E\u0647\u200C\u062F\u0627\u0631 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_PRIVACY_CORRECTION", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u0627\u0635\u0644\u0627\u062D \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "DECIDE_PERFORMANCE_ERASURE", labelFa: "\u062A\u0635\u0645\u06CC\u0645 \u062D\u0630\u0641 \u0645\u062C\u0627\u0632 \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RESTRICT_PERFORMANCE_EVIDENCE", labelFa: "\u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RELEASE_PERFORMANCE_RESTRICTION", labelFa: "\u0631\u0641\u0639 \u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "PLACE_PERFORMANCE_LEGAL_HOLD", labelFa: "\u0627\u06CC\u062C\u0627\u062F \u062A\u0648\u0642\u0641 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RELEASE_PERFORMANCE_LEGAL_HOLD", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_POLICY", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648 \u0627\u0646\u062A\u0634\u0627\u0631 \u0633\u06CC\u0627\u0633\u062A \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_CYCLE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0686\u0631\u062E\u0647 \u0648 \u0645\u0647\u0644\u062A \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "SUBMIT_PERFORMANCE_EVALUATION", labelFa: "\u0627\u0631\u0633\u0627\u0644 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F \u0633\u0631\u067E\u0631\u0633\u062A", level: "EDIT", prerequisites: [] },
  { code: "REVIEW_PERFORMANCE_EVALUATION", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_HISTORY", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0633\u0627\u0628\u0642\u0647 \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_BADGE_LIST", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0634\u0627\u0646 \u0631\u0634\u062F \u062F\u0631 \u0641\u0647\u0631\u0633\u062A \u067E\u0631\u0633\u0646\u0644", level: "VIEW", prerequisites: [] },
  { code: "DELIVER_PERFORMANCE_PERSONAL_SUMMARY", labelFa: "\u062A\u062D\u0648\u06CC\u0644 \u062E\u0644\u0627\u0635\u0647 \u0634\u062E\u0635\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F \u067E\u0633 \u0627\u0632 \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_ANALYTICS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062A\u062D\u0644\u06CC\u0644 \u062A\u062C\u0645\u06CC\u0639\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_NAMED_PERFORMANCE_RANKING", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062A\u062D\u0644\u06CC\u0644 \u0648 \u0631\u062A\u0628\u0647\u200C\u0628\u0646\u062F\u06CC \u0646\u0627\u0645\u200C\u062F\u0627\u0631 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "VIEW_EVALUATOR_CALIBRATION", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646 \u0627\u0631\u0632\u06CC\u0627\u0628", level: "VIEW", prerequisites: [] },
  { code: "REQUEST_PERFORMANCE_EXPORT", labelFa: "\u062F\u0631\u062E\u0648\u0627\u0633\u062A \u062E\u0631\u0648\u062C\u06CC \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_AUDIT", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u062D\u0633\u0627\u0628\u0631\u0633\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_RETENTION", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0648 \u0645\u062D\u062F\u0648\u062F\u0633\u0627\u0632\u06CC \u0634\u0648\u0627\u0647\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF", labelFa: "\u0627\u06CC\u062C\u0627\u062F \u0648\u0627\u06AF\u0630\u0627\u0631\u06CC \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "VIEW_ASSIGNED_PERFORMANCE_CONSEQUENCE_HANDOFF", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0631\u062C\u0627\u0639 \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F \u0627\u062E\u062A\u0635\u0627\u0635\u200C\u06CC\u0627\u0641\u062A\u0647", level: "VIEW", prerequisites: [] },
  { code: "REVIEW_PERFORMANCE_CONSEQUENCE_LEGAL_CONTROL", labelFa: "\u06A9\u0646\u062A\u0631\u0644 \u062D\u0642\u0648\u0642\u06CC \u0645\u0633\u062A\u0642\u0644 \u067E\u06CC\u0627\u0645\u062F \u0639\u0645\u0644\u06A9\u0631\u062F", level: "EDIT", prerequisites: [] },
  { code: "MANAGE_COMPENSATION_AGREEMENTS", labelFa: "\u0627\u0646\u062A\u0634\u0627\u0631 \u062A\u0648\u0627\u0641\u0642 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "ADMIN", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_ROLLOUT", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0645\u0631\u062D\u0644\u0647 \u0648 \u062C\u0627\u0645\u0639\u0647 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "PAUSE_PERFORMANCE_EVALUATION", labelFa: "\u062A\u0648\u0642\u0641 \u0627\u06CC\u0645\u0646 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RECORD_PERFORMANCE_TRAINING", labelFa: "\u062B\u0628\u062A \u0634\u0627\u0647\u062F \u0622\u0645\u0648\u0632\u0634 \u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "RECORD_PERFORMANCE_PROMOTION_EVIDENCE", labelFa: "\u062B\u0628\u062A \u0648 \u0627\u0628\u0637\u0627\u0644 \u0628\u0633\u062A\u0647 \u0634\u0648\u0627\u0647\u062F \u0627\u0631\u062A\u0642\u0627\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_HR", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_SECURITY", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0627\u0645\u0646\u06CC\u062A \u0648 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_COHORT_SYSTEM", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0627\u0644\u06A9 \u0633\u0627\u0645\u0627\u0646\u0647 \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT", labelFa: "\u0641\u0639\u0627\u0644\u200C\u0633\u0627\u0632\u06CC \u0641\u0646\u06CC \u062C\u0627\u0645\u0639\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_HR", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_SECURITY", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0627\u0645\u0646\u06CC\u062A \u0648 \u062D\u0631\u06CC\u0645 \u062E\u0635\u0648\u0635\u06CC \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] },
  { code: "APPROVE_PERFORMANCE_RESUME_SYSTEM", labelFa: "\u062A\u0635\u0648\u06CC\u0628 \u0645\u0627\u0644\u06A9 \u0633\u0627\u0645\u0627\u0646\u0647 \u0631\u0641\u0639 \u062A\u0648\u0642\u0641 \u0639\u0645\u0644\u06A9\u0631\u062F", level: "ADMIN", prerequisites: [] }
];
var PERFORMANCE_ACTION_PERMISSIONS = [
  { code: "VIEW_PERFORMANCE_EVALUATIONS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0639\u0645\u0644\u06A9\u0631\u062F", level: "VIEW", prerequisites: [] },
  { code: "EVALUATE_DIRECT_REPORTS", labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0627\u0641\u0631\u0627\u062F \u062A\u062D\u062A \u0633\u0631\u067E\u0631\u0633\u062A\u06CC", level: "EDIT", prerequisites: [] },
  { code: "EVALUATE_ALL_PERSONNEL", labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0647\u0645\u0647 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_PROFILES", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0644\u06AF\u0648\u0647\u0627\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_PERFORMANCE_BADGE_LIST", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u0634\u0627\u0646 \u0631\u0634\u062F \u062F\u0631 \u0641\u0647\u0631\u0633\u062A \u067E\u0631\u0633\u0646\u0644", level: "VIEW", prerequisites: [] },
  { code: "MANAGE_PERFORMANCE_SURVEYS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0646\u0638\u0631\u0633\u0646\u062C\u06CC \u0631\u0641\u062A\u0627\u0631\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "RESPOND_PERFORMANCE_SURVEYS", labelFa: "\u067E\u0627\u0633\u062E \u0628\u0647 \u0646\u0638\u0631\u0633\u0646\u062C\u06CC \u0631\u0641\u062A\u0627\u0631\u06CC", level: "EDIT", prerequisites: [] },
  { code: "ENTER_PERFORMANCE_EVIDENCE", labelFa: "\u062B\u0628\u062A \u0634\u0648\u0627\u0647\u062F \u06A9\u0645\u06CC \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "EDIT", prerequisites: [] },
  { code: "FINALIZE_PERFORMANCE_RESULTS", labelFa: "\u0646\u0647\u0627\u06CC\u06CC\u200C\u0633\u0627\u0632\u06CC \u0646\u062A\u06CC\u062C\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC", level: "ADMIN", prerequisites: [] },
  { code: "VIEW_RAW_PERFORMANCE_SURVEY", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u067E\u0627\u0633\u062E \u062E\u0627\u0645 \u0646\u0638\u0631\u0633\u0646\u062C\u06CC", level: "ADMIN", prerequisites: [] }
];
var PERFORMANCE_ACTION_PERMISSION_CODES = PERFORMANCE_ACTION_PERMISSIONS.map(({ code }) => code);
var INDEPENDENT_PERFORMANCE_ACTION_PERMISSION_CODES = [
  ...LEGACY_PERFORMANCE_ACTION_PERMISSIONS.map(({ code }) => code),
  ...PERFORMANCE_ACTION_PERMISSION_CODES
];
var HR_ACTION_PERMISSION_GROUPS = [
  {
    code: "PARTNER_SELLER",
    labelFa: "\u0641\u0631\u0648\u0634\u0646\u062F\u0647 \u0647\u0645\u06A9\u0627\u0631",
    permissions: [
      { code: "VERIFY_PARTNER_IDENTITY", labelFa: "\u062A\u0623\u06CC\u06CC\u062F \u0647\u0648\u06CC\u062A \u0647\u0645\u06A9\u0627\u0631\u06CC", level: "EDIT", prerequisites: [] }
    ]
  },
  {
    code: "CASE_EVIDENCE",
    labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u0648 \u0634\u0648\u0627\u0647\u062F",
    permissions: [
      { code: "VIEW_INITIAL_INTERVIEW_REPORT", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u06AF\u0632\u0627\u0631\u0634 \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_FULL_APPLICANT_INFORMATION", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u06A9\u0627\u0645\u0644 \u0645\u062A\u0642\u0627\u0636\u06CC", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_COMPANY_EVALUATION_RESULTS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u062A\u0627\u06CC\u062C \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "VIEW_FORMAL_ASSESSMENT_RESULTS", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0646\u062A\u0627\u06CC\u062C \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0631\u0633\u0645\u06CC", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] }
    ]
  },
  {
    code: "INITIAL_INTERVIEW",
    labelFa: "\u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647",
    permissions: [
      { code: "RECORD_INITIAL_INTERVIEW", labelFa: "\u062B\u0628\u062A \u0648 \u062A\u06A9\u0645\u06CC\u0644 \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_INITIAL_INTERVIEW_CRITERIA"] },
      { code: "VIEW_INITIAL_INTERVIEW_CRITERIA", labelFa: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0639\u06CC\u0627\u0631\u0647\u0627\u06CC \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "VIEW", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_INITIAL_INTERVIEW_CRITERIA", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0648 \u0627\u0646\u062A\u0634\u0627\u0631 \u0645\u0639\u06CC\u0627\u0631\u0647\u0627\u06CC \u0645\u0635\u0627\u062D\u0628\u0647 \u0627\u0648\u0644\u06CC\u0647", level: "ADMIN", prerequisites: ["VIEW_INITIAL_INTERVIEW_CRITERIA"] },
      { code: "RECORD_PRELIMINARY_DECISION", labelFa: "\u062B\u0628\u062A \u062A\u0635\u0645\u06CC\u0645 \u0645\u0642\u062F\u0645\u0627\u062A\u06CC", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT"] }
    ]
  },
  {
    code: "COMPANY_EVALUATION",
    labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC\u200C\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
    permissions: [
      { code: "MANAGE_COMPANY_EVALUATION_PLAN", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0631\u0646\u0627\u0645\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT", "VIEW_COMPANY_EVALUATION_RESULTS"] },
      { code: "RECORD_COMPANY_EVALUATION_RESULT", labelFa: "\u062B\u0628\u062A \u0646\u062A\u06CC\u062C\u0647 \u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0634\u0631\u06A9\u062A", level: "EDIT", prerequisites: ["VIEW_COMPANY_EVALUATION_RESULTS"] },
      { code: "MANAGE_RECRUITMENT_EVALUATOR_SETTINGS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062A\u0646\u0638\u06CC\u0645\u0627\u062A \u0627\u0631\u0632\u06CC\u0627\u0628\u0627\u0646 \u062C\u0630\u0628", level: "ADMIN", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "RECORD_FINAL_MANAGEMENT_DECISION", labelFa: "\u062B\u0628\u062A \u062A\u0635\u0645\u06CC\u0645 \u0646\u0647\u0627\u06CC\u06CC \u0645\u062F\u06CC\u0631\u06CC\u062A", level: "EDIT", prerequisites: ["VIEW_INITIAL_INTERVIEW_REPORT", "VIEW_COMPANY_EVALUATION_RESULTS"] }
    ]
  },
  {
    code: "CASE_ADMINISTRATION",
    labelFa: "\u0627\u062F\u0627\u0631\u0647 \u067E\u0631\u0648\u0646\u062F\u0647 \u0648 \u0639\u0645\u0644\u06CC\u0627\u062A \u062A\u06A9\u0645\u06CC\u0644\u06CC",
    permissions: [
      { code: "MANAGE_RECRUITMENT_CASE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0631\u0648\u0646\u062F\u0647 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "REVISE_PLANNED_EMPLOYMENT_START", labelFa: "\u0627\u0635\u0644\u0627\u062D \u062A\u0627\u0631\u06CC\u062E \u0628\u0631\u0646\u0627\u0645\u0647\u200C\u0631\u06CC\u0632\u06CC\u200C\u0634\u062F\u0647 \u0634\u0631\u0648\u0639", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PRE_EMPLOYMENT_REQUIREMENTS", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0627\u0644\u0632\u0627\u0645\u0627\u062A \u067E\u06CC\u0634 \u0627\u0632 \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PERSONNEL_SCHEDULE", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0628\u0631\u0646\u0627\u0645\u0647 \u06A9\u0627\u0631 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: ["PERSONNEL"] },
      { code: "ARCHIVE_RECRUITMENT_CASE", labelFa: "\u0628\u0627\u06CC\u06AF\u0627\u0646\u06CC \u0648 \u0628\u0627\u0632\u06CC\u0627\u0628\u06CC \u067E\u0631\u0648\u0646\u062F\u0647", level: "ADMIN", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_HR_WORK", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u06A9\u0627\u0631\u0647\u0627\u06CC \u0645\u0646\u0627\u0628\u0639 \u0627\u0646\u0633\u0627\u0646\u06CC", level: "EDIT", prerequisites: ["HR_WORK_MANAGEMENT"] },
      { code: "MANAGE_COMPENSATION", labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u06CC\u0634\u0646\u0647\u0627\u062F \u0648 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_PAYROLL", labelFa: "\u062B\u0628\u062A \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0627\u0637\u0644\u0627\u0639\u0627\u062A \u062D\u0642\u0648\u0642", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "MANAGE_COMPENSATION_AGREEMENTS", labelFa: "\u0627\u0646\u062A\u0634\u0627\u0631 \u062A\u0648\u0627\u0641\u0642 \u062C\u0628\u0631\u0627\u0646 \u062E\u062F\u0645\u062A", level: "ADMIN", prerequisites: [] },
      { code: "MANAGE_FINANCE_EVIDENCE", labelFa: "\u0645\u062C\u0648\u0632 \u0642\u062F\u06CC\u0645\u06CC \u0634\u0648\u0627\u0647\u062F \u0645\u0627\u0644\u06CC (\u063A\u06CC\u0631\u0641\u0639\u0627\u0644 \u062F\u0631 \u0627\u0633\u062A\u062E\u062F\u0627\u0645)", level: "EDIT", prerequisites: [] },
      { code: "REVIEW_IDENTITY_DOCUMENTS", labelFa: "\u062F\u0631\u06CC\u0627\u0641\u062A \u0648 \u062A\u0637\u0628\u06CC\u0642 \u0627\u0633\u0646\u0627\u062F \u0647\u0648\u06CC\u062A\u06CC", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "APPROVE_IDENTITY_CLEARANCE", labelFa: "\u062A\u0623\u06CC\u06CC\u062F \u0646\u0647\u0627\u06CC\u06CC \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "RESOLVE_CANDIDATE_PERSONNEL_IDENTITY_CONFLICT", labelFa: "\u062A\u0639\u06CC\u06CC\u0646 \u062A\u06A9\u0644\u06CC\u0641 \u0645\u063A\u0627\u06CC\u0631\u062A \u0647\u0648\u06CC\u062A \u0645\u062A\u0642\u0627\u0636\u06CC \u0648 \u067E\u0631\u0633\u0646\u0644", level: "EDIT", prerequisites: ["RECRUITMENT_CASES", "VIEW_FULL_APPLICANT_INFORMATION"] },
      { code: "RECORD_SIGNED_EMPLOYMENT_CONTRACT", labelFa: "\u062B\u0628\u062A \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u06A9\u0627\u063A\u0630\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: [] },
      { code: "VERIFY_SIGNED_EMPLOYMENT_CONTRACT", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0642\u0631\u0627\u0631\u062F\u0627\u062F \u06A9\u0627\u063A\u0630\u06CC \u0627\u0633\u062A\u062E\u062F\u0627\u0645", level: "EDIT", prerequisites: [] },
      { code: "MANAGE_COLLATERAL_REQUIREMENTS", labelFa: "\u062A\u0639\u06CC\u06CC\u0646 \u0627\u0644\u0632\u0627\u0645\u0627\u062A \u0648\u062B\u06CC\u0642\u0647 \u0645\u062A\u0642\u0627\u0636\u06CC", level: "EDIT", prerequisites: ["RECRUITMENT_CASES"] },
      { code: "RECORD_COLLATERAL_CUSTODY", labelFa: "\u062B\u0628\u062A \u062F\u0631\u06CC\u0627\u0641\u062A \u0648 \u0646\u06AF\u0647\u062F\u0627\u0631\u06CC \u0648\u062B\u06CC\u0642\u0647", level: "EDIT", prerequisites: [] },
      { code: "VERIFY_COLLATERAL_CUSTODY", labelFa: "\u0628\u0631\u0631\u0633\u06CC \u0648 \u062A\u0623\u06CC\u06CC\u062F \u0648\u062B\u06CC\u0642\u0647", level: "EDIT", prerequisites: [] }
    ]
  },
  {
    code: "FOUNDATION_ADMINISTRATION",
    labelFa: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0633\u0627\u062E\u062A\u0627\u0631 \u0633\u0627\u0632\u0645\u0627\u0646\u06CC",
    permissions: [
      { code: "PERMANENTLY_DELETE_ORGANIZATIONAL_FOUNDATION", labelFa: "\u062D\u0630\u0641 \u062F\u0627\u0626\u0645\u06CC \u0648\u0627\u062D\u062F\u060C \u0634\u063A\u0644 \u0648 \u062C\u0627\u06CC\u06AF\u0627\u0647", level: "ADMIN", prerequisites: ["ORGANIZATIONAL_STRUCTURE"] }
    ]
  },
  {
    code: "PERSONNEL_PERFORMANCE",
    labelFa: "\u0627\u0631\u0632\u06CC\u0627\u0628\u06CC \u0645\u062D\u0631\u0645\u0627\u0646\u0647 \u0639\u0645\u0644\u06A9\u0631\u062F \u067E\u0631\u0633\u0646\u0644",
    permissions: PERFORMANCE_ACTION_PERMISSIONS
  }
];
var HR_ACTION_PERMISSIONS = HR_ACTION_PERMISSION_GROUPS.flatMap((group) => group.permissions);
var AUTHORIZABLE_HR_ACTION_PERMISSIONS = [...new Map([
  ...LEGACY_PERFORMANCE_ACTION_PERMISSIONS,
  ...HR_ACTION_PERMISSIONS
].map((permission2) => [permission2.code, permission2])).values()];
var definitions = new Map(AUTHORIZABLE_HR_ACTION_PERMISSIONS.map((permission2) => [permission2.code, permission2]));

// src/services/hrRedesignDataContracts.ts
var HR_REDESIGN_CATALOG = Object.freeze({
  contractVersion: 1,
  workspaceCode: "HUMAN_RESOURCES",
  workspaceFeatures: [
    { code: "DASHBOARD" },
    { code: "ORGANIZATIONAL_STRUCTURE" },
    { code: "PERSONNEL" },
    { code: "RECRUITMENT_CASES" },
    { code: "HR_WORK_MANAGEMENT" },
    { code: "AUTHORITY_RESPONSIBILITY_ADMINISTRATION" },
    { code: "DATA_MIGRATION_RECONCILIATION" },
    { code: "USER_ADMINISTRATION" },
    // HR-owned driver, vehicle and biometric capabilities use the same
    // effective-dated grant ledger as every other HR capability.
    { code: "hr_internal_drivers_view" },
    { code: "hr_internal_drivers_manage" },
    { code: "hr_vehicle_operations_view" },
    { code: "hr_vehicle_operations_manage" },
    { code: "hr_internal_driver_eligibility_manage" },
    { code: "hr_driver_biometric_audit_view" },
    { code: "hr_driver_biometric_enrollment_manage" },
    { code: "hr_driver_profiles_manage" },
    { code: "hr_company_vehicles_manage" },
    { code: "hr_vehicle_plates_manage" },
    { code: "hr_driver_vehicle_assignments_manage" },
    { code: "hr_vehicle_operations_audit_view" },
    ...HR_ACTION_PERMISSIONS.map(({ code }) => ({ code }))
  ],
  featureLevels: ["VIEW", "EDIT", "ADMIN"],
  businessAuthorities: [
    "HR_PROCESSOR",
    "HR_MANAGER",
    "COMPANY_MANAGER",
    "HR_PAYROLL_PROCESSOR",
    "HR_PAYROLL_MANAGER",
    "FINANCE_RECORDER",
    "FINANCE_MANAGER"
  ],
  responsibilityTypes: [
    "HR_PROCESSOR",
    "HR_MANAGER",
    "RESPONSIBLE_SUPERVISOR",
    "COMPANY_MANAGER",
    "HR_PAYROLL_PROCESSOR",
    "HR_PAYROLL_MANAGER",
    "FINANCE_RECORDER",
    "FINANCE_MANAGER"
  ],
  assessmentKinds: ["DISC", "EQ", "BIG_FIVE"],
  dutyEnvelopeVersion: 1
});
var everyFeatureAt = (level) => Object.fromEntries(
  HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => [code, level])
);
var HR_QA_ACCESS_MATRIX = Object.freeze({
  qa_no_hr_access: { workspaceLevel: null, features: {}, authority: null, responsibility: null, destinationWorkspace: null },
  qa_hr_viewer: { workspaceLevel: "VIEW", features: everyFeatureAt("VIEW"), authority: null, responsibility: null, destinationWorkspace: null },
  qa_finance_manager: { workspaceLevel: null, features: {}, authority: "FINANCE_MANAGER", responsibility: "FINANCE_MANAGER", destinationWorkspace: "ACCOUNTING" },
  qa_finance_recorder: { workspaceLevel: null, features: {}, authority: "FINANCE_RECORDER", responsibility: "FINANCE_RECORDER", destinationWorkspace: "ACCOUNTING" },
  qa_payroll_manager: {
    workspaceLevel: "EDIT",
    features: { DASHBOARD: "VIEW", PERSONNEL: "VIEW", RECRUITMENT_CASES: "VIEW", HR_WORK_MANAGEMENT: "EDIT" },
    authority: "HR_PAYROLL_MANAGER",
    responsibility: "HR_PAYROLL_MANAGER",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_payroll_processor: {
    workspaceLevel: "EDIT",
    features: { DASHBOARD: "VIEW", PERSONNEL: "VIEW", RECRUITMENT_CASES: "EDIT", HR_WORK_MANAGEMENT: "EDIT" },
    authority: "HR_PAYROLL_PROCESSOR",
    responsibility: "HR_PAYROLL_PROCESSOR",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_hr_manager: {
    workspaceLevel: "ADMIN",
    features: {
      PERSONNEL: "VIEW",
      RECRUITMENT_CASES: "VIEW",
      HR_WORK_MANAGEMENT: "VIEW",
      VIEW_INITIAL_INTERVIEW_CRITERIA: "VIEW",
      VIEW_INITIAL_INTERVIEW_REPORT: "VIEW",
      RECORD_PRELIMINARY_DECISION: "EDIT",
      MANAGE_INITIAL_INTERVIEW_CRITERIA: "ADMIN",
      ARCHIVE_RECRUITMENT_CASE: "ADMIN",
      MANAGE_HR_WORK: "EDIT",
      MANAGE_RECRUITMENT_CASE: "EDIT",
      MANAGE_PERSONNEL_SCHEDULE: "EDIT"
    },
    authority: "HR_MANAGER",
    responsibility: "HR_MANAGER",
    destinationWorkspace: "HUMAN_RESOURCES"
  },
  qa_hr_processor: {
    workspaceLevel: "EDIT",
    features: {
      DASHBOARD: "VIEW",
      ORGANIZATIONAL_STRUCTURE: "VIEW",
      PERSONNEL: "EDIT",
      RECRUITMENT_CASES: "EDIT",
      HR_WORK_MANAGEMENT: "EDIT",
      AUTHORITY_RESPONSIBILITY_ADMINISTRATION: "VIEW",
      DATA_MIGRATION_RECONCILIATION: "VIEW"
    },
    authority: "HR_PROCESSOR",
    responsibility: "HR_PROCESSOR",
    destinationWorkspace: "HUMAN_RESOURCES"
  }
});
var featureDisplayNames = {
  DASHBOARD: "Dashboard",
  ORGANIZATIONAL_STRUCTURE: "Organizational Structure",
  PERSONNEL: "Personnel",
  RECRUITMENT_CASES: "Recruitment Cases",
  HR_WORK_MANAGEMENT: "HR Work Management",
  AUTHORITY_RESPONSIBILITY_ADMINISTRATION: "Authority and Responsibility Administration",
  DATA_MIGRATION_RECONCILIATION: "Data Migration and Reconciliation",
  USER_ADMINISTRATION: "User Administration",
  hr_internal_drivers_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_internal_drivers_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646 \u062F\u0627\u062E\u0644\u06CC",
  hr_vehicle_operations_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  hr_internal_driver_eligibility_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u0635\u0644\u0627\u062D\u06CC\u062A \u0631\u0627\u0646\u0646\u062F\u0647 \u062F\u0627\u062E\u0644\u06CC",
  hr_driver_biometric_audit_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0645\u06CC\u0632\u06CC \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u0631\u0627\u0646\u0646\u062F\u0647",
  hr_driver_biometric_enrollment_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062B\u0628\u062A \u0628\u06CC\u0648\u0645\u062A\u0631\u06CC\u06A9 \u0631\u0627\u0646\u0646\u062F\u0647",
  hr_driver_profiles_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0631\u0648\u0641\u0627\u06CC\u0644 \u0631\u0627\u0646\u0646\u062F\u06AF\u0627\u0646",
  hr_company_vehicles_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062E\u0648\u062F\u0631\u0648\u0647\u0627\u06CC \u0634\u0631\u06A9\u062A",
  hr_vehicle_plates_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u067E\u0644\u0627\u06A9 \u062E\u0648\u062F\u0631\u0648\u0647\u0627",
  hr_driver_vehicle_assignments_manage: "\u0645\u062F\u06CC\u0631\u06CC\u062A \u062A\u062E\u0635\u06CC\u0635 \u0631\u0627\u0646\u0646\u062F\u0647 \u0648 \u062E\u0648\u062F\u0631\u0648",
  hr_vehicle_operations_audit_view: "\u0645\u0634\u0627\u0647\u062F\u0647 \u0645\u0645\u06CC\u0632\u06CC \u0639\u0645\u0644\u06CC\u0627\u062A \u062E\u0648\u062F\u0631\u0648",
  ...Object.fromEntries(HR_ACTION_PERMISSIONS.map(({ code, labelFa }) => [code, labelFa]))
};

// src/services/effectiveAuthorization/scopedActions.ts
async function resolveScopedActions(tx, actorId, domain) {
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId} FOR UPDATE`;
  const [version] = await tx.$queryRaw`
    SELECT revision FROM effective_authorization_state WHERE id = 1 FOR UPDATE`;
  return scopedActionSnapshot(tx, actorId, domain, version);
}
async function scopedActionSnapshot(tx, actorId, domain, version) {
  if (!version) throw new Error("Scoped authority state unavailable");
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  const rows = !actor?.isActive ? [] : await tx.$queryRaw`
    SELECT id, "principalKind", "principalId", domain, action, "rootKind", purpose, scope, effect, "boundRootId", "expiresAt"
    FROM effective_action_grants WHERE domain = ${domain} AND "revokedAt" IS NULL
      AND "effectiveFrom" <= clock_timestamp() AND ("expiresAt" IS NULL OR "expiresAt" > clock_timestamp())
      AND (("principalKind" = 'USER' AND "principalId" = ${actorId})
        OR ("principalKind" = 'ROLE' AND "principalId" = ${actor.role})) ORDER BY id`;
  const direct = new Set(rows.filter((row) => row.principalKind === "USER").map(key));
  const selected = rows.filter((row) => row.principalKind === "USER" || !direct.has(key(row)));
  const denied = new Set(selected.filter((row) => row.effect === "DENY").map(key));
  return { authorizationRevision: version.revision, grants: selected.filter((row) => row.effect === "ALLOW" && !denied.has(key(row))).map((row) => ({
    action: row.action,
    rootKind: row.rootKind,
    purpose: row.purpose,
    scope: row.scope,
    ...row.boundRootId ? { boundRootId: row.boundRootId } : {},
    ...row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {},
    provenance: {
      source: row.principalKind === "USER" ? "DIRECT_ACTION" : "ROLE_ACTION",
      grantId: row.id,
      version: 1
    }
  })) };
}
function key(row) {
  return JSON.stringify([row.action, row.rootKind, row.purpose]);
}

// src/services/effectiveAccessService.ts
var EXPLICIT_FEATURES = /* @__PURE__ */ new Set([
  FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE,
  FEATURES.SALES_PARTNER_INQUIRIES_VIEW,
  FEATURES.SALES_PARTNER_INQUIRIES_RESPOND
]);
var ADMIN_WORKSPACES = ["sales", "crm", "hr", "accounting", "inventory", "security", "bi", "logistics"];
var HR_FEATURE_CODES = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);
var HR_ACTION_CODES = new Set(AUTHORIZABLE_HR_ACTION_PERMISSIONS.map(({ code }) => code));
var activeLegacyGrant = (grant, at) => grant.isActive && (!grant.expiresAt || grant.expiresAt > at);
var activeCanonicalGrant = (grant, at) => grant.status === "ACTIVE" && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at);
var permission = (value) => value.toLowerCase();
var PERMISSION_RANK = { view: 1, edit: 2, admin: 3 };
var capAtWorkspaceLevel = (featureLevel, workspaceLevel) => {
  const featurePermission = permission(featureLevel);
  const workspacePermission = permission(workspaceLevel);
  return PERMISSION_RANK[featurePermission] <= PERMISSION_RANK[workspacePermission] ? featurePermission : workspacePermission;
};
var getEffectiveUserAccess = async (client, input) => {
  if (input.userRole === "ADMIN") {
    const workspaces2 = ADMIN_WORKSPACES.map((workspace) => ({ workspace, permission: "admin" }));
    const features2 = [
      ...Object.entries(FEATURE_WORKSPACE_MAP).filter(([, workspace]) => workspace !== "hr").map(([feature, workspace]) => ({ feature, workspace, permission: "admin" })),
      ...HR_FEATURE_CODES.map((feature) => ({ feature, workspace: "hr", permission: "admin" }))
    ];
    return {
      workspaces: workspaces2,
      features: features2,
      provenance: {
        workspaces: workspaces2.map((grant) => ({ ...grant, source: "SYSTEM_ADMIN_OVERRIDE", grantId: null })),
        features: features2.map((grant) => ({ ...grant, source: "SYSTEM_ADMIN_OVERRIDE", grantId: null }))
      }
    };
  }
  const at = input.at ?? /* @__PURE__ */ new Date();
  const [
    directWorkspaces,
    roleWorkspaces,
    directFeatures,
    roleFeatures,
    canonicalHrWorkspaces,
    canonicalHrFeatures
  ] = await Promise.all([
    client.workspacePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client.roleWorkspacePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client.featurePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client.roleFeaturePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client.hrWorkspaceAccessGrant.findMany({
      where: { userId: input.userId, workspaceCode: "HUMAN_RESOURCES" },
      orderBy: { effectiveFrom: "desc" }
    }),
    client.hrFeatureAccessGrant.findMany({
      where: { userId: input.userId },
      orderBy: { effectiveFrom: "desc" }
    })
  ]);
  const activeDirect = directWorkspaces.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const directWorkspaceCodes = new Set(activeDirect.map((grant) => grant.workspace));
  const canonicalHr = canonicalHrWorkspaces.find((grant) => grant.reason !== "HR redesign baseline" && activeCanonicalGrant(grant, at));
  const inheritedHr = roleWorkspaces.find((grant) => grant.workspace === "hr" && activeLegacyGrant(grant, at));
  const workspaces = [
    ...activeDirect.map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) })),
    ...canonicalHr ? [{ workspace: "hr", permission: permission(canonicalHr.level) }] : inheritedHr ? [{ workspace: "hr", permission: permission(inheritedHr.permissionLevel) }] : [],
    ...roleWorkspaces.filter((grant) => grant.workspace !== "hr" && !directWorkspaceCodes.has(grant.workspace) && activeLegacyGrant(grant, at)).map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) }))
  ];
  const activeDirectFeatures = directFeatures.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const activeRoleFeatures = roleFeatures.filter((grant) => grant.workspace !== "hr" && activeLegacyGrant(grant, at));
  const nonHrFeatureCodes = /* @__PURE__ */ new Set([
    ...activeDirectFeatures.map((grant) => grant.feature),
    ...activeRoleFeatures.map((grant) => grant.feature),
    ...Object.entries(FEATURE_WORKSPACE_MAP).filter(([, workspace]) => workspace !== "hr" && (activeDirect.some((grant) => grant.workspace === workspace) || roleWorkspaces.some((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at)))).map(([feature]) => feature)
  ]);
  const nonHrFeatures = [...nonHrFeatureCodes].flatMap((feature) => {
    const workspace = FEATURE_WORKSPACE_MAP[feature];
    if (!workspace || workspace === "hr") return [];
    const directFeature = activeDirectFeatures.find((grant) => grant.feature === feature);
    const directWorkspace = activeDirect.find((grant) => grant.workspace === workspace);
    const roleFeature = activeRoleFeatures.find((grant) => grant.feature === feature);
    const roleWorkspace = roleWorkspaces.find((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at));
    if (EXPLICIT_FEATURES.has(feature)) {
      const explicit = directFeature ?? roleFeature;
      return explicit ? [{ feature, permission: permission(explicit.permissionLevel), workspace }] : [];
    }
    const effective = directWorkspace?.permissionLevel.toLowerCase() === "admin" ? directWorkspace : directFeature ?? directWorkspace ?? roleFeature ?? roleWorkspace;
    return effective ? [{ feature, permission: permission(effective.permissionLevel), workspace }] : [];
  });
  const effectiveHrWorkspaceLevel = canonicalHr?.level ?? inheritedHr?.permissionLevel;
  const broadManagerOverride = input.userRole === "MANAGER" && effectiveHrWorkspaceLevel?.toUpperCase() === "ADMIN";
  const activeCanonicalFeatures = canonicalHrFeatures.filter((grant) => grant.reason !== "HR redesign baseline" && activeCanonicalGrant(grant, at));
  const directHrFeatures = /* @__PURE__ */ new Map();
  for (const grant of activeCanonicalFeatures) {
    if (!directHrFeatures.has(grant.featureCode)) directHrFeatures.set(grant.featureCode, grant);
  }
  const inheritedHrFeatures = roleFeatures.filter((grant) => grant.workspace === "hr" && activeLegacyGrant(grant, at));
  const hrFeatureCodes = /* @__PURE__ */ new Set([
    ...directHrFeatures.keys(),
    ...inheritedHrFeatures.map((grant) => grant.feature)
  ]);
  const independentActionFeatures = activeCanonicalFeatures.filter((grant) => HR_ACTION_CODES.has(grant.featureCode)).map((grant) => ({ feature: grant.featureCode, permission: permission(grant.level), workspace: "hr" }));
  const hrFeatures = !effectiveHrWorkspaceLevel ? independentActionFeatures : broadManagerOverride ? HR_FEATURE_CODES.map((feature) => ({
    feature,
    permission: "admin",
    workspace: "hr"
  })) : [...hrFeatureCodes].map((feature) => {
    const direct = directHrFeatures.get(feature);
    const inherited = inheritedHrFeatures.find((grant) => grant.feature === feature);
    const resolvedLevel = direct?.level ?? inherited.permissionLevel;
    return {
      feature,
      // Action permissions are independently scoped authorization. A VIEW
      // workspace grant admits the user to the destination without reducing
      // an explicitly granted EDIT action to VIEW.
      permission: HR_ACTION_CODES.has(feature) ? permission(resolvedLevel) : capAtWorkspaceLevel(resolvedLevel, effectiveHrWorkspaceLevel),
      workspace: "hr"
    };
  });
  const features = [...nonHrFeatures, ...hrFeatures];
  const workspaceProvenance = workspaces.map((grant) => {
    if (grant.workspace === "hr") {
      return {
        ...grant,
        source: canonicalHr ? "CANONICAL_HR_WORKSPACE" : "ROLE_WORKSPACE",
        grantId: canonicalHr?.id ?? inheritedHr?.id ?? null
      };
    }
    const direct = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const inherited = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    return {
      ...grant,
      source: direct ? "DIRECT_WORKSPACE" : "ROLE_WORKSPACE",
      grantId: direct?.id ?? inherited?.id ?? null
    };
  });
  const featureProvenance = features.map((grant) => {
    if (grant.workspace === "hr") {
      if (broadManagerOverride) return { ...grant, source: "HR_MANAGER_OVERRIDE", grantId: canonicalHr?.id ?? null };
      const direct = directHrFeatures.get(grant.feature);
      const inherited = inheritedHrFeatures.find((candidate) => candidate.feature === grant.feature);
      return {
        ...grant,
        source: direct ? "CANONICAL_HR_FEATURE" : "ROLE_FEATURE",
        grantId: direct?.id ?? inherited?.id ?? null
      };
    }
    const directFeature = activeDirectFeatures.find((candidate) => candidate.feature === grant.feature);
    const directWorkspace = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const roleFeature = activeRoleFeatures.find((candidate) => candidate.feature === grant.feature);
    const roleWorkspace = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    if (EXPLICIT_FEATURES.has(grant.feature)) {
      return { ...grant, source: directFeature ? "DIRECT_FEATURE" : "ROLE_FEATURE", grantId: directFeature?.id ?? roleFeature?.id ?? null };
    }
    if (directWorkspace?.permissionLevel.toLowerCase() === "admin") {
      return { ...grant, source: "DIRECT_WORKSPACE", grantId: directWorkspace.id };
    }
    if (directFeature) return { ...grant, source: "DIRECT_FEATURE", grantId: directFeature.id };
    if (directWorkspace) return { ...grant, source: "DIRECT_WORKSPACE", grantId: directWorkspace.id };
    if (roleFeature) return { ...grant, source: "ROLE_FEATURE", grantId: roleFeature.id };
    return { ...grant, source: "ROLE_WORKSPACE", grantId: roleWorkspace?.id ?? null };
  });
  return { workspaces, features, provenance: { workspaces: workspaceProvenance, features: featureProvenance } };
};

// src/services/partnerSales/accounting/capabilities.ts
async function readPartnerCommercialAccountingCapabilities(tx, actorId) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive) return { view: false, paper: false };
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const workspace = effective.workspaces.find((row) => row.workspace === "accounting")?.permission;
  const view = ["view", "edit", "admin"].includes(workspace || "") && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: "accounting", feature: "accounting_contracts_view", requiredPermission: "view" })).allowed;
  const paper = view && ["edit", "admin"].includes(workspace || "") && (await resolveNarrowFeatureAccess(tx, { userId: actorId, role: actor.role, workspace: "accounting", feature: "accounting_actions_manage", requiredPermission: "edit" })).allowed;
  return { view, paper };
}

// src/services/partnerSales/authorization/workspaceAuthority.ts
var rank = { view: 1, edit: 2, admin: 3 };
async function resolvePartnerWorkspaceAuthority(tx, actorId) {
  const actor = await tx.user.findUnique({
    where: { id: actorId },
    select: { role: true, isActive: true, partnerProfile: { select: { id: true } } }
  });
  if (!actor?.isActive || actor.partnerProfile) {
    return { isSystemAdmin: false, canViewAssigned: false, canRespondAssigned: false, canManageInquiries: false, grants: [] };
  }
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  const level = (feature) => effective.features.find((item) => item.feature === feature)?.permission;
  const atLeast = (feature, required) => {
    const actual = level(feature);
    return Boolean(actual && rank[actual] >= rank[required]);
  };
  const isSystemAdmin = actor.role === "ADMIN";
  const canViewAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_VIEW, "view");
  const canRespondAssigned = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_INQUIRIES_RESPOND, "edit");
  const canManageInquiries = isSystemAdmin || atLeast(FEATURES.SALES_PARTNER_SELLERS_MANAGE, "admin");
  const grants = [];
  const add = (grant) => {
    if (!grants.some((item) => item.action === grant.action && item.rootKind === grant.rootKind && item.purpose === grant.purpose && item.scope === grant.scope)) grants.push(grant);
  };
  if ((await readPartnerCommercialAccountingCapabilities(tx, actorId)).view) {
    add({ action: "ACCOUNTING_READ", rootKind: "CASE", purpose: "ACCOUNTING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE, "edit")) {
    add({ action: "CUSTOMER_READ", rootKind: "CUSTOMER", purpose: "CRM", scope: "COMPANY" });
    add({ action: "CUSTOMER_TRANSFER_DECIDE", rootKind: "CUSTOMER", purpose: "CRM", scope: "COMPANY" });
  }
  if (canViewAssigned) {
    add({ action: "INQUIRY_READ", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "ASSIGNED" });
  }
  if (canRespondAssigned) {
    add({ action: "INQUIRY_RESPOND", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "ASSIGNED" });
  }
  if (canManageInquiries) {
    add({ action: "INQUIRY_READ", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "COMPANY" });
    add({ action: "INQUIRY_RESPOND", rootKind: "INQUIRY", purpose: "RESPONDER", scope: "COMPANY" });
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "COMMERCIAL_TERMS_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "RESPONDER_ASSIGN", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "RESPONDER_REASSIGN", rootKind: "INQUIRY", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "PROFILE_CONVERSION_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast("VERIFY_PARTNER_IDENTITY", "edit")) {
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "IDENTITY_VERIFY", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.ACCOUNTING_PARTNER_TERMS_MANAGE, "edit")) {
    add({ action: "PROFILE_READ", rootKind: "PROFILE", purpose: "ONBOARDING", scope: "COMPANY" });
    add({ action: "COMMERCIAL_TERMS_MANAGE", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "CREDIT_TERMS_MANAGE", rootKind: "PROFILE", purpose: "ACCOUNTING", scope: "COMPANY" });
  }
  if (isSystemAdmin || atLeast(FEATURES.BI_PARTNER_REPORTS_VIEW, "view")) {
    add({ action: "REPORT_READ", rootKind: "PROFILE", purpose: "MANAGEMENT", scope: "COMPANY" });
    add({ action: "REPORT_READ", rootKind: "CASE", purpose: "MANAGEMENT", scope: "COMPANY" });
  }
  return { isSystemAdmin, canViewAssigned, canRespondAssigned, canManageInquiries, grants };
}

// src/services/partnerSales/authorization/centralAuthority.ts
var resolvePartnerScopedAuthority = async (tx, input) => {
  const current = await resolveScopedActions(tx, input.actorId, "PARTNER");
  const workspace = await resolvePartnerWorkspaceAuthority(tx, input.actorId);
  const grants = [];
  for (const grant of current.grants) {
    const action = import_partner_sales_contracts15.PartnerActionV2Schema.safeParse(grant.action);
    const kind = import_partner_sales_contracts15.PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = import_partner_sales_contracts15.PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success) grants.push({ ...grant, action: action.data, rootKind: kind.data, purpose: purpose.data });
  }
  for (const grant of workspace.grants) {
    if (grant.action === "ACCOUNTING_READ") {
      const explicit = await tx.$queryRaw`
        SELECT g.id FROM effective_action_grants g JOIN users u ON u.id = ${input.actorId}
        WHERE g.domain = 'PARTNER' AND g.action = 'ACCOUNTING_READ'
          AND g."rootKind" = 'CASE' AND g.purpose = 'ACCOUNTING' AND g."revokedAt" IS NULL
          AND g."effectiveFrom" <= clock_timestamp()
          AND (g."expiresAt" IS NULL OR g."expiresAt" > clock_timestamp())
          AND ((g."principalKind" = 'USER' AND g."principalId" = u.id)
            OR (g."principalKind" = 'ROLE' AND g."principalId" = u.role::text)) LIMIT 1`;
      if (explicit.length) continue;
    }
    const action = import_partner_sales_contracts15.PartnerActionV2Schema.safeParse(grant.action);
    const kind = import_partner_sales_contracts15.PermissionContextSchema.shape.root.shape.kind.safeParse(grant.rootKind);
    const purpose = import_partner_sales_contracts15.PermissionContextSchema.shape.purpose.safeParse(grant.purpose);
    if (action.success && kind.success && purpose.success && !grants.some((item) => item.action === action.data && item.rootKind === kind.data && item.purpose === purpose.data && item.scope === grant.scope)) {
      grants.push({ action: action.data, rootKind: kind.data, purpose: purpose.data, scope: grant.scope });
    }
  }
  return { authorizationRevision: current.authorizationRevision, grants };
};

// src/services/partnerSales/authorization/audited.ts
function createAuditedPartnerAuthorization(tx, binding, audit, target) {
  if (!audit.correlationId.trim() || audit.correlationId.length > 200 || (audit.reason?.length ?? 0) > 2e3) {
    throw new Error("Valid authorization audit context required");
  }
  const source = prismaAuthorizationSource(tx, resolvePartnerScopedAuthority, target);
  return { async authorize(action, root) {
    if (!import_partner_sales_contracts16.PartnerActionV2Schema.safeParse(action).success || !import_partner_sales_contracts16.PermissionContextSchema.shape.root.safeParse(root).success) {
      return { ok: false, error: (0, import_partner_sales_contracts16.partnerError)("INVALID_PAYLOAD") };
    }
    let observed;
    const policy = createPartnerAuthorizationV2({ read: async (actorId, actualRoot) => {
      observed = await source.read(actorId, actualRoot);
      return observed;
    } }, binding);
    let result = await policy.authorize(action, root);
    const evidence = observed;
    const isAdmin = Boolean(evidence?.actor.role === "ADMIN" && !evidence.actor.partnerProfile);
    if (result.ok && isAdmin && !readActions.has(action) && !audit.reason?.trim()) {
      result = { ok: false, error: (0, import_partner_sales_contracts16.partnerError)("FORBIDDEN") };
    }
    const [clock] = await tx.$queryRaw`SELECT clock_timestamp() AS now`;
    await appendAuthorizationDecision(tx, {
      domain: "PARTNER",
      actorId: binding.actorId,
      action,
      rootKind: root.kind,
      rootId: root.id,
      purpose: binding.purpose,
      channel: binding.channel,
      allowed: result.ok,
      isAdmin,
      code: result.ok ? "ALLOWED" : result.error.code,
      scope: result.ok ? result.value.scope : null,
      reason: audit.reason?.trim() || null,
      correlationId: audit.correlationId,
      authorizationRevision: evidence?.authorizationRevision ?? null,
      lifecycleRevision: evidence?.resource?.lifecycleRevision ?? null,
      assignmentId: evidence?.resource?.assignment?.assignmentId ?? null,
      assignmentRevision: evidence?.resource?.assignment?.revision ?? null,
      evaluatedAt: evidence ? new Date(evidence.evaluatedAt) : clock.now,
      evaluatedGrantIds: evidence?.grants.filter((grant) => grant.rootKind === root.kind && grant.purpose === binding.purpose).flatMap((grant) => grant.provenance ? [grant.provenance.grantId] : []) ?? []
    });
    return result;
  } };
}

// src/services/partnerSales/authorization/technicalRecovery.ts
function createPartnerTechnicalRecoveryAuthority(binding) {
  return async (tx, input) => {
    if (input.actorId !== binding.actorId) return { ok: false, error: (0, import_partner_sales_contracts17.partnerError)("NOT_FOUND") };
    await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions WHERE "draftId" = ${input.recoveryId} FOR UPDATE`;
    const session = await tx.salesContractEditSession.findUnique({
      where: { draftId: input.recoveryId },
      select: { ownerUserId: true, contractId: true }
    });
    if (!session || session.ownerUserId !== binding.actorId) {
      return { ok: false, error: (0, import_partner_sales_contracts17.partnerError)("NOT_FOUND") };
    }
    const profile = await tx.partnerProfile.findUnique({ where: { userId: binding.actorId }, select: { id: true } });
    if (!profile) return { ok: false, error: (0, import_partner_sales_contracts17.partnerError)("NOT_FOUND") };
    const port = createAuditedPartnerAuthorization(
      tx,
      { actorId: binding.actorId, purpose: "PARTNER", channel: "API" },
      { correlationId: binding.correlationId }
    );
    const contract = session.contractId ? await tx.salesContract.findUnique({
      where: { id: session.contractId },
      select: { partnerKind: true, partnerCase: { select: {
        id: true,
        state: true,
        profile: { select: { userId: true } }
      } } }
    }) : null;
    const boundCase = contract?.partnerCase;
    if (session.contractId && (contract?.partnerKind !== "PARTNER_CUSTOMER" || !boundCase || boundCase.profile.userId !== binding.actorId || !await partnerTechnicalCaseIsEditable(tx, {
      contractId: session.contractId,
      caseState: boundCase.state,
      actorId: binding.actorId
    }))) {
      return { ok: false, error: (0, import_partner_sales_contracts17.partnerError)("STATE_CONFLICT") };
    }
    const decision = await port.authorize(
      input.operation === "READ" ? "CASE_READ" : "CASE_DRAFT_WRITE",
      boundCase ? { kind: "CASE", id: boundCase.id } : { kind: "PROFILE", id: profile.id }
    );
    if (!decision.ok) return decision;
    return authorizePartnerTechnicalRollout(tx, profile.id, input.operation === "READ" ? "READ" : "MUTATE");
  };
}

// src/services/partnerSales/inquiries/ancillaryCharges.ts
var import_client12 = require("@prisma/client");
var record2 = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
var cutLabels = {
  "longitudinal-cut": "\u0628\u0631\u0634 \u0637\u0648\u0644\u06CC",
  longitudinalCutRateToman: "\u0628\u0631\u0634 \u0637\u0648\u0644\u06CC",
  "slab-cut-longitudinal": "\u0628\u0631\u0634 \u0637\u0648\u0644\u06CC",
  "cross-cut": "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC",
  crossCutRateToman: "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC",
  "slab-cut-cross": "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC",
  "calibration-cut": "\u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646",
  calibrationCutRateToman: "\u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646",
  "slab-cut-square-meter": "\u0628\u0631\u0634 \u0627\u0633\u0644\u0628 \u0628\u0631 \u0627\u0633\u0627\u0633 \u0645\u0633\u0627\u062D\u062A",
  "slab-cut-vertical": "\u0628\u0631\u0634 \u0639\u0645\u0648\u062F\u06CC \u0627\u0633\u0644\u0628"
};
var cutLabel = (id) => cutLabels[id];
function describeWholesaleAncillaryCharges(row, graph, pricing, mandatory, layerPolicies = /* @__PURE__ */ new Map()) {
  const charges = [];
  const add = (id, label, amount, quantity, unitPrice, unit) => {
    if (!label || typeof amount !== "string" || new import_client12.Prisma.Decimal(amount).lte(0)) return;
    const basis = typeof quantity === "string" && typeof unitPrice === "string" && unit ? { quantity, unitPrice, unit } : {};
    charges.push({ id, label, amount, ...basis });
  };
  const policy = readWholesaleMandatory(mandatory);
  const snapshot = row.commercial.calculationSnapshot;
  const mainLines = [
    ...Array.isArray(snapshot?.pricingLines) ? snapshot.pricingLines : [],
    ...Array.isArray(snapshot?.cuttingPricingLines) ? snapshot.cuttingPricingLines : []
  ];
  const seen = /* @__PURE__ */ new Set();
  for (const line of mainLines) {
    if (!record2(line) || typeof line.lineId !== "string" || seen.has(line.lineId)) continue;
    seen.add(line.lineId);
    const label = cutLabel(line.lineId);
    const mainCross = line.lineId === "cross-cut" || line.lineId === "crossCutRateToman";
    if (policy?.enabled && mainCross) continue;
    const restoreCross = policy?.enabled === false && mainCross && typeof line.quantity === "string" && typeof line.rateToman === "string";
    add(`cut:${line.lineId}`, label, restoreCross ? new import_client12.Prisma.Decimal(line.quantity).mul(line.rateToman).toFixed() : line.amountToman, line.quantity, line.rateToman, line.lineId === "slab-cut-square-meter" ? "squareMeter" : "meter");
  }
  const groups = new Set(graph.operationGroups.filter((group) => group.productRowId === row.productRowId).map((group) => group.operationGroupId));
  for (const tool of graph.toolSelections) if (groups.has(tool.operationGroupId)) add(tool.toolSelectionId, `\u0627\u0628\u0632\u0627\u0631: ${tool.name}`, tool.amountToman, tool.finalQuantity, tool.rateToman, tool.unit);
  for (const finish of graph.finishingSelections) if (groups.has(finish.operationGroupId)) add(finish.finishingSelectionId, `\u067E\u0631\u062F\u0627\u062E\u062A: ${finish.name}`, finish.amountToman, finish.finalQuantity, finish.rateToman, finish.unit);
  for (const layer of graph.layerConfigurations.filter((layer2) => layer2.parentProductRowId === row.productRowId)) {
    const title = layer.input.layerTitle;
    if (layer.input.source.kind !== "new-material") add(`${layer.layerConfigurationId}:material`, `\u0633\u0646\u06AF \u0645\u0635\u0631\u0641\u06CC \u0644\u0627\u06CC\u0647: ${title}`, layer.result.materialAmountToman, layer.result.materialPricingLine?.quantity, layer.result.materialPricingLine?.rateToman, "squareMeter");
    add(`${layer.layerConfigurationId}:service`, `\u0627\u062C\u0631\u0627\u06CC \u0644\u0627\u06CC\u0647: ${title}`, layer.result.layerAmountToman, layer.result.layerPricingLine.quantity, layer.result.layerPricingLine.rateToman, layer.input.layerUnit);
    const layerPolicy = layer.input.source.kind === "new-material" ? layer.input.source.catalogProductId === row.catalogProductId ? policy : readWholesaleMandatory(layerPolicies.get(layer.layerConfigurationId)) : void 0;
    for (const line of layer.result.cuttingPricingLines) {
      const kind = line.lineId.endsWith(":cut:cross") ? "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC" : line.lineId.endsWith(":cut:longitudinal") ? "\u0628\u0631\u0634 \u0637\u0648\u0644\u06CC" : line.lineId.endsWith(":cut:calibration") ? "\u06A9\u0627\u0644\u06CC\u0628\u0631\u0627\u0633\u06CC\u0648\u0646" : void 0;
      if (kind === "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC" && layerPolicy?.enabled) continue;
      const amount = kind === "\u0628\u0631\u0634 \u0639\u0631\u0636\u06CC" && layerPolicy?.enabled === false ? new import_client12.Prisma.Decimal(line.quantity).mul(line.rateToman).toFixed() : line.amountToman;
      add(line.lineId, kind ? `${kind} \u0644\u0627\u06CC\u0647: ${title}` : void 0, amount, line.quantity, line.rateToman, "meter");
    }
    for (const side of layer.result.sideOperationResults) {
      for (const tool of side.result.tools) add(`${layer.layerConfigurationId}:${tool.toolSelectionId}`, `\u0627\u0628\u0632\u0627\u0631 \u0644\u0627\u06CC\u0647 ${title}: ${tool.name}`, tool.amountToman, tool.finalQuantity, tool.rateToman, tool.unit);
      for (const finish of side.result.finishings) add(`${layer.layerConfigurationId}:${finish.finishingSelectionId}`, `\u067E\u0631\u062F\u0627\u062E\u062A \u0644\u0627\u06CC\u0647 ${title}: ${finish.name}`, finish.amountToman, finish.finalQuantity, finish.rateToman, finish.unit);
    }
  }
  const total = charges.reduce((amount, charge) => amount.plus(charge.amount), new import_client12.Prisma.Decimal(0));
  return total.eq(pricing.componentAmount) ? charges : void 0;
}

// src/services/partnerSales/reporting/money.ts
function sum(values) {
  const scale = Math.max(0, ...values.map((value) => (value.split(".")[1] || "").length));
  let total = 0n;
  for (const value of values) {
    if (!/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) throw new Error("Invalid decimal");
    const negative2 = value.startsWith("-");
    const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
    const integer = BigInt(whole + fraction.padEnd(scale, "0"));
    total += negative2 ? -integer : integer;
  }
  const negative = total < 0n;
  let digits = (negative ? -total : total).toString().padStart(scale + 1, "0");
  if (scale) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/0+$/, "").replace(/\.$/, "");
  return negative ? `-${digits}` : digits;
}
function multiply(left, right) {
  const a = sum([left]), b = sum([right]);
  const scale = (a.split(".")[1]?.length ?? 0) + (b.split(".")[1]?.length ?? 0);
  const units = BigInt(a.replace(".", "")) * BigInt(b.replace(".", ""));
  const digits = (units < 0n ? -units : units).toString().padStart(scale + 1, "0");
  return sum([`${units < 0n ? "-" : ""}${scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits}`]);
}

// src/services/partnerSales/inquiries/adapters.ts
var import_partner_sales_contracts19 = require("@sabalanerp/partner-sales-contracts");
var import_client13 = require("@prisma/client");

// src/services/partnerSales/cases/submissionEvidence.ts
var import_partner_sales_contracts18 = require("@sabalanerp/partner-sales-contracts");
var SUBMISSION_EVIDENCE_OPERATION = "PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1";
async function readSubmittedTechnicalSnapshots(tx, actorId, recoveryId) {
  const row = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
    actorId,
    operation: SUBMISSION_EVIDENCE_OPERATION,
    targetScope: recoveryId,
    key: "v1"
  } } });
  if (!row) return void 0;
  if (await (0, import_partner_sales_contracts18.canonicalHash)(row.outcome) !== row.payloadHash) throw new Error("Partner submission evidence integrity conflict");
  const evidence = row.outcome;
  if (evidence?.schemaVersion !== 1 || !Array.isArray(evidence.validatedSnapshots)) {
    throw new Error("Partner submission evidence integrity conflict");
  }
  return evidence.validatedSnapshots;
}

// src/services/partnerSales/inquiries/adapters.ts
var familyLabels = {
  longitudinal: "\u0637\u0648\u0644\u06CC",
  stair: "\u067E\u0644\u0647",
  slab: "\u0627\u0633\u0644\u0628",
  prepared: "\u0622\u0645\u0627\u062F\u0647",
  volumetric: "\u062D\u062C\u0645\u06CC"
};
function presentSavedTechnicalConfiguration(input) {
  const { product, draftRow } = input;
  const facts = [];
  const add = (label, value, suffix = "") => {
    if (value === void 0 || value === null || value === "") return;
    facts.push({ label, value: `${String(value)}${suffix}` });
  };
  add("\u062E\u0627\u0646\u0648\u0627\u062F\u0647 \u0645\u062D\u0635\u0648\u0644", familyLabels[input.family] ?? input.family);
  add("\u06A9\u062F \u0645\u062D\u0635\u0648\u0644", product.code);
  add("\u0645\u0633\u0627\u062D\u062A", input.areaSquareMeters, " \u0645\u062A\u0631 \u0645\u0631\u0628\u0639");
  add("\u0646\u0648\u0639 \u0633\u0646\u06AF", product.attributes.stoneType);
  add("\u0636\u062E\u0627\u0645\u062A", product.dimensions.thicknessCentimeters, " \u0633\u0627\u0646\u062A\u06CC\u200C\u0645\u062A\u0631");
  if (draftRow?.family === "prepared" || draftRow?.family === "volumetric") {
    if (draftRow.configuration.unit === "count") add("\u062A\u0639\u062F\u0627\u062F", draftRow.configuration.quantity, " \u0639\u062F\u062F");
    add("\u0627\u0628\u0639\u0627\u062F \u06A9\u0627\u062A\u0627\u0644\u0648\u06AF\u06CC", product.attributes.cuttingDimension);
    add("\u0637\u0648\u0644", product.dimensions.motherLengthMeters, " \u0645\u062A\u0631");
    add("\u0639\u0631\u0636", product.dimensions.motherWidthCentimeters, " \u0633\u0627\u0646\u062A\u06CC\u200C\u0645\u062A\u0631");
  } else if (draftRow?.family === "longitudinal") {
    add("\u062A\u0639\u062F\u0627\u062F", draftRow.configuration.quantity, " \u0639\u062F\u062F");
    add("\u0637\u0648\u0644", draftRow.configuration.lengthMeters, " \u0645\u062A\u0631");
    add("\u0639\u0631\u0636", draftRow.configuration.widthMeters, " \u0645\u062A\u0631");
  } else if (draftRow?.family === "slab") {
    add("\u062A\u0639\u062F\u0627\u062F", draftRow.configuration.quantity, " \u0639\u062F\u062F");
    add("\u0637\u0648\u0644", draftRow.configuration.lengthMeters, " \u0645\u062A\u0631");
    add("\u0639\u0631\u0636", draftRow.configuration.widthMeters, " \u0645\u062A\u0631");
  } else if (draftRow?.family === "stair") {
    if (draftRow.configuration.quantity !== void 0) add("\u062A\u0639\u062F\u0627\u062F", draftRow.configuration.quantity, " \u0639\u062F\u062F");
    add("\u0637\u0648\u0644", draftRow.configuration.lengthMeters, " \u0645\u062A\u0631");
    add(
      draftRow.configuration.part === "riser" ? "\u0627\u0631\u062A\u0641\u0627\u0639" : "\u0639\u0631\u0636",
      draftRow.configuration.crossDimensionMeters,
      " \u0645\u062A\u0631"
    );
  }
  if ((draftRow?.family === "longitudinal" || draftRow?.family === "stair") && input.technicalPolicy) {
    add("\u062D\u06A9\u0645\u06CC", draftRow.configuration.mandatoryEnabled ?? input.technicalPolicy.mandatoryEnabled ? `\u0641\u0639\u0627\u0644 \xB7 ${draftRow.configuration.mandatoryPercentage ?? input.technicalPolicy.mandatoryPercentage}\u066A` : "\u063A\u06CC\u0631\u0641\u0639\u0627\u0644");
  }
  const remainder = input.dependents?.find((dependent) => dependent.kind === "remainder" && dependent.productRowId === input.productRowId);
  if (!draftRow && remainder?.kind === "remainder") {
    add("\u0637\u0648\u0644", remainder.lengthMeters, " \u0645\u062A\u0631");
    add("\u0639\u0631\u0636", remainder.widthMeters, " \u0645\u062A\u0631");
  }
  const layerSides = {
    front: "\u062C\u0644\u0648",
    back: "\u0639\u0642\u0628",
    left: "\u0686\u067E",
    right: "\u0631\u0627\u0633\u062A"
  };
  input.dependents?.filter((dependent) => dependent.kind === "layer" && dependent.parentProductRowId === input.productRowId).forEach((layer) => {
    if (layer.kind !== "layer") return;
    const catalog = input.operations.find((item) => item.kind === "LAYER" && item.catalogItemId === layer.catalogItemId);
    const details = [
      catalog?.name ?? "\u0644\u0627\u06CC\u0647",
      layer.layersPerParentPiece ? `${layer.layersPerParentPiece} \u0644\u0627\u06CC\u0647 \u0628\u0631\u0627\u06CC \u0647\u0631 \u067E\u0644\u0647` : null,
      layer.widthMeters ? `\u0639\u0631\u0636 ${layer.widthMeters} \u0645\u062A\u0631` : null,
      layer.targetSides.length ? layer.targetSides.map((side) => layerSides[side]).join("\u060C ") : null
    ].filter(Boolean);
    add("\u0644\u0627\u06CC\u0647", details.join(" \xB7 "));
  });
  const groupIds = new Set(input.graphOperations?.operationGroups.filter((group) => String(group.productRowId) === input.productRowId).map((group) => String(group.operationGroupId)) ?? []);
  const operationFact = (label, selection) => {
    if (!groupIds.has(String(selection.operationGroupId))) return;
    const catalog = input.operations.find((item) => item.catalogItemId === String(selection.catalogItemId));
    if (!catalog) return;
    const unit = catalog.unit === "meter" ? "\u0645\u062A\u0631" : "\u0645\u062A\u0631\u0645\u0631\u0628\u0639";
    add(label, `${catalog.name} \xB7 ${selection.finalQuantity} ${unit}`);
  };
  input.graphOperations?.toolSelections.forEach((selection) => operationFact("\u0627\u0628\u0632\u0627\u0631", selection));
  input.graphOperations?.finishingSelections.forEach((selection) => operationFact("\u067E\u0631\u062F\u0627\u062E\u062A", selection));
  return facts;
}
var savedHistoryCache = () => ({ histories: /* @__PURE__ */ new Map(), revisions: /* @__PURE__ */ new Map() });
function createSavedTechnicalConfigurationResolver() {
  const transactions = /* @__PURE__ */ new WeakMap();
  return (tx, input) => {
    let cache = transactions.get(tx);
    if (!cache) {
      cache = savedHistoryCache();
      transactions.set(tx, cache);
    }
    return resolveSavedConfiguration(tx, input, cache);
  };
}
var resolveSavedTechnicalConfiguration = (tx, input) => resolveSavedConfiguration(tx, input);
async function resolveSavedConfiguration(tx, input, cache = savedHistoryCache()) {
  const key2 = JSON.stringify([input.actorId, input.reference.recoveryId]);
  let reading = cache.histories.get(key2);
  if (!reading) {
    reading = (async () => {
      const session = await tx.salesContractEditSession.findUnique({
        where: { draftId: input.reference.recoveryId },
        select: { ownerUserId: true, recovery: true }
      });
      if (session && session.ownerUserId !== input.actorId) return void 0;
      const history2 = session?.recovery && typeof session.recovery === "object" && !Array.isArray(session.recovery) ? session.recovery.validatedSnapshots : await readSubmittedTechnicalSnapshots(tx, input.actorId, input.reference.recoveryId);
      if (!Array.isArray(history2)) return void 0;
      return history2;
    })();
    cache.histories.set(key2, reading);
  }
  const revisionKey = JSON.stringify([input.actorId, input.reference.recoveryId, input.reference.recoveryRevision]);
  let verifying = cache.revisions.get(revisionKey);
  if (!verifying) {
    verifying = (async () => {
      const records = await reading;
      if (!records) return void 0;
      const candidates = records.filter((record3) => record3?.payload?.view?.recoveryRevision === input.reference.recoveryRevision);
      const decoded = await Promise.all(candidates.map((record3) => decodeTechnicalSavedSnapshot(record3)));
      return decoded.filter((record3) => record3 !== void 0);
    })();
    cache.revisions.set(revisionKey, verifying);
  }
  const history = await verifying;
  if (!history) return { ok: false, error: (0, import_partner_sales_contracts19.partnerError)("NOT_FOUND") };
  for (const snapshot of history) {
    if (!snapshot || snapshot.view.recoveryRevision !== input.reference.recoveryRevision) continue;
    const saved = snapshot.view.rows.find((row) => row.configurationRef.productRowId === input.reference.productRowId);
    const identity = snapshot.identities.find((row) => row.productRowId === input.reference.productRowId)?.identity;
    const graphRow = snapshot.graph.rows.find((row) => row.productRowId === input.reference.productRowId);
    const context = snapshot.context;
    const product = context.catalog?.products?.find((row) => row.catalogItemId === identity?.catalogProductId);
    const draftRow = snapshot.draft.rows.find((row) => row.productRowId === input.reference.productRowId);
    if (input.reference.productRowId.startsWith("layer-material:")) {
      const layerId = input.reference.productRowId.slice("layer-material:".length);
      const layer = snapshot.draft.dependents?.find((item) => item.kind === "layer" && item.layerConfigurationId === layerId);
      if (!identity || !layer || layer.kind !== "layer" || layer.source?.kind !== "new-material" || layer.source.catalogItemId !== identity.catalogProductId || typeof product?.name !== "string" || typeof product.code !== "string") {
        return { ok: false, error: (0, import_partner_sales_contracts19.partnerError)("INTEGRITY_CONFLICT") };
      }
      const frozenLayer = snapshot.graph.layerConfigurations.find((item) => item.layerConfigurationId === layerId);
      if (!frozenLayer) return { ok: false, error: (0, import_partner_sales_contracts19.partnerError)("INTEGRITY_CONFLICT") };
      const strips = frozenLayer.result.physicalStrips;
      return { ok: true, value: {
        identity,
        description: product.name,
        quoteWholesale: (rate, mandatory) => {
          const policy = readWholesaleMandatory(mandatory);
          if (!policy) return void 0;
          const materialAmount = multiply(frozenLayer.result.materialSourceSplit.newMaterialSquareMeters, rate);
          const amount = policy.enabled ? multiply(materialAmount, new import_client13.Prisma.Decimal(policy.percentage).div(100).toFixed()) : "0";
          return {
            materialAmount,
            componentAmount: "0",
            totalAmount: sum([materialAmount, amount]),
            mandatoryCharges: policy.enabled ? [{ subjectId: input.reference.productRowId, basisAmount: materialAmount, percentage: policy.percentage, amount }] : []
          };
        },
        measures: {
          lengthMeters: sum(strips.map((strip) => multiply(strip.lengthMeters, String(strip.quantity)))),
          areaSquareMeters: sum(strips.map((strip) => multiply(multiply(strip.lengthMeters, strip.widthMeters), String(strip.quantity)))),
          count: String(frozenLayer.result.physicalStripCount),
          consumedAreaSquareMeters: frozenLayer.result.materialSourceSplit.newMaterialSquareMeters
        },
        mandatoryDefaultPercentage: import_partner_sales_contracts19.WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE,
        configuration: [
          { label: "\u06A9\u062F \u0633\u0646\u06AF", value: product.code },
          { label: "\u06A9\u0627\u0631\u0628\u0631\u062F", value: "\u0633\u0646\u06AF \u062C\u062F\u06CC\u062F \u0644\u0627\u06CC\u0647" },
          { label: "\u062A\u0639\u062F\u0627\u062F", value: `${frozenLayer.result.physicalStripCount} \u0639\u062F\u062F` },
          { label: "\u0633\u0646\u06AF \u0627\u0635\u0644\u06CC", value: product.name },
          { label: "\u0645\u062A\u0631\u0627\u0698 \u0633\u0646\u06AF \u0645\u0635\u0631\u0641\u06CC \u0627\u0635\u0644\u06CC", value: `${frozenLayer.result.materialSourceSplit.newMaterialSquareMeters} \u0645\u062A\u0631 \u0645\u0631\u0628\u0639` }
        ]
      } };
    }
    if (!saved || !identity || !graphRow || saved.configurationRef.recoveryId !== input.reference.recoveryId || saved.configurationRef.recoveryRevision !== input.reference.recoveryRevision || typeof product?.name !== "string" || typeof product.code !== "string") return { ok: false, error: (0, import_partner_sales_contracts19.partnerError)("INTEGRITY_CONFLICT") };
    const paidChild = snapshot.draft.dependents?.find((item) => item.kind === "remainder" && item.productRowId === graphRow.productRowId);
    const childFacts = (snapshot.draft.dependents ?? []).flatMap((child) => {
      if (child.kind !== "remainder" || child.sourceProductRowId !== graphRow.productRowId) return [];
      const childProduct = context.catalog?.products?.find((item) => item.catalogItemId === child.catalogItemId && item.catalogSnapshotVersion === child.catalogSnapshotVersion);
      if (!childProduct) return [];
      const details = presentSavedTechnicalConfiguration({
        productRowId: child.productRowId,
        family: "longitudinal",
        product: childProduct,
        dependents: snapshot.draft.dependents,
        operations: context.catalog?.operations ?? [],
        graphOperations: snapshot.graph
      });
      return [
        { label: "\u0641\u0631\u0632\u0646\u062F \u0627\u0632 \u0633\u0646\u06AF \u067E\u0631\u062F\u0627\u062E\u062A\u200C\u0634\u062F\u0647", value: childProduct.name },
        ...details.map((fact) => ({ label: `\u0641\u0631\u0632\u0646\u062F \xB7 ${fact.label}`, value: fact.value }))
      ];
    });
    return { ok: true, value: {
      identity,
      description: product.name,
      quoteWholesale: (rate, mandatory, layerQuotes) => {
        const rates = /* @__PURE__ */ new Map(), policies = /* @__PURE__ */ new Map();
        for (const [subjectId, quote] of layerQuotes) {
          rates.set(quote.catalogProductId, quote.rateToman);
          policies.set(subjectId.replace(/^layer-material:/, ""), quote.mandatory);
        }
        const pricing = calculatePartnerCanonicalWholesale(graphRow, paidChild ? "0" : rate, snapshot.graph.layerConfigurations, rates, mandatory, policies).wholesalePricing;
        if (!pricing) return void 0;
        const ancillaryCharges = describeWholesaleAncillaryCharges(graphRow, snapshot.graph, pricing, mandatory, policies);
        return { ...pricing, ...ancillaryCharges ? { ancillaryCharges } : {} };
      },
      measures: {
        ...graphRow.commercial.requestedLengthMeters ? { lengthMeters: multiply(
          graphRow.commercial.requestedLengthMeters,
          graphRow.commercial.calculationSnapshot?.quantityMode === "total-linear-meters" ? "1" : graphRow.commercial.requestedQuantity ?? "1"
        ) } : {},
        ...graphRow.commercial.requestedAreaSquareMeters ? { areaSquareMeters: graphRow.commercial.requestedAreaSquareMeters } : {},
        ...graphRow.commercial.requestedQuantity && (!["prepared", "volumetric"].includes(graphRow.productType) || identity.unit === "count") ? { count: graphRow.commercial.requestedQuantity } : {},
        ...identity.unit === "squareMeter" && graphRow.commercial.calculationSnapshot?.partnerPricingBasis === "ordinary-sale-v1" && ["longitudinal", "slab", "stair"].includes(graphRow.productType) ? { consumedAreaSquareMeters: partnerQuotedQuantity(graphRow).toFixed() } : {}
      },
      mandatoryDefaultPercentage: import_partner_sales_contracts19.WHOLESALE_MANDATORY_DEFAULT_PERCENTAGE,
      ...paidChild?.kind === "remainder" ? { paidSourceProductRowId: paidChild.sourceProductRowId } : {},
      configuration: [
        ...presentSavedTechnicalConfiguration({
          productRowId: input.reference.productRowId,
          family: identity.family,
          product,
          draftRow,
          areaSquareMeters: graphRow.commercial?.requestedAreaSquareMeters,
          dependents: snapshot.draft.dependents,
          operations: context.catalog?.operations ?? [],
          graphOperations: snapshot.graph,
          technicalPolicy: context.technicalPolicy
        }),
        { label: "\u0633\u0646\u06AF \u0627\u0635\u0644\u06CC", value: product.name },
        ...identity.unit === "squareMeter" && ["longitudinal", "slab", "stair"].includes(graphRow.productType) ? [{ label: "\u0645\u062A\u0631\u0627\u0698 \u0633\u0646\u06AF \u0645\u0635\u0631\u0641\u06CC \u0627\u0635\u0644\u06CC", value: `${partnerQuotedQuantity(graphRow).toFixed()} \u0645\u062A\u0631 \u0645\u0631\u0628\u0639` }] : [],
        ...childFacts
      ]
    } };
  }
  return { ok: false, error: (0, import_partner_sales_contracts19.partnerError)("NOT_FOUND") };
}

// src/services/__tests__/partnerTechnicalRecovery.integration.test.ts
function localDatabaseUrl() {
  const value = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL;
  if (!value) throw new Error("Explicit existing local recovery test database required");
  const url = new URL(value);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "postgres"].includes(url.hostname) || url.pathname !== "/sabalanerp") {
    throw new Error("Non-local recovery test database refused");
  }
  url.searchParams.set("connection_limit", "2");
  url.searchParams.set("pool_timeout", "10");
  return url.toString();
}
async function fixture(run) {
  const database = new import_client14.PrismaClient({ datasources: { db: { url: localDatabaseUrl() } } });
  const rollback = new Error("successful test rollback");
  try {
    await database.$transaction(async (tx) => {
      const actorId = `technical-recovery-${(0, import_node_crypto4.randomUUID)()}`;
      const access = {
        schemaVersion: 1,
        recoveryId: actorId,
        browserSessionId: "test-browser",
        leaseToken: (0, import_node_crypto4.randomUUID)(),
        baseRevision: 0
      };
      await tx.salesContractEditSession.create({ data: {
        draftId: actorId,
        ownerUserId: actorId,
        browserSessionId: access.browserSessionId,
        leaseToken: access.leaseToken,
        schemaVersion: 2,
        baseRevision: 0,
        purpose: "PARTNER_TECHNICAL"
      } });
      await run(tx, actorId, access);
      throw rollback;
    }, { timeout: 2e4 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await database.$disconnect();
  }
}
(0, import_node_test.default)("incomplete technical input is durably acknowledged and can be read by a new service instance without issuing configuration refs", async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "save-1",
      draft: {
        schemaVersion: 1,
        inputRevision: 4,
        rows: [],
        editingValues: [{ entityId: "new-row", field: "quantity", text: "\u06F2\u066B" }]
      }
    };
    const saved = await service.checkpoint(command);
    if (!saved.ok) throw new Error(saved.error.code);
    import_strict.default.equal(saved.value.recoveryRevision, 1);
    import_strict.default.equal(saved.value.inputRevision, 4);
    import_strict.default.equal(saved.value.replayed, false);
    import_strict.default.equal("configurationRef" in saved.value, false);
    const loaded = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!loaded.ok) throw new Error(loaded.error.code);
    import_strict.default.equal(loaded.value.recoveryRevision, 1);
    import_strict.default.deepEqual(loaded.value.draft, command.draft);
  });
});
(0, import_node_test.default)("real pre-Case authority binds creator-private recovery to the current Partner lifecycle without an allow-all fixture", async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: {
      id: actorId,
      username: actorId,
      email: `${actorId}@example.invalid`,
      password: "not-a-login",
      firstName: "Fixture",
      lastName: "Technical authority"
    } });
    await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: "ACTIVE" } });
    await tx.partnerReleaseCohort.create({ data: {
      id: actorId,
      name: actorId,
      activationEnabled: true,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerOperationsControl.update({ where: { id: "partner-operations" }, data: {
      cohortId: actorId,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerCohortMembership.create({ data: {
      id: actorId,
      profileId: actorId,
      cohortId: actorId,
      actorId,
      eligibilityEvidence: { fixture: true }
    } });
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: createPartnerTechnicalRecoveryAuthority({ actorId, correlationId: "technical-authority-test" })
    };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "current-profile",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [], editingValues: [{ entityId: "draft-row", field: "quantity", text: "\u06F2\u066B" }] }
    };
    import_strict.default.equal((await service.checkpoint(command)).ok, true);
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: "SUSPENDED", revision: { increment: 1 } } });
    const loaded = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    import_strict.default.equal(loaded.ok, true, "suspension keeps creator-private read access");
    if (loaded.ok) import_strict.default.deepEqual(loaded.value.draft, command.draft);
    const denied = await service.checkpoint(command);
    import_strict.default.equal(denied.ok ? null : denied.error.code, "PARTNER_NOT_ACTIVE", "even a receipt replay reauthorizes current mutation rights");
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: "TERMINATED", revision: { increment: 1 } } });
    import_strict.default.equal((await service.read(access)).ok, true, "terminated creators retain private recovery read access");
    import_strict.default.equal((await service.checkpoint(command)).ok, false, "termination still blocks writes");
  });
});
(0, import_node_test.default)("pre-Case technical authority rejects internal ADMIN, pending identity, foreign recovery ids and inactive creators", async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: {
      id: actorId,
      username: actorId,
      email: `${actorId}@example.invalid`,
      password: "not-a-login",
      firstName: "Fixture",
      lastName: "Technical denial",
      role: "ADMIN"
    } });
    const authorize = createPartnerTechnicalRecoveryAuthority({ actorId, correlationId: "technical-denial-test" });
    const request = { actorId, recoveryId: access.recoveryId, operation: "SAVE" };
    import_strict.default.equal((await authorize(tx, request)).ok, false, "internal ADMIN cannot author Partner technical input");
    await tx.partnerProfile.create({ data: { id: actorId, userId: actorId, state: "PENDING" } });
    import_strict.default.equal((await authorize(tx, request)).ok, false, "pending identity is onboarding-only");
    await tx.partnerProfile.update({ where: { id: actorId }, data: { state: "ACTIVE", revision: { increment: 1 } } });
    import_strict.default.equal((await authorize(tx, request)).ok, false, "active identity outside a release cohort cannot write");
    import_strict.default.equal(
      (await authorize(tx, { ...request, operation: "READ" })).ok,
      false,
      "active identity outside a release cohort cannot read the mounted technical surface"
    );
    await tx.partnerReleaseCohort.create({ data: {
      id: actorId,
      name: actorId,
      activationEnabled: true,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerOperationsControl.update({ where: { id: "partner-operations" }, data: {
      cohortId: actorId,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerCohortMembership.create({ data: {
      id: actorId,
      profileId: actorId,
      cohortId: actorId,
      actorId,
      eligibilityEvidence: { fixture: true }
    } });
    import_strict.default.equal((await authorize(tx, request)).ok, true, "own active Partner bundle, even with a stray legacy role");
    import_strict.default.equal((await authorize(tx, { ...request, actorId: "forged-actor" })).ok, false);
    await tx.salesContractEditSession.create({ data: {
      draftId: `foreign-${actorId}`,
      ownerUserId: "another-creator",
      browserSessionId: "other-browser",
      leaseToken: (0, import_node_crypto4.randomUUID)(),
      schemaVersion: 2,
      baseRevision: 0
    } });
    const foreign = await authorize(tx, { ...request, recoveryId: `foreign-${actorId}` });
    import_strict.default.deepEqual(foreign, await authorize(tx, { ...request, recoveryId: `missing-${actorId}` }));
    await tx.user.update({ where: { id: actorId }, data: { isActive: false } });
    import_strict.default.equal((await authorize(tx, request)).ok, false);
  });
});
(0, import_node_test.default)("real database policy and private catalog evidence produce a validated safe reference without exposing rates", async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: {
      id: actorId,
      username: actorId,
      email: `${actorId}@example.invalid`,
      password: "not-a-login",
      firstName: "Fixture",
      lastName: "Technical evidence"
    } });
    await tx.partnerProfile.create({ data: {
      id: actorId,
      userId: actorId,
      state: "ACTIVE",
      commercialAccount: { create: { id: actorId } }
    } });
    await tx.partnerReleaseCohort.create({ data: {
      id: actorId,
      name: actorId,
      activationEnabled: true,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerOperationsControl.update({ where: { id: "partner-operations" }, data: {
      cohortId: actorId,
      enrollmentPaused: false,
      operationalPaused: false
    } });
    await tx.partnerCohortMembership.create({ data: {
      id: actorId,
      profileId: actorId,
      cohortId: actorId,
      actorId,
      eligibilityEvidence: { fixture: true }
    } });
    const product = await tx.product.create({ data: {
      id: actorId,
      code: actorId,
      name: actorId,
      namePersian: "\u0633\u0646\u06AF \u062A\u0633\u062A \u0641\u0646\u06CC",
      cuttingDimensionCode: "technical",
      cuttingDimensionName: "technical",
      cuttingDimensionNamePersian: "\u0641\u0646\u06CC",
      stoneTypeCode: "technical",
      stoneTypeName: "technical",
      stoneTypeNamePersian: "\u062A\u0631\u0627\u0648\u0631\u062A\u0646",
      widthCode: "40",
      widthValue: "40",
      widthName: "40",
      motherLengthValue: "2",
      thicknessCode: "2",
      thicknessValue: "2",
      thicknessName: "2",
      mineCode: "technical",
      mineName: "technical",
      mineNamePersian: "\u0645\u0639\u062F\u0646 \u062A\u0633\u062A",
      finishCode: "technical",
      finishName: "technical",
      finishNamePersian: "\u0633\u0627\u0628\u06CC\u062F\u0647",
      colorCode: "technical",
      colorName: "technical",
      colorNamePersian: "\u06A9\u0631\u0645",
      qualityCode: "technical",
      qualityName: "technical",
      qualityNamePersian: "\u062F\u0631\u062C\u0647 \u06CC\u06A9",
      basePrice: "12000000",
      images: []
    } });
    const terms = {
      schemaVersion: 1,
      purpose: "PARTNER_TECHNICAL_PRICING",
      calculationPolicy: { calculation: "calculation-v1", packing: "packing-v1", pricing: "pricing-v1", rounding: "rounding-v2" },
      mandatoryPercentage: "20",
      mandatoryEnabled: true,
      slabCuttingPricingMethod: "lineBased",
      sawKerfMeters: "0.005",
      materialRateScale: "0.1",
      currency: "IRT",
      rates: {
        longitudinalCutRateToman: "1200",
        crossCutRateToman: "1400",
        calibrationCutRateToman: "900",
        verticalCutRateToman: "1600",
        squareMeterCutRateToman: "4500"
      }
    };
    const effectiveDate = /* @__PURE__ */ new Date("2026-08-29T00:00:00.000Z");
    const integrityHash = await (0, import_partner_sales_contracts20.canonicalHash)({
      accountId: actorId,
      version: 1,
      effectiveDate: "2026-08-29",
      terms,
      actorId,
      reason: "\u0633\u06CC\u0627\u0633\u062A \u0641\u0646\u06CC \u062A\u0633\u062A \u062A\u0631\u0627\u06A9\u0646\u0634\u06CC"
    });
    await tx.partnerCommercialTerms.create({ data: {
      id: actorId,
      accountId: actorId,
      version: 1,
      effectiveDate,
      terms,
      integrityHash,
      actorId,
      reason: "\u0633\u06CC\u0627\u0633\u062A \u0641\u0646\u06CC \u062A\u0633\u062A \u062A\u0631\u0627\u06A9\u0646\u0634\u06CC"
    } });
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: createPartnerTechnicalRecoveryAuthority({ actorId, correlationId: "real-technical-evidence" }),
      resolveEvidence: createPartnerTechnicalEvidenceResolver()
    };
    const result = await createPartnerTechnicalSaveService(dependencies).save({
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "real-evidence",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [{
        productRowId: "prepared-row",
        catalogItemId: product.id,
        catalogSnapshotVersion: product.updatedAt.toISOString(),
        family: "prepared",
        configuration: { kind: "readyPiece", unit: "count", quantity: "2" }
      }] }
    });
    if (!result.ok) throw new Error(result.error.code);
    import_strict.default.equal(result.value.rows[0].quantity, "2");
    import_strict.default.equal(JSON.stringify(result.value).includes("1200000"), false);
    import_strict.default.equal(JSON.stringify(result.value).includes("mandatoryPercentage"), false);
    const returned = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!returned.ok) throw new Error(returned.error.code);
    import_strict.default.equal(returned.value.retainedCatalog?.products[0]?.catalogItemId, product.id);
    import_strict.default.deepEqual(
      returned.value.retainedCatalog?.products[0]?.suggestedRetailUnitPrice,
      { amount: "1200000", currency: "IRT" }
    );
    import_strict.default.equal(JSON.stringify(returned.value.retainedCatalog).includes("mandatoryPercentage"), false);
    const inquiryConfiguration = await resolveSavedTechnicalConfiguration(tx, {
      actorId,
      reference: result.value.rows[0].configurationRef
    });
    import_strict.default.equal(inquiryConfiguration.ok, true);
    let snapshotReads = 0;
    const snapshotTx = () => new Proxy(tx, { get(target, key2) {
      if (key2 === "salesContractEditSession") return new Proxy(target.salesContractEditSession, { get(model, method) {
        if (method === "findUnique") return (...args) => {
          snapshotReads++;
          return model.findUnique(...args);
        };
        return Reflect.get(model, method);
      } });
      return Reflect.get(target, key2);
    } });
    const resolver = createSavedTechnicalConfigurationResolver();
    const firstSnapshot = snapshotTx();
    const reference = result.value.rows[0].configurationRef;
    const repeated = await Promise.all([resolver(firstSnapshot, { actorId, reference }), resolver(firstSnapshot, { actorId, reference })]);
    import_strict.default.ok(repeated.every((item) => item.ok));
    import_strict.default.equal(snapshotReads, 1, "multiple row resolutions share one verified history read");
    import_strict.default.equal((await resolver(snapshotTx(), { actorId, reference })).ok, true);
    import_strict.default.equal(snapshotReads, 2, "another transaction must reread current evidence");
    import_strict.default.equal(
      (await resolver(firstSnapshot, { actorId: `foreign-${actorId}`, reference })).ok,
      false,
      "cached evidence cannot cross the actor boundary"
    );
    if (inquiryConfiguration.ok) {
      import_strict.default.equal(inquiryConfiguration.value.description, "\u0633\u0646\u06AF \u062A\u0633\u062A \u0641\u0646\u06CC");
      import_strict.default.equal(inquiryConfiguration.value.measures?.count, "2");
      import_strict.default.equal(inquiryConfiguration.value.mandatoryDefaultPercentage, "20");
      import_strict.default.equal(inquiryConfiguration.value.identity.catalogProductId, product.id);
      import_strict.default.deepEqual(inquiryConfiguration.value.configuration.filter((item) => ["\u062E\u0627\u0646\u0648\u0627\u062F\u0647 \u0645\u062D\u0635\u0648\u0644", "\u06A9\u062F \u0645\u062D\u0635\u0648\u0644", "\u0627\u0628\u0639\u0627\u062F \u06A9\u0627\u062A\u0627\u0644\u0648\u06AF\u06CC", "\u0637\u0648\u0644", "\u0639\u0631\u0636"].includes(item.label)), [
        { label: "\u062E\u0627\u0646\u0648\u0627\u062F\u0647 \u0645\u062D\u0635\u0648\u0644", value: "\u0622\u0645\u0627\u062F\u0647" },
        { label: "\u06A9\u062F \u0645\u062D\u0635\u0648\u0644", value: product.code },
        { label: "\u0627\u0628\u0639\u0627\u062F \u06A9\u0627\u062A\u0627\u0644\u0648\u06AF\u06CC", value: "\u0641\u0646\u06CC" },
        { label: "\u0637\u0648\u0644", value: "2 \u0645\u062A\u0631" },
        { label: "\u0639\u0631\u0636", value: "40 \u0633\u0627\u0646\u062A\u06CC\u200C\u0645\u062A\u0631" }
      ]);
      import_strict.default.deepEqual(
        inquiryConfiguration.value.configuration.find((item) => item.label === "\u062A\u0639\u062F\u0627\u062F"),
        { label: "\u062A\u0639\u062F\u0627\u062F", value: "2 \u0639\u062F\u062F" }
      );
      import_strict.default.equal(JSON.stringify(inquiryConfiguration.value).includes("12000000"), false);
      import_strict.default.equal(JSON.stringify(inquiryConfiguration.value).includes("mandatoryPercentage"), false);
    }
  });
});
(0, import_node_test.default)("a checkpointed longitudinal Partner row with no catalog price saves its entered price on next step", async () => {
  await fixture(async (tx, actorId, access) => {
    await tx.user.create({ data: {
      id: actorId,
      username: actorId,
      email: `${actorId}@example.invalid`,
      password: "not-a-login",
      firstName: "Fixture",
      lastName: "Longitudinal evidence"
    } });
    await tx.partnerProfile.create({ data: {
      id: actorId,
      userId: actorId,
      state: "ACTIVE",
      commercialAccount: { create: { id: actorId } }
    } });
    const terms = {
      schemaVersion: 1,
      purpose: "PARTNER_TECHNICAL_PRICING",
      calculationPolicy: { calculation: "calculation-v1", packing: "packing-v1", pricing: "pricing-v1", rounding: "rounding-v1" },
      mandatoryPercentage: "0",
      mandatoryEnabled: false,
      slabCuttingPricingMethod: "lineBased",
      sawKerfMeters: "0.003",
      materialRateScale: "1",
      currency: "IRT",
      rates: {
        longitudinalCutRateToman: "0",
        crossCutRateToman: "0",
        calibrationCutRateToman: "0",
        verticalCutRateToman: "0",
        squareMeterCutRateToman: "0"
      }
    };
    const effectiveDate = /* @__PURE__ */ new Date("2026-01-01T00:00:00.000Z");
    const integrityHash = await (0, import_partner_sales_contracts20.canonicalHash)({
      accountId: actorId,
      version: 1,
      effectiveDate: "2026-01-01",
      terms,
      actorId,
      reason: "\u0633\u06CC\u0627\u0633\u062A \u0628\u062F\u0648\u0646 \u0628\u0631\u0634 \u062D\u06A9\u0645\u06CC"
    });
    await tx.partnerCommercialTerms.create({ data: {
      id: `${actorId}-terms`,
      accountId: actorId,
      version: 1,
      effectiveDate,
      terms,
      integrityHash,
      actorId,
      reason: "\u0633\u06CC\u0627\u0633\u062A \u0628\u062F\u0648\u0646 \u0628\u0631\u0634 \u062D\u06A9\u0645\u06CC"
    } });
    const product = await tx.product.create({ data: {
      id: actorId,
      code: actorId,
      name: actorId,
      namePersian: "\u0633\u0646\u06AF \u0637\u0648\u0644\u06CC \u062A\u0633\u062A \u0641\u0646\u06CC",
      cuttingDimensionCode: "longitudinal",
      cuttingDimensionName: "longitudinal",
      cuttingDimensionNamePersian: "\u0637\u0648\u0644\u06CC",
      stoneTypeCode: "technical",
      stoneTypeName: "technical",
      stoneTypeNamePersian: "\u06A9\u0631\u06CC\u0633\u062A\u0627\u0644",
      widthCode: "35",
      widthValue: "35",
      widthName: "35",
      thicknessCode: "3",
      thicknessValue: "3",
      thicknessName: "3",
      mineCode: "technical",
      mineName: "technical",
      mineNamePersian: "\u0645\u0639\u062F\u0646 \u062A\u0633\u062A",
      finishCode: "technical",
      finishName: "technical",
      finishNamePersian: "\u0635\u06CC\u0642\u0644\u06CC",
      colorCode: "technical",
      colorName: "technical",
      colorNamePersian: "\u0633\u0641\u06CC\u062F",
      qualityCode: "technical",
      qualityName: "technical",
      qualityNamePersian: "\u062F\u0631\u062C\u0647 \u06CC\u06A9",
      basePrice: null,
      images: [],
      availableInLongitudinalContracts: true
    } });
    const draft = { schemaVersion: 1, inputRevision: 2, rows: [{
      productRowId: "product-row:longitudinal-regression",
      catalogItemId: product.id,
      catalogSnapshotVersion: product.updatedAt.toISOString(),
      family: "longitudinal",
      retailUnitPrice: { amount: "2000000", currency: "IRT" },
      configuration: {
        sourceBatchId: "source-batch:longitudinal-regression",
        lengthMeters: "1.25",
        widthMeters: "0.25",
        quantity: 1,
        lastManualField: "quantity",
        lastManualDimension: "length",
        lengthDisplayUnit: "m",
        widthDisplayUnit: "m",
        sawKerfEnabled: true,
        calibrationEnabled: false,
        calibrationSelection: "automatic"
      }
    }] };
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 }),
      resolveEvidence: createPartnerTechnicalEvidenceResolver()
    };
    const evidence = await dependencies.resolveEvidence(tx, { actorId, recoveryId: access.recoveryId, draft, previous: null });
    if (!evidence.ok) throw new Error(`evidence:${evidence.error.code}`);
    const compiled = compilePartnerTechnicalGraph(draft, evidence.value.context);
    if (!compiled.ok) throw new Error(`compile:${compiled.error.code}`);
    const checkpoint = await createPartnerTechnicalRecoveryService(dependencies).checkpoint({
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "longitudinal-checkpoint",
      draft
    });
    if (!checkpoint.ok) throw new Error(checkpoint.error.code);
    const result = await createPartnerTechnicalSaveService(dependencies).save({
      ...access,
      expectedRecoveryRevision: checkpoint.value.recoveryRevision,
      idempotencyKey: "longitudinal-save",
      draft
    });
    if (!result.ok) throw new Error(result.error.code);
    import_strict.default.deepEqual(result.value.rows.map((row) => ({ unit: row.unit, quantity: row.quantity })), [
      { unit: "squareMeter", quantity: "0.4375" }
    ]);
  });
});
(0, import_node_test.default)("retry reads the durable same-intent receipt while changed-key payloads and stale revisions cannot replace newer input", async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "same-key",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    const first = await service.checkpoint(command);
    if (!first.ok) throw new Error(first.error.code);
    const reloaded = createPartnerTechnicalRecoveryService(dependencies);
    const replay = await reloaded.checkpoint(command);
    if (!replay.ok) throw new Error(replay.error.code);
    import_strict.default.deepEqual(replay.value, { ...first.value, replayed: true });
    const changed = await reloaded.checkpoint({ ...command, draft: { ...command.draft, inputRevision: 2 } });
    if (changed.ok) throw new Error("Changed payload reused a receipt");
    import_strict.default.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
    const next = await reloaded.checkpoint({
      ...command,
      expectedRecoveryRevision: 1,
      idempotencyKey: "next-key",
      draft: { ...command.draft, inputRevision: 3 }
    });
    if (!next.ok) throw new Error(next.error.code);
    import_strict.default.equal(next.value.recoveryRevision, 2);
    const stale = await reloaded.checkpoint({ ...command, idempotencyKey: "stale-key" });
    if (stale.ok) throw new Error("Stale checkpoint accepted");
    import_strict.default.equal(stale.error.code, "ROW_STALE");
    const lateReplay = await reloaded.checkpoint(command);
    if (!lateReplay.ok) throw new Error(lateReplay.error.code);
    import_strict.default.deepEqual(lateReplay.value, { ...first.value, replayed: true });
    const current = await reloaded.read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 2);
    import_strict.default.equal(current.value.draft?.inputRevision, 3);
  });
});
(0, import_node_test.default)("current authority and lease gate every read and receipt replay, and private envelope fields never leave the service", async () => {
  await fixture(async (tx, actorId, access) => {
    let allowed = true;
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => allowed ? { ok: true, value: void 0 } : { ok: false, error: (0, import_partner_sales_contracts20.partnerError)("FORBIDDEN") }
    };
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "auth-key",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    const first = await service.checkpoint(command);
    if (!first.ok) throw new Error(first.error.code);
    const record3 = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({
      where: { draftId: access.recoveryId },
      data: { recovery: { ...record3.recovery, privateEvidence: { rate: "private-rate" } } }
    });
    const safe = await service.read(access);
    if (!safe.ok) throw new Error(safe.error.code);
    import_strict.default.equal(JSON.stringify(safe).includes("private-rate"), false);
    allowed = false;
    for (const result of [await service.read(access), await service.checkpoint(command)]) {
      if (result.ok) throw new Error("Revoked authority accepted");
      import_strict.default.equal(result.error.code, "FORBIDDEN");
    }
    allowed = true;
    const foreign = await createPartnerTechnicalRecoveryService({ ...dependencies, actorId: "foreign-user" }).read(access);
    if (foreign.ok) throw new Error("Foreign creator read accepted");
    import_strict.default.equal(foreign.error.code, "NOT_FOUND");
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { leaseToken: "replacement-token" } });
    const revoked = await service.checkpoint(command);
    if (revoked.ok) throw new Error("Revoked lease replay accepted");
    import_strict.default.equal(revoked.error.code, "FORBIDDEN");
    const reacquired = await service.checkpoint({ ...command, leaseToken: "replacement-token" });
    if (!reacquired.ok) throw new Error(reacquired.error.code);
    import_strict.default.equal(reacquired.value.replayed, true, "transport lease metadata does not change command intent");
  });
});
(0, import_node_test.default)("a receipt cannot acknowledge a released and recreated draft that no longer contains its saved revision", async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    });
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "old-epoch-key",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    import_strict.default.equal((await service.checkpoint(command)).ok, true);
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.create({ data: {
      draftId: access.recoveryId,
      ownerUserId: actorId,
      browserSessionId: access.browserSessionId,
      leaseToken: access.leaseToken,
      schemaVersion: 2,
      baseRevision: 0,
      purpose: "PARTNER_TECHNICAL"
    } });
    const replay = await service.checkpoint(command);
    if (replay.ok) throw new Error("Receipt acknowledged missing durable progress");
    import_strict.default.equal(replay.error.code, "INTEGRITY_CONFLICT");
    const fresh = await service.checkpoint({ ...command, idempotencyKey: "new-epoch-key" });
    if (!fresh.ok) throw new Error(fresh.error.code);
    const wrongEpoch = await service.checkpoint(command);
    if (wrongEpoch.ok) throw new Error("Old receipt matched a new draft with the same revision number");
    import_strict.default.equal(wrongEpoch.error.code, "INTEGRITY_CONFLICT");
  });
});
(0, import_node_test.default)("competing checkpoints from one expected revision accept only one draft and retain the winning input", async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    });
    const outcomes = await Promise.all([11, 12].map((inputRevision) => service.checkpoint({
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: `concurrent-${inputRevision}`,
      draft: { schemaVersion: 1, inputRevision, rows: [] }
    })));
    import_strict.default.equal(outcomes.filter((result) => result.ok).length, 1);
    const accepted = outcomes.find((result) => result.ok);
    if (!accepted?.ok) throw new Error("No checkpoint accepted");
    const current = await service.read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 1);
    import_strict.default.equal(current.value.draft?.inputRevision, accepted.value.inputRevision);
  });
});
(0, import_node_test.default)("expired lease or seven-day recovery blocks read and checkpoint even when a durable receipt exists", async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    });
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "expiry-key",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    import_strict.default.equal((await service.checkpoint(command)).ok, true);
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date(Date.now() - 9e4) } });
    const expiredLease = await service.checkpoint(command);
    if (expiredLease.ok) throw new Error("Expired lease replay accepted");
    import_strict.default.equal(expiredLease.error.code, "FORBIDDEN");
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: {
      updatedAt: /* @__PURE__ */ new Date(),
      recovery: { ...row.recovery, updatedAt: Date.now() - 8 * 24 * 60 * 60 * 1e3 }
    } });
    for (const result of [await service.read(access), await service.checkpoint(command)]) {
      if (result.ok) throw new Error("Expired recovery accepted");
      import_strict.default.equal(result.error.code, "STATE_CONFLICT");
    }
  });
});
(0, import_node_test.default)("transaction failure rolls back both the checkpoint and its receipt before a retry is acknowledged", async () => {
  await fixture(async (tx, actorId, access) => {
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    };
    const transactionFailure = new Error("test transaction failure");
    const failing = createPartnerTechnicalRecoveryService({ ...dependencies, transaction: async (run) => {
      await tx.$executeRaw`SAVEPOINT technical_checkpoint_failure`;
      try {
        await run(tx);
        throw transactionFailure;
      } finally {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT technical_checkpoint_failure`;
      }
    } });
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "atomic-key",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    await import_strict.default.rejects(failing.checkpoint(command), (error) => error === transactionFailure);
    const service = createPartnerTechnicalRecoveryService(dependencies);
    const current = await service.read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 0);
    import_strict.default.equal(current.value.draft, null);
    const retried = await service.checkpoint(command);
    if (!retried.ok) throw new Error(retried.error.code);
    import_strict.default.equal(retried.value.replayed, false);
    import_strict.default.equal(retried.value.recoveryRevision, 1);
  });
});
(0, import_node_test.default)("no-op or input-revision-only checkpoints renew lease presence but not the seven-day meaningful-change clock", async () => {
  await fixture(async (tx, actorId, access) => {
    const service = createPartnerTechnicalRecoveryService({
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 })
    });
    const command = {
      ...access,
      expectedRecoveryRevision: 0,
      idempotencyKey: "initial",
      draft: { schemaVersion: 1, inputRevision: 1, rows: [] }
    };
    import_strict.default.equal((await service.checkpoint(command)).ok, true);
    const lastMeaningfulChange = new Date(Date.now() - 2 * 24 * 60 * 60 * 1e3);
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: {
      recovery: { ...row.recovery, updatedAt: lastMeaningfulChange.getTime() }
    } });
    const noOp = await service.checkpoint({ ...command, expectedRecoveryRevision: 1, idempotencyKey: "no-op" });
    if (!noOp.ok) throw new Error(noOp.error.code);
    import_strict.default.equal(noOp.value.updatedAt, lastMeaningfulChange.toISOString());
    const revisionOnly = await service.checkpoint({
      ...command,
      expectedRecoveryRevision: 2,
      idempotencyKey: "revision-only",
      draft: { ...command.draft, inputRevision: 9 }
    });
    if (!revisionOnly.ok) throw new Error(revisionOnly.error.code);
    const unchanged = await service.read(access);
    if (!unchanged.ok) throw new Error(unchanged.error.code);
    import_strict.default.equal(unchanged.value.updatedAt, lastMeaningfulChange.toISOString());
    import_strict.default.equal(unchanged.value.draft?.inputRevision, 9);
    const changed = await service.checkpoint({
      ...command,
      expectedRecoveryRevision: 3,
      idempotencyKey: "meaningful",
      draft: { ...command.draft, editingValues: [{ entityId: "new-row", field: "quantity", text: "\u06F3" }] }
    });
    if (!changed.ok) throw new Error(changed.error.code);
    import_strict.default.ok(Date.parse(changed.value.updatedAt) > lastMeaningfulChange.getTime());
  });
});
function preparedSaveSetup(tx, actorId, access) {
  const catalog = (0, import_testing.createPartnerTechnicalCatalogFixtures)(), product = catalog.products[0];
  const dependencies = {
    actorId,
    transaction: (run) => run(tx),
    authorize: async () => ({ ok: true, value: void 0 }),
    resolveEvidence: async () => ({ ok: true, value: {
      context: {
        catalog,
        policy: { calculation: "calc-v1", packing: "packing-v1", pricing: "pricing-v1", rounding: "rounding-v1" },
        products: [{
          catalogItemId: product.catalogItemId,
          catalogSnapshotVersion: product.catalogSnapshotVersion,
          preparedRates: [{ kind: "cubic", unit: "ton", rateToman: "12345" }]
        }]
      },
      identities: [{ productRowId: "prepared-row", identity: {
        schemaVersion: 1,
        partnerSellerId: actorId,
        catalogProductId: product.catalogItemId,
        family: "prepared",
        unit: "ton",
        configuration: [{ key: "kind", value: "cubic" }],
        materialRateEvidenceId: "private-material",
        materialRateHash: "sha256-v1:" + "a".repeat(64),
        components: [],
        currency: "IRT",
        calculationPolicyVersion: "calc-v1",
        roundingPolicyVersion: "rounding-v1"
      } }]
    } })
  };
  const service = createPartnerTechnicalSaveService(dependencies);
  const command = {
    ...access,
    expectedRecoveryRevision: 0,
    idempotencyKey: "validated",
    draft: { schemaVersion: 1, inputRevision: 7, rows: [{
      productRowId: "prepared-row",
      catalogItemId: product.catalogItemId,
      catalogSnapshotVersion: product.catalogSnapshotVersion,
      family: "prepared",
      configuration: { kind: "cubic", unit: "ton", quantity: "2.5" }
    }] }
  };
  return { dependencies, service, command };
}
(0, import_node_test.default)("validated technical save returns exact canonical configuration references and reloads without disclosing its private graph", async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const result = await service.save(command);
    if (!result.ok) throw new Error(result.error.code);
    import_strict.default.deepEqual(result.value.rows, [{ configurationRef: {
      recoveryId: access.recoveryId,
      recoveryRevision: 1,
      productRowId: "prepared-row"
    }, quantity: "2.5", unit: "ton", configurationChange: "NEW" }]);
    import_strict.default.equal(result.value.inputRevision, 7);
    import_strict.default.equal(result.value.replayed, false);
    const loaded = await createPartnerTechnicalSaveService(dependencies).readSaved({ ...access, recoveryRevision: 1 });
    if (!loaded.ok) throw new Error(loaded.error.code);
    const { replayed: _replay, ...view } = result.value;
    import_strict.default.deepEqual(loaded.value, view);
    import_strict.default.equal(JSON.stringify(loaded).includes("12345"), false);
    import_strict.default.equal(JSON.stringify(loaded).includes("private-material"), false);
    const draft = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!draft.ok) throw new Error(draft.error.code);
    import_strict.default.deepEqual(draft.value.draft, command.draft);
  });
});
(0, import_node_test.default)("pre-graphHash validated snapshots remain readable through a verified deterministic projection", async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const saved = await service.save(command);
    if (!saved.ok) throw new Error(saved.error.code);
    const session = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    const recovery = structuredClone(session.recovery);
    const envelope = recovery.validatedSnapshots[0];
    delete envelope.payload.view.graphHash;
    envelope.integrityHash = await (0, import_partner_sales_contracts20.canonicalHash)(envelope.payload);
    await tx.salesContractEditSession.update({
      where: { id: session.id },
      data: { recovery }
    });
    const loaded = await createPartnerTechnicalSaveService(dependencies).readSaved({ ...access, recoveryRevision: 1 });
    if (!loaded.ok) throw new Error(loaded.error.code);
    import_strict.default.equal(loaded.value.graphHash, saved.value.graphHash);
  });
});
(0, import_node_test.default)("quantity-only validated successors preserve configuration identity and retry history across incomplete checkpoints", async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const first = await service.save(command);
    if (!first.ok) throw new Error(first.error.code);
    const quantityDraft = { ...command.draft, inputRevision: 8, rows: [{
      ...command.draft.rows[0],
      configuration: { ...command.draft.rows[0].configuration, quantity: "3.75" }
    }] };
    const next = await service.save({ ...command, expectedRecoveryRevision: 1, idempotencyKey: "quantity-change", draft: quantityDraft });
    if (!next.ok) throw new Error(next.error.code);
    import_strict.default.equal(next.value.rows[0].configurationChange, "UNCHANGED");
    import_strict.default.equal(next.value.rows[0].quantity, "3.75");
    import_strict.default.equal(next.value.rows[0].configurationRef.recoveryRevision, 2);
    const checkpoint = createPartnerTechnicalRecoveryService(dependencies);
    const incomplete = { ...quantityDraft, inputRevision: 9, editingValues: [{ entityId: "prepared-row", field: "quantity", text: "\u06F4\u066B" }] };
    import_strict.default.equal((await checkpoint.checkpoint({ ...command, expectedRecoveryRevision: 2, idempotencyKey: "editing", draft: incomplete })).ok, true);
    const invalid = await service.save({ ...command, expectedRecoveryRevision: 3, idempotencyKey: "invalid-save", draft: incomplete });
    if (invalid.ok) throw new Error("Incomplete draft received an inquiry-ready reference");
    import_strict.default.equal(invalid.error.code, "INVALID_PAYLOAD");
    import_strict.default.equal((await service.readSaved({ ...access, recoveryRevision: 3 })).ok, false);
    const replay = await createPartnerTechnicalSaveService(dependencies).save(command);
    if (!replay.ok) throw new Error(replay.error.code);
    import_strict.default.deepEqual(replay.value, { ...first.value, replayed: true });
    const old = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (!old.ok) throw new Error(old.error.code);
    import_strict.default.equal(old.value.rows[0].quantity, "2.5");
    const current = await checkpoint.read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 3);
    import_strict.default.deepEqual(current.value.draft, incomplete);
    const changedKey = await service.save({ ...command, draft: quantityDraft });
    if (changedKey.ok) throw new Error("Idempotency key accepted changed intent");
    import_strict.default.equal(changedKey.error.code, "IDEMPOTENCY_CONFLICT");
  });
});
(0, import_node_test.default)("validated saves cannot reuse a stable row identity for another product family even with matching owner evidence", async () => {
  await fixture(async (tx, actorId, access) => {
    const { service, command, dependencies } = preparedSaveSetup(tx, actorId, access);
    import_strict.default.equal((await service.save(command)).ok, true);
    const replacement = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      const evidence = await dependencies.resolveEvidence();
      return { ok: true, value: {
        ...evidence.value,
        identities: evidence.value.identities.map((item) => ({ ...item, identity: { ...item.identity, family: "volumetric" } }))
      } };
    } });
    const rebound = await replacement.save({
      ...command,
      expectedRecoveryRevision: 1,
      idempotencyKey: "rebind",
      draft: { ...command.draft, inputRevision: 8, rows: [{ ...command.draft.rows[0], family: "volumetric" }] }
    });
    if (rebound.ok) throw new Error("Stable row ID rebound to a different family");
    import_strict.default.equal(rebound.error.code, "INVALID_PAYLOAD");
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 1);
    import_strict.default.equal(current.value.draft?.rows[0].family, "prepared");
  });
});
(0, import_node_test.default)("validated save reauthorizes after graph evidence resolution and never publishes a reference after authority is revoked", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies } = preparedSaveSetup(tx, actorId, access);
    let allowed = true;
    const service = createPartnerTechnicalSaveService({
      ...dependencies,
      authorize: async () => allowed ? { ok: true, value: void 0 } : { ok: false, error: (0, import_partner_sales_contracts20.partnerError)("FORBIDDEN") },
      resolveEvidence: async () => {
        allowed = false;
        return dependencies.resolveEvidence();
      }
    });
    const denied = await service.save(command);
    if (denied.ok) throw new Error("Revoked writer issued a saved reference");
    import_strict.default.equal(denied.error.code, "FORBIDDEN");
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 0);
    const retried = await createPartnerTechnicalSaveService(dependencies).save(command);
    if (!retried.ok) throw new Error(retried.error.code);
    import_strict.default.equal(retried.value.replayed, false);
  });
});
(0, import_node_test.default)("a lease that expires during owner evidence lookup cannot be renewed by a successful validated save", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies } = preparedSaveSetup(tx, actorId, access);
    const service = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: new Date(Date.now() - 9e4) } });
      return dependencies.resolveEvidence();
    } });
    const expired = await service.save(command);
    if (expired.ok) throw new Error("Expired writer renewed itself while publishing a reference");
    import_strict.default.equal(expired.error.code, "FORBIDDEN");
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { updatedAt: /* @__PURE__ */ new Date() } });
    const current = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!current.ok) throw new Error(current.error.code);
    import_strict.default.equal(current.value.recoveryRevision, 0);
  });
});
(0, import_node_test.default)("validated graph, safe references and idempotency receipt roll back together when the transaction fails", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    const failure = new Error("commit failed");
    const failing = createPartnerTechnicalSaveService({ ...dependencies, transaction: async (run) => {
      await tx.$executeRaw`SAVEPOINT technical_validated_failure`;
      try {
        await run(tx);
        throw failure;
      } finally {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT technical_validated_failure`;
      }
    } });
    await import_strict.default.rejects(failing.save(command), (error) => error === failure);
    const missing = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (missing.ok) throw new Error("Rolled-back reference remained readable");
    import_strict.default.equal(missing.error.code, "NOT_FOUND");
    const draft = await createPartnerTechnicalRecoveryService(dependencies).read(access);
    if (!draft.ok) throw new Error(draft.error.code);
    import_strict.default.equal(draft.value.recoveryRevision, 0);
    const retry = await service.save(command);
    if (!retry.ok) throw new Error(retry.error.code);
    import_strict.default.equal(retry.value.recoveryRevision, 1);
    import_strict.default.equal(retry.value.replayed, false);
  });
});
(0, import_node_test.default)("saved references and their retries require current owner authority and reject corrupted private snapshots", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    import_strict.default.equal((await service.save(command)).ok, true);
    const denied = createPartnerTechnicalSaveService({
      ...dependencies,
      authorize: async () => ({ ok: false, error: (0, import_partner_sales_contracts20.partnerError)("FORBIDDEN") })
    });
    for (const outcome of [
      await denied.readSaved({ ...access, recoveryRevision: 1 }),
      await denied.save(command),
      await service.readSaved({ ...access, leaseToken: "stale-token", recoveryRevision: 1 }),
      await service.save({ ...command, leaseToken: "stale-token" })
    ]) {
      if (outcome.ok) throw new Error("Stale authority accessed saved evidence");
      import_strict.default.equal(outcome.error.code, "FORBIDDEN");
    }
    const foreign = await createPartnerTechnicalSaveService({ ...dependencies, actorId: "different-owner" }).readSaved({ ...access, recoveryRevision: 1 });
    if (foreign.ok) throw new Error("Another owner read the saved configuration");
    import_strict.default.equal(foreign.error.code, "NOT_FOUND");
    const row = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    const recovery = JSON.parse(JSON.stringify(row.recovery));
    recovery.validatedSnapshots[0].payload.graph.rows[0].commercial.baseRateToman = "99999";
    await tx.salesContractEditSession.update({ where: { draftId: access.recoveryId }, data: { recovery } });
    for (const outcome of [await service.readSaved({ ...access, recoveryRevision: 1 }), await service.save(command)]) {
      if (outcome.ok) throw new Error("Corrupted private graph accepted");
      import_strict.default.equal(outcome.error.code, "INTEGRITY_CONFLICT");
      import_strict.default.equal(JSON.stringify(outcome).includes("99999"), false);
    }
  });
});
(0, import_node_test.default)("changed owner-issued inquiry evidence reports a configuration change without rewriting the historical reference", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, dependencies, service } = preparedSaveSetup(tx, actorId, access);
    import_strict.default.equal((await service.save(command)).ok, true);
    const changed = createPartnerTechnicalSaveService({ ...dependencies, resolveEvidence: async () => {
      const evidence = await dependencies.resolveEvidence();
      return { ok: true, value: { ...evidence.value, identities: evidence.value.identities.map((item) => ({
        ...item,
        identity: { ...item.identity, components: [{ componentId: "new-component", evidenceHash: "sha256-v1:" + "b".repeat(64) }] }
      })) } };
    } });
    const next = await changed.save({ ...command, expectedRecoveryRevision: 1, idempotencyKey: "new-evidence" });
    if (!next.ok) throw new Error(next.error.code);
    import_strict.default.equal(next.value.rows[0].configurationChange, "CHANGED");
    const original = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (!original.ok) throw new Error(original.error.code);
    import_strict.default.equal(original.value.rows[0].configurationChange, "NEW");
    import_strict.default.equal(original.value.rows[0].configurationRef.recoveryRevision, 1);
  });
});
(0, import_node_test.default)("discard erases saved draft content while permanent receipts retain only non-content replay identity", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, service } = preparedSaveSetup(tx, actorId, access);
    import_strict.default.equal((await service.save(command)).ok, true);
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    const old = await service.readSaved({ ...access, recoveryRevision: 1 });
    if (old.ok) throw new Error("Discarded technical content remained readable");
    import_strict.default.equal(old.error.code, "NOT_FOUND");
    const retained = await tx.partnerCommandOutcome.findMany({ where: { actorId, targetScope: access.recoveryId } });
    import_strict.default.equal(retained.length, 1);
    const outcome = retained[0].outcome;
    import_strict.default.deepEqual(Object.keys(outcome).sort(), ["recoveryRevision", "sessionId", "version"]);
    import_strict.default.equal(outcome.recoveryRevision, 1);
    import_strict.default.equal(JSON.stringify(outcome).includes("prepared-row"), false);
    import_strict.default.equal(JSON.stringify(outcome).includes("2.5"), false);
  });
});
(0, import_node_test.default)("discard and recreation of the same recovery ID cannot reissue an old configuration reference for different content", async () => {
  await fixture(async (tx, actorId, access) => {
    const { command, service, dependencies } = preparedSaveSetup(tx, actorId, access);
    const original = await service.save(command);
    if (!original.ok) throw new Error(original.error.code);
    await tx.salesContractEditSession.delete({ where: { draftId: access.recoveryId } });
    await tx.salesContractEditSession.create({ data: {
      draftId: access.recoveryId,
      ownerUserId: actorId,
      browserSessionId: access.browserSessionId,
      leaseToken: access.leaseToken,
      schemaVersion: 2,
      baseRevision: 0,
      purpose: "PARTNER_TECHNICAL"
    } });
    const fresh = await createPartnerTechnicalSaveService(dependencies).save({
      ...command,
      idempotencyKey: "new-incarnation",
      draft: { ...command.draft, rows: [{ ...command.draft.rows[0], configuration: { ...command.draft.rows[0].configuration, quantity: "8" } }] }
    });
    if (!fresh.ok) throw new Error(fresh.error.code);
    import_strict.default.ok(fresh.value.recoveryRevision > original.value.recoveryRevision);
    import_strict.default.notDeepEqual(fresh.value.rows[0].configurationRef, original.value.rows[0].configurationRef);
    const stale = await service.readSaved({ ...access, recoveryRevision: original.value.recoveryRevision });
    if (stale.ok) throw new Error("Old reference resolved to the new incarnation");
    import_strict.default.equal(stale.error.code, "NOT_FOUND");
    const oldRetry = await service.save(command);
    if (oldRetry.ok) throw new Error("Old receipt crossed recovery incarnation");
    import_strict.default.equal(oldRetry.error.code, "INTEGRITY_CONFLICT");
  });
});
(0, import_node_test.default)("independent service-only recovery validates real catalog, freezes rates and never creates inquiry subjects", async () => {
  await fixture(async (tx, actorId, access) => {
    const catalogService = await tx.subService.create({ data: { code: actorId, namePersian: "\u0627\u0628\u0632\u0627\u0631 \u062A\u0633\u062A", pricePerMeter: "100", calculationBase: "length" } });
    const dependencies = {
      actorId,
      transaction: (run) => run(tx),
      authorize: async () => ({ ok: true, value: void 0 }),
      resolveEvidence: async () => ({ ok: true, value: { context: {
        catalog: { products: [], operations: [], sawKerfMeters: "0" },
        products: [],
        policy: { calculation: "c", packing: "p", pricing: "p", rounding: "r" }
      }, identities: [] } })
    };
    const command = { ...access, expectedRecoveryRevision: 0, idempotencyKey: "independent-service", draft: {
      schemaVersion: 1,
      inputRevision: 1,
      rows: [],
      serviceRows: [{
        serviceRowId: "service-row",
        sourceType: "tool",
        catalogItemId: catalogService.id,
        catalogSnapshotVersion: catalogService.updatedAt.toISOString(),
        title: "\u0627\u0628\u0632\u0627\u0631 \u0645\u0634\u062A\u0631\u06CC",
        unit: "meter",
        quantity: "2.5",
        retailUnitPrice: { amount: "2000", currency: "IRR" }
      }]
    } };
    const saved = await createPartnerTechnicalSaveService(dependencies).save(command);
    import_strict.default.equal(saved.ok, true, JSON.stringify(saved));
    if (!saved.ok) return;
    import_strict.default.deepEqual(saved.value.rows, []);
    import_strict.default.deepEqual(saved.value.pricingSubjects, []);
    import_strict.default.deepEqual(saved.value.serviceRows, [{ serviceRowId: "service-row", quantity: "2.5", unit: "meter" }]);
    const loaded = await createPartnerTechnicalSaveService(dependencies).readSaved({ ...access, recoveryRevision: saved.value.recoveryRevision });
    import_strict.default.equal(loaded.ok, true);
    const replay = await createPartnerTechnicalSaveService(dependencies).save(command);
    import_strict.default.equal(replay.ok, true);
    const current = await tx.salesContractEditSession.findUniqueOrThrow({ where: { draftId: access.recoveryId } });
    const recovery = current.recovery;
    const snapshot = recovery.validatedSnapshots[0].payload;
    import_strict.default.equal(snapshot.serviceRows[0].wholesaleUnitPriceAmount, "100");
    import_strict.default.equal(snapshot.serviceRows[0].retailUnitPrice.amount, "200");
    import_strict.default.deepEqual(snapshot.identities, []);
    import_strict.default.deepEqual(snapshot.graph.rows, []);
    const stale = await createPartnerTechnicalSaveService(dependencies).save({
      ...command,
      idempotencyKey: "stale-service",
      expectedRecoveryRevision: saved.value.recoveryRevision,
      draft: { ...command.draft, inputRevision: 2, serviceRows: [{ ...command.draft.serviceRows[0], catalogSnapshotVersion: "2020-01-01T00:00:00.000Z" }] }
    });
    import_strict.default.equal(stale.ok, false);
    if (!stale.ok) import_strict.default.equal(stale.error.code, "ROW_STALE");
  });
});
