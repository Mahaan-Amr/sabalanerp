import { Prisma, PrismaClient } from '../../../backend/node_modules/@prisma/client';
import { canonicalHash } from '../../../packages/partner-sales-contracts/src';
import { buildCaseProjections } from '../../../backend/src/services/partnerSales/cases/projections';
import { validateNamespace } from './safety.mjs';

const databaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '';
const parsedDatabaseUrl = new URL(databaseUrl);
if (parsedDatabaseUrl.hostname !== '127.0.0.1' || parsedDatabaseUrl.port !== '55432' ||
    !/^\/sabalanerp_partner_browser_[a-f0-9]{16}$/.test(parsedDatabaseUrl.pathname)) {
  throw new Error('Partner live fixture requires the isolated sabalanerp-local browser database.');
}
const database = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const passwordHash = '$2a$10$ozbp7RyqIhbRIAz/DU6D.u1rEf5p2lMFmvVizCnszwJ8Bg/55P64C';

function ids(namespace: string) { return { user: namespace, responderUser: `${namespace}-responder-user`,
  replacementResponderUser: `${namespace}-replacement-responder-user`,
  unrelatedResponderUser: `${namespace}-unrelated-responder-user`, managerUser: `${namespace}-manager-user`,
  hrUser: `${namespace}-hr-user`, adminUser: `${namespace}-admin-user`,
  accountingUser: `${namespace}-accounting-user`, ordinaryAccountingUser: `${namespace}-ordinary-accounting-user`,
  fulfillmentUser: `${namespace}-fulfillment-user`,
  profile: `${namespace}-profile`, account: `${namespace}-account`,
  department: `${namespace}-department`, customer: `${namespace}-customer`, case: `${namespace}-case`,
  internal: `${namespace}-internal`, contract: `${namespace}-contract`, row: `${namespace}-row`,
  plan: `${namespace}-retail-plan`, sabalanPlan: `${namespace}-sabalan-plan`, cohort: `${namespace}-cohort`,
  event: `${namespace}-commitment`, product: `${namespace}-product`, technicalTerms: `${namespace}-technical-terms`,
  creditTerms: `${namespace}-credit-terms`, responderAssignment: `${namespace}-responder-assignment` }; }

