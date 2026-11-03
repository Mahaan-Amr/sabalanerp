/** Synthetic module adapter only. No HTTP, database, storage, notifications or activation traffic. */
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { PartnerCommandSchema, PartnerManagementCommandV2Schema, PartnerManagementWorkspaceViewV2Schema, partnerError } from '@sabalanerp/partner-sales-contracts';
import type { ActionAvailabilityV2, PartnerActionV2, PartnerCommandPort, PartnerManagementCommandV2Port, PartnerManagementProfileViewV2,
  PartnerManagementWorkspaceViewV2, PartnerQueryV2Port, PartnerQueryV2Results, Result } from '@sabalanerp/partner-sales-contracts';

export type ManagementPersona = 'HR' | 'SALES' | 'ACCOUNTING' | 'CRM' | 'ADMIN' | 'MANAGER' | 'PARTNER' | 'EXPIRED';
const grants: Record<ManagementPersona, PartnerActionV2[]> = {
  HR: ['PROFILE_CREATE', 'IDENTITY_VERIFY', 'PROFILE_ACTIVATE', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE'],
  SALES: ['COMMERCIAL_TERMS_MANAGE', 'RESPONDER_ASSIGN', 'RESPONDER_REASSIGN', 'PROFILE_CONVERSION_MANAGE'],
  ACCOUNTING: ['CREDIT_TERMS_MANAGE'], CRM: ['CUSTOMER_TRANSFER_DECIDE'],
  ADMIN: ['PROFILE_CREATE', 'IDENTITY_VERIFY', 'PROFILE_ACTIVATE', 'PROFILE_SUSPEND', 'PROFILE_TERMINATE',
    'COMMERCIAL_TERMS_MANAGE', 'CREDIT_TERMS_MANAGE', 'RESPONDER_ASSIGN', 'RESPONDER_REASSIGN', 'PROFILE_CONVERSION_MANAGE', 'CUSTOMER_TRANSFER_DECIDE'],
  MANAGER: [], PARTNER: [], EXPIRED: ['PROFILE_ACTIVATE'],
};
const personaLabels: Record<ManagementPersona, string> = { HR: 'منابع انسانی', SALES: 'مدیریت فروش', ACCOUNTING: 'حسابداری',
  CRM: 'مدیریت مشتریان', ADMIN: 'مدیریت مجاز شرکت', MANAGER: 'عنوان مدیر بدون مجوز', PARTNER: 'فروشنده همکار', EXPIRED: 'دسترسی پایان‌یافته' };
const allReady = (item: PartnerManagementProfileViewV2) => ['identityVerified', 'commercialTermsReady', 'creditTermsReady', 'responderReady', 'conversionCleared', 'cohortReady']
  .every(key => item.profile[key as keyof typeof item.profile] === true);

export function createManagementFixture(persona: ManagementPersona) {
  const seed = createPartnerFixtures();
  const profile: PartnerManagementProfileViewV2 = {
    profile: { ...seed.profile, profileId: 'fixture-331-profile', status: 'PENDING', identityVerified: false,
      commercialTermsReady: false, creditTermsReady: false, responderReady: false, conversionCleared: true, cohortReady: true },
    displayName: 'همکار آزمایشی آریا', actions: [],
    identity: { evidenceId: 'fixture-331-identity', legalName: 'همکار آزمایشی آریا', phone: '۰۹۱۲۰۰۰۰۰۰۰۰', address: 'تهران، نشانی آزمایشی', personType: 'LEGAL' },
    commercialTerms: { summary: 'شرایط تجاری هنوز ثبت نشده است.', options: [{ id: 'fixture-331-commercial', label: 'شرایط مصوب فروش همکار' }] },
    creditTerms: { summary: 'شرایط اعتبار هنوز ثبت نشده است.', options: [{ id: 'fixture-331-credit', label: 'پرداخت نقدی مصوب حسابداری' }] },
    responder: { eligibleOptions: [{ id: 'fixture-331-responder', label: 'پاسخ‌دهنده آزمایشی' }], pendingInquiries: [{
      inquiryId: 'fixture-331-inquiry', assignmentRevision: 1, label: 'استعلام نمونه سنگ طولی', actions: [] }] },
    conversion: { started: false, irreversible: false, blockers: [], dispositionEvidenceIds: ['fixture-331-disposition'] },
  };
  const profiles = [profile];
  let transferPending = true;
  const actorId = `fixture-331-${persona.toLowerCase()}`;
  function availability(action: PartnerActionV2, item?: PartnerManagementProfileViewV2): ActionAvailabilityV2 {
    const blocked = action === 'PROFILE_ACTIVATE' && item && !allReady(item);
    return { action, enabled: !blocked, ...(blocked ? { disabledReason: partnerError('DEPENDENCY_BLOCKED') } : {}),
      ...(persona === 'EXPIRED' ? { expiresAt: '2020-01-01T00:00:00.000Z' } : {}) };
  }
  function project(): PartnerManagementWorkspaceViewV2 {
    const allowed = grants[persona];
    const visible = persona !== 'MANAGER' && persona !== 'CRM';
    return PartnerManagementWorkspaceViewV2Schema.parse({ schemaVersion: 2, purpose: 'PARTNER_MANAGEMENT', actorId, personaLabel: personaLabels[persona],
      actions: allowed.includes('PROFILE_CREATE') ? [availability('PROFILE_CREATE')] : [],
      ...(allowed.includes('PROFILE_CREATE') ? { identityCandidates: [{ identityEvidenceId: 'fixture-331-new-identity', displayName: 'هویت آزمایشی آماده ایجاد' }] } : {}),
      profiles: visible ? profiles.map(item => {
        const currentActions = allowed.filter(action => action !== 'PROFILE_CREATE' && action !== 'CUSTOMER_TRANSFER_DECIDE')
          .filter(action => action !== 'PROFILE_ACTIVATE' || item.profile.status === 'PENDING' || item.profile.status === 'SUSPENDED')
          .filter(action => action !== 'PROFILE_SUSPEND' || item.profile.status === 'ACTIVE')
          .filter(action => action !== 'PROFILE_TERMINATE' || item.profile.status !== 'TERMINATED')
          .map(action => availability(action, item));
        return { profile: item.profile, displayName: item.displayName, actions: currentActions,
          ...(['HR', 'ADMIN'].includes(persona) ? { identity: item.identity } : {}),
          ...(allowed.includes('COMMERCIAL_TERMS_MANAGE') ? { commercialTerms: item.commercialTerms } : {}),
          ...(allowed.includes('CREDIT_TERMS_MANAGE') ? { creditTerms: item.creditTerms } : {}),
          ...(allowed.includes('RESPONDER_ASSIGN') ? { responder: { ...item.responder,
            pendingInquiries: item.responder!.pendingInquiries.map(inquiry => ({ ...inquiry, actions: [availability('RESPONDER_REASSIGN')] })) } } : {}),
          ...(allowed.includes('PROFILE_CONVERSION_MANAGE') ? { conversion: item.conversion } : {}),
        };
      }) : [],
      transfers: transferPending && allowed.includes('CUSTOMER_TRANSFER_DECIDE') ? [{ transferId: 'fixture-331-transfer', revision: 1,
        match: { schemaVersion: 1, purpose: 'DUPLICATE_MATCH', matchReference: 'fixture-331-match', displayName: 'مشتری آزمایشی', personType: 'NATURAL', city: 'تهران', maskedWitness: '****1234' },
        actions: [availability('CUSTOMER_TRANSFER_DECIDE')] }] : [],
    });
  }
  const queryPort: PartnerQueryV2Port = { async query<P extends keyof PartnerQueryV2Results>(query: Parameters<PartnerQueryV2Port['query']>[0]) {
    const result = query.purpose === 'PARTNER_MANAGEMENT' ? { ok: true as const, value: structuredClone(project()) } : { ok: false as const, error: partnerError('NOT_FOUND') };
    return result as Result<PartnerQueryV2Results[P]>;
  } };
  type LegacyResult = Awaited<ReturnType<PartnerCommandPort['execute']>>;
  type ManagementResult = Awaited<ReturnType<PartnerManagementCommandV2Port['execute']>>;
  const legacyLedger = new Map<string, { hash: string; result: LegacyResult }>();
  const managementLedger = new Map<string, { hash: string; result: ManagementResult }>();
  const commandPort: PartnerCommandPort = { async execute(input) {
    const command = PartnerCommandSchema.parse(input);
    const previous = legacyLedger.get(command.idempotency.key);
    if (previous) return previous.hash === command.idempotency.payloadHash ? structuredClone(previous.result) : { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    const action = command.type === 'PROFILE_TRANSITION' ? command.to === 'ACTIVE' ? 'PROFILE_ACTIVATE' : command.to === 'SUSPENDED' ? 'PROFILE_SUSPEND' : 'PROFILE_TERMINATE'
      : command.type === 'CUSTOMER_TRANSFER_DECIDE' ? 'CUSTOMER_TRANSFER_DECIDE' : command.type === 'INQUIRY_REASSIGN' ? 'RESPONDER_REASSIGN' : null;
    let result: LegacyResult = { ok: false, error: partnerError('FORBIDDEN') };
    if (command.idempotency.actorId === actorId && action && grants[persona].includes(action) && persona !== 'EXPIRED') {
      if (command.type === 'PROFILE_TRANSITION') {
        const item = profiles.find(item => item.profile.profileId === command.profileId);
        if (!item) result = { ok: false, error: partnerError('NOT_FOUND') };
        else if (item.profile.revision !== command.expectedRevision) result = { ok: false, error: partnerError('ROW_STALE') };
        else if (command.to === 'ACTIVE' && !allReady(item)) result = { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
        else { item.profile.status = command.to; item.profile.revision++; if (command.to === 'ACTIVE' && item.conversion) item.conversion.irreversible = true;
          result = { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: ['fixture-331-event'] } }; }
      } else if (command.type === 'CUSTOMER_TRANSFER_DECIDE' && command.transferId === 'fixture-331-transfer' && command.expectedRevision === 1 && transferPending) {
        transferPending = false; result = { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: ['fixture-331-transfer-event'] } };
      } else if (command.type === 'INQUIRY_REASSIGN') {
        const inquiry = profile.responder!.pendingInquiries.find(item => item.inquiryId === command.inquiryId);
        if (inquiry && inquiry.assignmentRevision === command.expectedAssignmentRevision && profile.responder!.eligibleOptions.some(option => option.id === command.responderId)) {
          inquiry.assignmentRevision++; result = { ok: true, value: { commandId: command.commandId, replayed: false, eventIds: ['fixture-331-assignment-event'] } };
        } else result = { ok: false, error: partnerError('ROW_STALE') };
      }
    }
    legacyLedger.set(command.idempotency.key, { hash: command.idempotency.payloadHash, result }); return structuredClone(result);
  } };
  const managementPort: PartnerManagementCommandV2Port = { async execute(input) {
    const command = PartnerManagementCommandV2Schema.parse(input);
    const previous = managementLedger.get(command.idempotency.key);
    if (previous) return previous.hash === command.idempotency.payloadHash ? structuredClone(previous.result) : { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
    const action: PartnerActionV2 = command.type === 'COMMERCIAL_TERMS_SET' ? 'COMMERCIAL_TERMS_MANAGE'
      : command.type === 'CREDIT_TERMS_SET' ? 'CREDIT_TERMS_MANAGE' : command.type === 'PROFILE_CONVERSION' ? 'PROFILE_CONVERSION_MANAGE' : command.type;
    let result: ManagementResult = { ok: false, error: partnerError('FORBIDDEN') };
    let changed = false;
    let item = 'profileId' in command ? profiles.find(item => item.profile.profileId === command.profileId) : undefined;
    if (command.idempotency.actorId === actorId && grants[persona].includes(action)) {
      if (command.type === 'PROFILE_CREATE' && command.identityEvidenceId === 'fixture-331-new-identity') {
        item = structuredClone(profile); item.profile.profileId = `fixture-331-profile-${profiles.length + 1}`;
        item.profile.partnerSellerId = `fixture-331-partner-${profiles.length + 1}`; item.displayName = 'همکار آزمایشی جدید'; profiles.push(item); changed = true;
      } else if (!item) result = { ok: false, error: partnerError('NOT_FOUND') };
      else if ('expectedRevision' in command && item.profile.revision !== command.expectedRevision) result = { ok: false, error: partnerError('ROW_STALE') };
      else {
        if (command.type === 'IDENTITY_VERIFY' && command.evidenceId === item.identity?.evidenceId) item.profile.identityVerified = true;
        else if (command.type === 'COMMERCIAL_TERMS_SET' && item.commercialTerms?.options.some(option => option.id === command.termsVersionId)) {
          item.commercialTerms.currentVersionId = command.termsVersionId; item.commercialTerms.summary = 'شرایط مصوب فروش همکار ثبت شده است.'; item.profile.commercialTermsReady = true;
        } else if (command.type === 'CREDIT_TERMS_SET' && item.creditTerms?.options.some(option => option.id === command.termsVersionId)) {
          item.creditTerms.currentVersionId = command.termsVersionId; item.creditTerms.summary = 'پرداخت نقدی مصوب حسابداری'; item.profile.creditTermsReady = true;
        } else if (command.type === 'RESPONDER_ASSIGN' && item.responder?.eligibleOptions.some(option => option.id === command.responderId)) {
          item.responder.currentId = command.responderId; item.responder.displayName = 'پاسخ‌دهنده آزمایشی'; item.profile.responderReady = true;
        } else if (command.type === 'PROFILE_CONVERSION' && item.conversion && !(command.transition === 'ABANDON' && item.conversion.irreversible)) {
          item.conversion.started = command.transition !== 'ABANDON'; item.profile.conversionCleared = command.transition === 'RESOLVE';
        } else item = undefined;
        if (item) { item.profile.revision++; changed = true; }
      }
      if (item && changed) result = {
        ok: true, value: { commandId: command.commandId, replayed: false, profileId: item.profile.profileId, revision: item.profile.revision, eventIds: ['fixture-331-management-event'] },
      };
    }
    managementLedger.set(command.idempotency.key, { hash: command.idempotency.payloadHash, result }); return structuredClone(result);
  } };
  return { queryPort, commandPort, managementPort };
}
