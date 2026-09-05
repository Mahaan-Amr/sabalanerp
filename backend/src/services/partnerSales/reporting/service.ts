import { randomUUID } from 'node:crypto';
import type { PermissionContext } from '../../../../../packages/partner-sales-contracts';
import { ContractRuntime, FrozenExport, Query, Report, ReportChannel, ReportExportStore, ReportingError, ReportingSnapshot, ReportingSource, Root } from './contracts';
import { projectReportRow, totalMetrics } from './projection';
import { sum } from './money';
import { effectiveThrough } from './revenue';

const purposes = ['PARTNER', 'MANAGEMENT', 'ACCOUNTING', 'FULFILLMENT'];
const states = ['DRAFT', 'AWAITING_CUSTOMER_CONFIRMATION', 'CUSTOMER_APPROVED', 'COMMITTED', 'CANCELLED', 'VOIDED'];

export class PartnerReportingService {
  constructor(private readonly runtime: ContractRuntime, private readonly source: ReportingSource,
    private readonly exports: ReportExportStore) {}

  private parse(input: Query): Query {
    if (!input || Object.keys(input).some(key => !['purpose', 'from', 'to', 'search', 'caseId', 'state', 'offset', 'limit'].includes(key))
      || !purposes.includes(input.purpose) || !this.runtime.DateSchema.safeParse(input.from).success
      || !this.runtime.DateSchema.safeParse(input.to).success || input.from > input.to
      || (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 160))
      || (input.caseId !== undefined && !this.runtime.IdSchema.safeParse(input.caseId).success)
      || (input.state !== undefined && !states.includes(input.state))
      || !Number.isSafeInteger(input.offset ?? 0) || (input.offset ?? 0) < 0
      || !Number.isSafeInteger(input.limit ?? 50) || (input.limit ?? 50) < 1 || (input.limit ?? 50) > 500) {
      throw new ReportingError('INVALID_PAYLOAD');
    }
    return { purpose: input.purpose, from: input.from, to: input.to, search: input.search?.trim() || '',
      ...(input.caseId ? { caseId: input.caseId } : {}), ...(input.state ? { state: input.state } : {}),
      offset: input.offset ?? 0, limit: input.limit ?? 50 };
  }

  private access(snapshot: ReportingSnapshot, query: Query): PermissionContext {
    this.runtime.IdSchema.parse(snapshot.snapshotId); this.runtime.InstantSchema.parse(snapshot.capturedAt);
    if (!snapshot.access.ok) throw new ReportingError(snapshot.access.error.code);
    const context = this.runtime.PermissionContextSchema.parse(snapshot.access.value);
    this.checkContext(context, query, snapshot.capturedAt);
    return context;
  }

  private checkContext(context: PermissionContext, query: Query, now: string) {
    // Projection invariants only; no role/workspace fallback can manufacture a grant.
    if (!context.resourceVisible || !context.actionGranted || context.purpose !== query.purpose
      || context.persona === 'PUBLIC' || (context.grantExpiresAt && context.grantExpiresAt <= now)
      || (context.scope === 'DEPARTMENT' && !context.departmentId)
      || (query.purpose === 'PARTNER' && (context.persona !== 'PARTNER' || context.scope !== 'OWN'
        || context.actorId !== context.partnerSellerId || !['ACTIVE', 'SUSPENDED'].includes(context.partnerStatus)))
      || (query.purpose !== 'PARTNER' && context.persona !== 'INTERNAL')
      || (query.purpose === 'MANAGEMENT' && !['DEPARTMENT', 'COMPANY'].includes(context.scope))
      || (['ACCOUNTING', 'FULFILLMENT'].includes(query.purpose) && !['PURPOSE_BOUND', 'DEPARTMENT', 'COMPANY'].includes(context.scope))) {
      throw new ReportingError('FORBIDDEN');
    }
  }

  private async allowed(snapshot: ReportingSnapshot, query: Query, root: Root, channel: ReportChannel, actorId: string) {
    const result = await snapshot.authorization(query.purpose, channel).authorize('REPORT_READ', { kind: 'CASE', id: root.caseId });
    if (!result.ok) {
      if (['NOT_FOUND', 'FORBIDDEN', 'PARTNER_NOT_ACTIVE'].includes(result.error.code)) return false;
      throw new ReportingError(result.error.code);
    }
    const context = this.runtime.PermissionContextSchema.parse(result.value);
    if (context.actorId !== actorId || context.root.kind !== 'CASE' || context.root.id !== root.caseId
      || context.partnerSellerId !== root.partnerSellerId || context.channel !== channel
      || (context.scope === 'OWN' && context.actorId !== root.partnerSellerId)
      || (context.scope === 'DEPARTMENT' && context.departmentId !== root.departmentId)) return false;
    try { this.checkContext(context, query, snapshot.capturedAt); } catch (error) {
      if (error instanceof ReportingError && error.code === 'FORBIDDEN') return false;
      throw error;
    }
    return true;
  }

  private async build(snapshot: ReportingSnapshot, query: Query, channel: ReportChannel, allRows = false) {
    const context = this.access(snapshot, query);
    const rows: Report['rows'] = []; const selectedRoots: Root[] = [];
    const seen = new Set<string>();
    for (const root of snapshot.roots) {
      if (seen.has(root.caseId)) throw new ReportingError('INTEGRITY_CONFLICT');
      seen.add(root.caseId);
      if (query.caseId && root.caseId !== query.caseId) continue;
      if (!await this.allowed(snapshot, query, root, channel, context.actorId)) continue;
      const data = await snapshot.caseEvidence(root, query.purpose);
      if (data.root.caseId !== root.caseId || data.root.partnerSellerId !== root.partnerSellerId
        || data.root.departmentId !== root.departmentId) throw new ReportingError('INTEGRITY_CONFLICT');
      const row = projectReportRow(this.runtime, data, query.purpose, { from: query.from, to: query.to, asOf: snapshot.capturedAt });
      const searchable = [row.caseNumber, row.customerContractNumber,
        ...(['MANAGEMENT', 'ACCOUNTING'].includes(query.purpose) ? [row.internalRecordNumber || ''] : [])];
      if (query.search && !searchable.some(number => number.toLocaleLowerCase('en').includes(query.search!.toLocaleLowerCase('en')))) continue;
      if (query.state && row.state !== query.state) continue;
      rows.push(row); selectedRoots.push(root);
    }
    rows.sort((a, b) => a.caseNumber.localeCompare(b.caseNumber) || a.caseId.localeCompare(b.caseId));
    if (query.caseId && !rows.length) throw new ReportingError('NOT_FOUND');
    const currencies = [...new Set(rows.flatMap(row => row.currency ? [row.currency] : []))].sort();
    const report: Report = { schemaVersion: 1, interfaceVersion: '1.0.0', snapshotId: snapshot.snapshotId, capturedAt: snapshot.capturedAt,
      scope: { purpose: query.purpose, kind: context.scope,
        ...(context.scope === 'DEPARTMENT' ? { departmentId: context.departmentId } : {}),
        ...(context.scope === 'OWN' ? { partnerSellerId: context.partnerSellerId } : {}),
        from: query.from, to: query.to, effectiveThrough: effectiveThrough({ from: query.from, to: query.to, asOf: snapshot.capturedAt }),
        search: query.search || '', state: query.state || null },
      count: rows.length, offset: allRows ? 0 : query.offset!, limit: allRows ? rows.length : query.limit!,
      rows: allRows ? rows : rows.slice(query.offset!, query.offset! + query.limit!),
      totals: currencies.map(currency => {
        const group = rows.filter(row => row.currency === currency);
        return { currency, metrics: totalMetrics(group, ['PARTNER', 'MANAGEMENT'].includes(query.purpose)),
          accountingBalance: group.some(row => row.account) ? sum(group.flatMap(row => row.account ? [row.account.balance.amount] : [])) : null,
          accountingReceivedAsOf: group.some(row => row.account) ? sum(group.flatMap(row => row.account ? [row.account.received.amount] : [])) : null,
          accountingCovered: group.filter(row => row.account !== null && row.account !== undefined).length,
          accountingEligible: group.length };
      }) };
    return { report, roots: selectedRoots, actorId: context.actorId };
  }

  async query(input: Query, channel: ReportChannel = input.search ? 'SEARCH' : 'LIST'): Promise<Report> {
    const query = this.parse(input);
    return this.source.read(query, async snapshot => (await this.build(snapshot, query, channel)).report);
  }

  async count(input: Query) {
    const report = await this.query(input, 'COUNT');
    return { snapshotId: report.snapshotId, capturedAt: report.capturedAt, scope: report.scope, count: report.count, totals: report.totals };
  }

  async detail(input: Query & { caseId: string }) { return this.query({ ...input, offset: 0, limit: 1 }, 'DETAIL'); }

  async createExport(input: Query) {
    const query = this.parse(input);
    const artifact = await this.source.read(query, async snapshot => {
      const result = await this.build(snapshot, query, 'EXPORT', true);
      const expiresAt = new Date(new Date(snapshot.capturedAt).getTime() + 15 * 60_000).toISOString();
      const artifact: FrozenExport = { id: randomUUID(), actorId: result.actorId, expiresAt,
        query, report: result.report, roots: result.roots, contentHash: await this.runtime.canonicalHash(result.report) };
      await snapshot.putExport(artifact);
      return artifact;
    });
    return { exportId: artifact.id, snapshotId: artifact.report.snapshotId, capturedAt: artifact.report.capturedAt,
      expiresAt: artifact.expiresAt, count: artifact.report.count };
  }

  async downloadExport(id: string): Promise<Report> {
    if (!this.runtime.IdSchema.safeParse(id).success) throw new ReportingError('NOT_FOUND');
    const artifact = await this.exports.get(id);
    if (!artifact) throw new ReportingError('NOT_FOUND');
    try {
      return await this.source.read(artifact.query, async snapshot => {
        const context = this.access(snapshot, artifact.query);
        if (artifact.actorId !== context.actorId || artifact.expiresAt <= snapshot.capturedAt) throw new ReportingError('NOT_FOUND');
        if (await this.runtime.canonicalHash(artifact.report) !== artifact.contentHash) throw new ReportingError('INTEGRITY_CONFLICT');
        for (const root of artifact.roots) {
          const current = snapshot.roots.find(candidate => candidate.caseId === root.caseId);
          if (!current || current.partnerSellerId !== root.partnerSellerId
            || !await this.allowed(snapshot, artifact.query, current, 'EXPORT', context.actorId)) throw new ReportingError('NOT_FOUND');
        }
        return structuredClone(artifact.report);
      });
    } catch (error) {
      if (error instanceof ReportingError && ['NOT_FOUND', 'FORBIDDEN', 'PARTNER_NOT_ACTIVE', 'CUSTOMER_OUT_OF_SCOPE', 'NOT_ASSIGNED'].includes(error.code)) {
        throw new ReportingError('NOT_FOUND');
      }
      throw error;
    }
  }
}