async function seed(namespace: string) {
  validateNamespace(namespace); const id = ids(namespace);
  const phone = `0999${namespace.replace(/\D/g, '').slice(-7).padStart(7, '0')}`;
  const customerPlan = { planId: id.plan, version: 1, effectiveDate: '2026-08-30', installments: [{
    installmentId: `${id.plan}-installment`, dueDate: '2026-09-30', amount: { amount: '150', currency: 'IRT' as const }, method: 'CASH' as const }] };
  const sabalanPlan = { planId: id.sabalanPlan, version: 1, effectiveDate: '2026-08-30', installments: [{
    installmentId: `${id.sabalanPlan}-installment`, dueDate: '2026-09-15', amount: { amount: '100', currency: 'IRT' as const }, method: 'BANK_TRANSFER' as const }] };
  const totals = (payable: string) => ({ net: payable, discount: '0', tax: '0', charges: '0', payable, currency: 'IRT' as const });
  const product = { productRowId: id.row, description: 'محصول آزمون یکپارچه', quantity: '1', unit: 'عدد' };
  const seller = { displayName: 'همکار آزمون', phone: '09120000000', address: 'تهران' };
  const customer = { displayName: 'مشتری آزمون', phone, address: 'تهران' };
  const graph = { schemaVersion: 1 as const, revision: 1,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    catalogSnapshots: [{ catalogProductId: `${namespace}-catalog`, snapshotVersion: 'catalog-v1', facts: {} }],
    rows: [{ productRowId: id.row, catalogProductId: `${namespace}-catalog`, catalogSnapshotVersion: 'catalog-v1',
      productType: 'prepared' as const, contractualTitle: product.description,
      commercial: { requestedQuantity: '1', totalAmountToman: '100',
        calculationSnapshot: { kind: 'readyPiece', unit: 'count', quantity: '1' } } }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [],
    operationGroups: [], toolSelections: [], finishingSelections: [] };
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  const wholesaleEnvelope = { schemaVersion: 1 as const,
    products: [{ ...product, wholesaleUnitPrice: '100', approvalEvidenceId: `${namespace}-approval` }],
    totals: totals('100') };
  const retailEnvelope = { schemaVersion: 1 as const,
    products: [{ ...product, retailUnitPrice: '150' }], totals: totals('150') };
  const paymentEvidence = { customerPaymentPlan: customerPlan, sabalanPaymentPlan: sabalanPlan };
  const customerContent = { contractDate: '2026-08-30', legalText: 'شرایط قرارداد آزمون یکپارچه',
    deliveries: [{ deliveryId: `${namespace}-delivery`, date: '2026-09-10', destination: 'تهران',
      items: [{ productRowId: id.row, quantity: '1' }] }] };
  const integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
    graphHash, graph, partySnapshots: { partner: seller, customer }, wholesaleEnvelope, retailEnvelope,
    paymentEvidence, customerContent });
  const owner = { caseId: id.case, revision: 1, integrityHash };
  const projectionResult = await buildCaseProjections({ caseId: id.case, revision: 1, integrityHash,
    caseNumber: `${namespace}-number`, internalRecordId: id.internal,
    internalRecordNumber: `${namespace}-internal-number`, customerContractNumber: `${namespace}-customer-contract`,
    commercialAccountId: id.account, state: 'DRAFT', evidence: { graphHash, graph,
      partySnapshots: { partner: seller, customer }, wholesaleEnvelope, retailEnvelope, paymentEvidence,
      customerContent, products: [{ ...product, wholesaleUnitPrice: '100', retailUnitPrice: '150',
        approvalEvidenceId: `${namespace}-approval` }], resaleDifference: '50' } });
  if (!projectionResult.ok) throw new Error('Partner live fixture projection construction failed.');
  const { partner, accounting, fulfillment, customer: customerOutput } = projectionResult.value;
  const committed = { schemaVersion: 1 as const, type: 'CASE_COMMITTED' as const, eventId: id.event,
    commandId: `${namespace}-commit-command`, correlationId: `${namespace}-commit-correlation`, actorId: id.user,
    recordedAt: '2026-08-30T08:00:00.000Z', effectiveDate: '2026-08-30', owner,
    internalRecordId: id.internal, trigger: 'PRINTED' as const, salesCreditOwnerId: id.user,
    sabalanNetAmount: { amount: '100', currency: 'IRT' as const } };
  await database.$transaction(async tx => {
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
    await tx.effectiveAuthorizationState.upsert({ where: { id: 1 }, create: { id: 1, revision: 1 },
      update: {} });
    await tx.partnerOperationsControl.upsert({ where: { id: 'partner-operations' }, create: {
      id: 'partner-operations', revision: 1, enrollmentPaused: true, operationalPaused: true,
      lastOperationalPauseAt: null, cohortId: null, readinessEvidence: Prisma.DbNull,
    }, update: {} });
    await tx.user.create({ data: { id: id.user, email: `${namespace}@example.invalid`, username: namespace,
      password: passwordHash, firstName: 'آزمون', lastName: 'همکار', role: 'USER' } });
    await tx.user.createMany({ data: [
      { id: id.responderUser, email: `${namespace}-responder@example.invalid`, username: id.responderUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'پاسخ‌گو', role: 'USER' },
      { id: id.accountingUser, email: `${namespace}-accounting@example.invalid`, username: id.accountingUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'حسابداری', role: 'USER' },
      { id: id.ordinaryAccountingUser, email: `${namespace}-ordinary-accounting@example.invalid`, username: id.ordinaryAccountingUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'حسابداری عمومی', role: 'USER' },
      { id: id.fulfillmentUser, email: `${namespace}-fulfillment@example.invalid`, username: id.fulfillmentUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'لجستیک', role: 'USER' },
      { id: id.replacementResponderUser, email: `${namespace}-replacement-responder@example.invalid`,
        username: id.replacementResponderUser, password: passwordHash,
        firstName: 'آزمون', lastName: 'پاسخ‌گوی جایگزین', role: 'USER' },
      { id: id.unrelatedResponderUser, email: `${namespace}-unrelated-responder@example.invalid`,
        username: id.unrelatedResponderUser, password: passwordHash,
        firstName: 'آزمون', lastName: 'پاسخ‌گوی نامرتبط', role: 'USER' },
      { id: id.managerUser, email: `${namespace}-manager@example.invalid`, username: id.managerUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'مدیر فروش', role: 'MANAGER' },
      { id: id.hrUser, email: `${namespace}-hr@example.invalid`, username: id.hrUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'منابع انسانی', role: 'USER' },
      { id: id.adminUser, email: `${namespace}-admin@example.invalid`, username: id.adminUser,
        password: passwordHash, firstName: 'آزمون', lastName: 'مدیر سامانه', role: 'ADMIN' },
    ] });
    await tx.workspacePermission.create({ data: { id: `${namespace}-workspace`, userId: id.user,
      workspace: 'sales', permissionLevel: 'edit' } });
    await tx.workspacePermission.create({ data: { id: `${namespace}-accounting-workspace`, userId: id.accountingUser,
      workspace: 'accounting', permissionLevel: 'admin', grantedBy: id.accountingUser } });
    await tx.workspacePermission.create({ data: { id: `${namespace}-ordinary-accounting-workspace`, userId: id.ordinaryAccountingUser,
      workspace: 'accounting', permissionLevel: 'view', grantedBy: id.accountingUser } });
    await tx.featurePermission.createMany({ data: ['accounting_dashboard_view', 'accounting_contracts_view'].map((feature) => ({
      id: `${namespace}-ordinary-${feature}`, userId: id.ordinaryAccountingUser, workspace: 'accounting', feature,
      permissionLevel: 'view', grantedBy: id.accountingUser,
    })) });
    await tx.featurePermission.create({ data: { id: `${namespace}-accounting-approval-feature`,
      userId: id.accountingUser, workspace: 'accounting', feature: 'accounting_records_approve_void',
      permissionLevel: 'edit', grantedBy: id.accountingUser } });
    await tx.featurePermission.create({ data: { id: `${namespace}-accounting-candidates-feature`,
      userId: id.accountingUser, workspace: 'accounting', feature: 'accounting_invoice_candidates_manage',
      permissionLevel: 'edit', grantedBy: id.accountingUser } });
    await tx.workspacePermission.createMany({ data: [
      { id: `${namespace}-manager-workspace`, userId: id.managerUser, workspace: 'sales', permissionLevel: 'admin', grantedBy: id.managerUser },
      { id: `${namespace}-hr-workspace`, userId: id.hrUser, workspace: 'hr', permissionLevel: 'admin', grantedBy: id.hrUser },
      { id: `${namespace}-responder-workspace`, userId: id.responderUser,
        workspace: 'sales', permissionLevel: 'edit', grantedBy: id.managerUser },
      { id: `${namespace}-replacement-responder-workspace`, userId: id.replacementResponderUser,
        workspace: 'sales', permissionLevel: 'edit', grantedBy: id.managerUser },
      { id: `${namespace}-unrelated-responder-workspace`, userId: id.unrelatedResponderUser,
        workspace: 'sales', permissionLevel: 'edit', grantedBy: id.managerUser },
    ] });
    await tx.hrWorkspaceCatalog.upsert({ where: { code: 'HUMAN_RESOURCES' }, update: { isActive: true },
      create: { code: 'HUMAN_RESOURCES', displayName: 'Human Resources' } });
    await tx.hrWorkspaceAccessGrant.create({ data: { stableKey: `${namespace}:hr-partner-workspace`,
      userId: id.hrUser, workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), grantedByUserId: id.adminUser,
      reason: 'isolated Partner HR actor-matrix fixture' } });
    await tx.department.create({ data: { id: id.department, name: namespace, namePersian: 'فروش آزمون' } });
    await tx.user.update({ where: { id: id.user }, data: { departmentId: id.department } });
    await tx.partnerProfile.create({ data: { id: id.profile, userId: id.user, state: 'ACTIVE', firstActivatedAt: new Date() } });
    await tx.partnerProfileResponderAssignment.create({ data: { id: id.responderAssignment, profileId: id.profile,
      revision: 1, responderId: id.responderUser, actorId: id.responderUser, reason: 'پاسخ‌گوی آزمون یکپارچه',
      eligibilityEvidence: { fixture: true } } });
    await tx.effectiveActionGrant.create({ data: { id: `${namespace}-grant`, principalKind: 'USER',
      principalId: id.user, subjectUserId: id.user, domain: 'PARTNER', action: 'CASE_READ',
      rootKind: 'CASE', purpose: 'PARTNER', scope: 'OWN', effect: 'ALLOW', grantedBy: id.user,
      reason: 'isolated Partner integration fixture', correlationId: `${namespace}-grant` } });
    await tx.effectiveActionGrant.createMany({ data: [
      { action: 'INQUIRY_READ', purpose: 'RESPONDER', rootKind: 'INQUIRY', scope: 'ASSIGNED' },
      { action: 'INQUIRY_RESPOND', purpose: 'RESPONDER', rootKind: 'INQUIRY', scope: 'ASSIGNED' },
    ].map((grant, index) => ({ id: `${namespace}-internal-grant-${index}`,
      principalKind: 'USER', principalId: id.responderUser, subjectUserId: id.responderUser,
      domain: 'PARTNER', ...grant, effect: 'ALLOW',
      grantedBy: id.responderUser, reason: 'isolated Partner integration fixture',
      correlationId: `${namespace}-internal-grant` })) });
    await tx.effectiveActionGrant.createMany({ data: [id.replacementResponderUser, id.unrelatedResponderUser]
      .flatMap((responderId, responderIndex) => [
        { action: 'INQUIRY_READ', purpose: 'RESPONDER', rootKind: 'INQUIRY', scope: 'ASSIGNED' },
        { action: 'INQUIRY_RESPOND', purpose: 'RESPONDER', rootKind: 'INQUIRY', scope: 'ASSIGNED' },
      ].map((grant, grantIndex) => ({ id: `${namespace}-additional-responder-grant-${responderIndex}-${grantIndex}`,
        principalKind: 'USER', principalId: responderId, subjectUserId: responderId, domain: 'PARTNER',
        ...grant, effect: 'ALLOW', grantedBy: id.managerUser, reason: 'isolated responder actor-matrix fixture',
        correlationId: `${namespace}-additional-responder-grant` }))) });
    await tx.effectiveActionGrant.createMany({ data: [
      { actorId: id.managerUser, action: 'PROFILE_READ', purpose: 'ONBOARDING', rootKind: 'PROFILE' },
      { actorId: id.managerUser, action: 'RESPONDER_ASSIGN', purpose: 'MANAGEMENT', rootKind: 'PROFILE' },
      { actorId: id.managerUser, action: 'RESPONDER_REASSIGN', purpose: 'MANAGEMENT', rootKind: 'INQUIRY' },
      { actorId: id.hrUser, action: 'PROFILE_READ', purpose: 'ONBOARDING', rootKind: 'PROFILE' },
      { actorId: id.hrUser, action: 'PROFILE_SUSPEND', purpose: 'ONBOARDING', rootKind: 'PROFILE' },
      { actorId: id.adminUser, action: 'PROFILE_READ', purpose: 'ONBOARDING', rootKind: 'PROFILE' },
      { actorId: id.adminUser, action: 'PROFILE_TERMINATE', purpose: 'ONBOARDING', rootKind: 'PROFILE' },
    ].map((grant, index) => ({ id: `${namespace}-management-matrix-grant-${index}`, principalKind: 'USER',
      principalId: grant.actorId, subjectUserId: grant.actorId, domain: 'PARTNER', action: grant.action,
      purpose: grant.purpose, rootKind: grant.rootKind, scope: 'COMPANY', effect: 'ALLOW',
      grantedBy: id.adminUser, reason: 'isolated management actor-matrix fixture',
      correlationId: `${namespace}-management-matrix-grant` })) });
    await tx.effectiveActionGrant.createMany({ data: [
      ...(['ACCOUNTING_READ', 'ACCOUNTING_WRITE'] as const).map((action, index) => ({ id: `${namespace}-accounting-grant-${index}`,
        principalKind: 'USER' as const, principalId: id.accountingUser, subjectUserId: id.accountingUser,
        domain: 'PARTNER', action, purpose: 'ACCOUNTING', rootKind: 'CASE', scope: 'COMPANY' as const,
        effect: 'ALLOW' as const, grantedBy: id.accountingUser, reason: 'isolated Accounting persona',
        correlationId: `${namespace}-accounting-grant` })),
      ...(['FULFILLMENT_READ', 'FULFILLMENT_WRITE'] as const).map((action, index) => ({ id: `${namespace}-fulfillment-grant-${index}`,
        principalKind: 'USER' as const, principalId: id.fulfillmentUser, subjectUserId: id.fulfillmentUser,
        domain: 'PARTNER', action, purpose: 'FULFILLMENT', rootKind: 'CASE', scope: 'COMPANY' as const,
        effect: 'ALLOW' as const, grantedBy: id.fulfillmentUser, reason: 'isolated Fulfillment persona',
        correlationId: `${namespace}-fulfillment-grant` })),
    ] });
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${id.profile}, true)`;
    await tx.partnerCommercialAccount.create({ data: { id: id.account, profileId: id.profile } });
    await tx.partnerCommercialIdentity.create({ data: { id: `${namespace}-identity`, accountId: id.account, version: 1,
      legalName: 'همکار آزمون یکپارچه', tradeName: 'همکار آزمون', identifiers: { nationalId: namespace },
      phone: '09120000000', address: 'تهران', integrityHash: `sha256-v1:${'1'.repeat(64)}`,
      actorId: id.responderUser } });
    const technicalTerms = { schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_PRICING',
      calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' },
      mandatoryPercentage: '20', mandatoryEnabled: true, slabCuttingPricingMethod: 'lineBased', sawKerfMeters: '0.005',
      materialRateScale: '0.1', currency: 'IRT', rates: { longitudinalCutRateToman: '1200', crossCutRateToman: '1400',
        calibrationCutRateToman: '900', verticalCutRateToman: '1600', squareMeterCutRateToman: '4500' } };
    const creditTerms = { schemaVersion: 1, purpose: 'PARTNER_CREDIT_TERMS', legalText: 'شرایط فروش همکار آزمون',
      paymentMethod: 'BANK_TRANSFER', dueDays: 30 };
    for (const [termsId, version, terms, reason] of [[id.technicalTerms, 1, technicalTerms, 'سیاست فنی آزمون'],
      [id.creditTerms, 2, creditTerms, 'شرایط اعتباری آزمون']] as const) {
      const effectiveDate = '2026-08-29';
      await tx.partnerCommercialTerms.create({ data: { id: termsId, accountId: id.account, version,
        effectiveDate: new Date(`${effectiveDate}T00:00:00.000Z`), terms,
        integrityHash: await canonicalHash({ accountId: id.account, version, effectiveDate, terms,
          actorId: id.responderUser, reason }), actorId: id.responderUser, reason } });
    }
    await tx.product.create({ data: { id: id.product, code: id.product, name: id.product,
      namePersian: 'سنگ آماده آزمون یکپارچه', cuttingDimensionCode: 'qa', cuttingDimensionName: 'qa',
      cuttingDimensionNamePersian: 'آزمون', stoneTypeCode: 'qa', stoneTypeName: 'qa', stoneTypeNamePersian: 'تراورتن',
      widthCode: '40', widthValue: '40', widthName: '40', motherLengthValue: '2', thicknessCode: '2',
      thicknessValue: '2', thicknessName: '2', mineCode: 'qa', mineName: 'qa', mineNamePersian: 'معدن آزمون',
      finishCode: 'qa', finishName: 'qa', finishNamePersian: 'سابیده', colorCode: 'qa', colorName: 'qa',
      colorNamePersian: 'کرم', qualityCode: 'qa', qualityName: 'qa', qualityNamePersian: 'درجه یک',
      basePrice: '100', images: [], isAvailable: true, availableInVolumetricContracts: true,
      availableInLongitudinalContracts: true, availableInStairContracts: true, availableInSlabContracts: true } });
    const previousControl = await tx.partnerOperationsControl.findUniqueOrThrow({ where: { id: 'partner-operations' } });
    await tx.partnerReleaseCohort.create({ data: { id: id.cohort, name: id.cohort,
      activationEnabled: true, enrollmentPaused: false, operationalPaused: false,
      readinessEvidence: { qaPreviousOperationsControl: {
        revision: previousControl.revision, enrollmentPaused: previousControl.enrollmentPaused,
        operationalPaused: previousControl.operationalPaused,
        lastOperationalPauseAt: previousControl.lastOperationalPauseAt?.toISOString() ?? null,
        cohortId: previousControl.cohortId, readinessEvidence: previousControl.readinessEvidence,
      } } } });
    await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: {
      cohortId: id.cohort, enrollmentPaused: false, operationalPaused: false } });
    await tx.partnerCohortMembership.create({ data: { id: `${namespace}-membership`, profileId: id.profile,
      cohortId: id.cohort, actorId: id.user, eligibilityEvidence: { fixture: true } } });
    await tx.crmCustomer.create({ data: { id: id.customer, firstName: 'مشتری', lastName: 'آزمون',
      ownerUserId: id.user, createdBy: id.user, partnerOwnerProfileId: id.profile, partnerRevision: 1,
      address: 'تهران', phoneNumbers: { create: { number: phone, type: 'mobile', isPrimary: true } } } });
    await tx.partnerSaleCase.create({ data: { id: id.case, caseNumber: partner.caseNumber, profileId: id.profile,
      customerId: id.customer, internalRecordId: id.internal, customerContractId: id.contract,
      headRevision: 1, integrityHash: owner.integrityHash, state: 'DRAFT', stateRevision: 1 } });
    await tx.partnerCaseRevision.create({ data: { caseId: id.case, revision: 1, integrityHash: owner.integrityHash,
      graphHash, graph, partySnapshots: { partner: seller, customer },
      wholesaleEnvelope, retailEnvelope, paymentEvidence, customerContent,
      internalProjection: { partner, accounting, fulfillment }, customerProjection: customerOutput,
      actorId: id.user, commandId: `${namespace}-revision-command` } });
    await tx.sabalanToPartnerSaleRecord.create({ data: { id: id.internal,
      recordNumber: accounting.recordNumber, caseId: id.case, commercialAccountId: id.account,
      expectedRevision: 1, integrityHash: owner.integrityHash } });
    await tx.salesContract.create({ data: { id: id.contract, contractNumber: partner.customerContractNumber,
      title: 'Partner QA', titlePersian: 'قرارداد آزمون همکار', content: customerContent.legalText,
      status: 'PRINTED', customerId: id.customer, departmentId: id.department, createdBy: id.user,
      responsibleSellerId: id.user, partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: id.case,
      partnerRevision: 1, partnerIntegrityHash: owner.integrityHash, totalAmount: 150,
      currency: 'IRT', contractData: customerOutput, printedAt: new Date('2026-08-30T08:00:00.000Z') } });
    await tx.partnerProductRow.create({ data: { id: id.row, caseId: id.case } });
    await tx.partnerCaseRowBinding.create({ data: { caseId: id.case, revision: 1, productRowId: id.row,
      configurationHash: `sha256-v1:${'c'.repeat(64)}`, quantity: 1, unit: 'عدد', precisionPolicyVersion: 'unit-v1' } });
    for (const [plan, purpose] of [[customerPlan, 'RETAIL'], [sabalanPlan, 'SABALAN']] as const) {
      await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId: id.case, caseRevision: 1,
        purpose, version: 1, effectiveDate: new Date('2026-08-30'), evidence: plan,
        integrityHash: await canonicalHash(plan), installments: { create: plan.installments.map(item => ({
          id: item.installmentId, dueDate: new Date(item.dueDate), amount: item.amount.amount,
          currency: item.amount.currency, method: item.method, evidence: item })) } } });
    }
    await tx.partnerCaseEvent.create({ data: { id: id.event, caseId: id.case, caseRevision: 1,
      integrityHash: owner.integrityHash, sequence: 1, stateRevision: 4, type: committed.type,
      fromState: 'CUSTOMER_APPROVED', toState: 'COMMITTED', actorId: id.user,
      commandId: committed.commandId, correlationId: committed.correlationId,
      effectiveDate: new Date('2026-08-30'), evidence: { publicEvent: committed } } });
    await tx.partnerSaleCase.update({ where: { id: id.case }, data: {
      state: 'AWAITING_CUSTOMER_CONFIRMATION', stateRevision: 2 } });
    await tx.partnerSaleCase.update({ where: { id: id.case }, data: {
      state: 'CUSTOMER_APPROVED', stateRevision: 3 } });
    await tx.partnerSaleCase.update({ where: { id: id.case }, data: { state: 'COMMITTED', stateRevision: 4,
      committedAt: new Date('2026-08-30T08:00:00.000Z'), commitmentTrigger: 'PRINTED',
      committedRevision: 1, commitmentEventId: id.event } });
  });
  return { namespace, username: namespace, caseId: id.case, owner };
}

async function main() {
  const [mode, namespace] = process.argv.slice(2);
  try {
    if (mode === 'seed' && namespace) console.log(JSON.stringify(await seed(namespace)));
    else throw new Error('usage: seed namespace');
  } finally { await database.$disconnect(); }
}

void main();
