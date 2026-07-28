import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { HR_HIRING_STORAGE_DIR } from './hrHiringFileStorage';
import { stableDeletionFingerprint } from './hrRecordRetentionPolicy';

export type DeletionRelation = { childModel: string; childField: string; parentModel: string; childRequired: boolean };
type ModelShape = { name: string; fields: Array<{ name: string; kind: string; type?: string; isRequired?: boolean; relationFromFields?: string[]; relationToFields?: string[] }> };
export type PersonnelErasurePlan = {
  personnelId: string;
  nodes: Record<string, string[]>;
  counts: Record<string, number>;
  order: string[];
  recordDigests: Array<{ model: string; id: string; digest: string }>;
  files: Array<{ storageName: string; storageRoot: string; category: string }>;
  fingerprint: string;
};

const excludedModels = new Set(['HrDeletionReceipt', 'HrDeletionFileCleanup']);
// Actor-only scalar columns in identity roots must not make one person's erasure
// absorb another identity record merely because that person created/archived it.
const scalarAttributionExcludedModels = new Set(['User', 'Personnel', 'HrCandidate']);
const delegateName = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

export const buildDeletionRelationIndex = (models: ModelShape[]): DeletionRelation[] => models.flatMap((model) => {
  if (excludedModels.has(model.name)) return [];
  const relationBackedFields = new Set(model.fields.flatMap((field) => field.kind === 'object' ? field.relationFromFields || [] : []));
  const declared = model.fields.flatMap((field) => {
    if (field.kind !== 'object' || !field.type) return [];
    if (field.relationFromFields?.length !== 1 || field.relationToFields?.length !== 1 || field.relationToFields[0] !== 'id') return [];
    if (model.name === field.type) return [];
    const childField = field.relationFromFields[0];
    const scalar = model.fields.find((candidate) => candidate.name === childField);
    return [{ childModel: model.name, childField, parentModel: field.type, childRequired: scalar?.isRequired !== false }];
  });
  const scalarUserReferences = model.fields.flatMap((field) => {
    if (scalarAttributionExcludedModels.has(model.name)) return [];
    if (field.kind !== 'scalar' || field.type !== 'String' || relationBackedFields.has(field.name)) return [];
    if (!/(?:By|ById|UserId|userId)$/.test(field.name)) return [];
    return [{ childModel: model.name, childField: field.name, parentModel: 'User', childRequired: field.isRequired !== false }];
  });
  return [...declared, ...scalarUserReferences];
});

export const deletionModelOrder = (selectedModels: Set<string>, relations: DeletionRelation[]) => {
  const remaining = new Set(selectedModels);
  const order: string[] = [];
  while (remaining.size) {
    const blockedParents = new Set(relations
      .filter((relation) => relation.childRequired && relation.childModel !== relation.parentModel && remaining.has(relation.childModel) && remaining.has(relation.parentModel))
      .map((relation) => relation.parentModel));
    const ready = [...remaining].filter((model) => !blockedParents.has(model)).sort();
    if (!ready.length) throw new Error('چرخه وابستگی پشتیبانی‌نشده در دامنه حذف پرسنل شناسایی شد.');
    for (const model of ready) { order.push(model); remaining.delete(model); }
  }
  return order;
};

const UPLOAD_IMAGES_DIR = path.join(process.cwd(), 'uploads', 'images');
const fileFields: Record<string, { fields: string[]; storageRoot: string; category: string; localUrl?: boolean }> = {
  HrHiringDocument: { fields: ['storageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'HIRING_DOCUMENT' },
  HrPreIdentityChecklistItem: { fields: ['storageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'PRE_IDENTITY_EVIDENCE' },
  HrCollateralItem: { fields: ['storageName', 'returnEvidenceStorageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'COLLATERAL_EVIDENCE' },
  HrCandidateAssessment: { fields: ['storageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'ASSESSMENT' },
  HrEmploymentContractDocument: { fields: ['storageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'EMPLOYMENT_CONTRACT' },
  SecurityShiftLogAttachment: { fields: ['storageName'], storageRoot: path.join(process.cwd(), 'uploads', 'security-shift-log'), category: 'SECURITY_SHIFT_ATTACHMENT' },
  SecurityVehiclePairPhoto: { fields: ['storageName'], storageRoot: path.join(process.cwd(), 'uploads', 'security-vehicle-pairs'), category: 'SECURITY_VEHICLE_PHOTO' },
  SecurityVehicleAttachment: { fields: ['url'], storageRoot: UPLOAD_IMAGES_DIR, category: 'SECURITY_VEHICLE_ATTACHMENT', localUrl: true },
};
const jsonFileFields: Record<string, { fields: string[]; storageRoot: string; category: string }> = {
  CrmCommunication: { fields: ['attachments'], storageRoot: UPLOAD_IMAGES_DIR, category: 'CRM_ATTACHMENT' },
  SecuritySupervisorReport: { fields: ['attachments'], storageRoot: UPLOAD_IMAGES_DIR, category: 'SECURITY_REPORT_ATTACHMENT' },
};

export const localUploadStorageName = (value: unknown) => {
  const normalized = String(value || '').split(/[?#]/, 1)[0].replace(/\\/g, '/');
  if (!normalized.includes('/files/uploads/images/') && !normalized.includes('/uploads/images/')) return null;
  return path.posix.basename(normalized) || null;
};

const nestedLocalUploadNames = (value: unknown): string[] => {
  if (typeof value === 'string') return localUploadStorageName(value) ? [localUploadStorageName(value)!] : [];
  if (Array.isArray(value)) return value.flatMap(nestedLocalUploadNames);
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap(nestedLocalUploadNames);
  return [];
};

export const buildPersonnelErasurePlan = async (
  client: PrismaClient | Prisma.TransactionClient,
  personnelId: string,
  secret = process.env.JWT_SECRET || 'development-secret',
  maximumNodes = 50_000,
): Promise<PersonnelErasurePlan> => {
  const models = Prisma.dmmf.datamodel.models as unknown as ModelShape[];
  const relations = buildDeletionRelationIndex(models);
  const selected = new Map<string, Set<string>>([['Personnel', new Set([personnelId])]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      const parentIds = [...(selected.get(relation.parentModel) || [])];
      if (!parentIds.length) continue;
      const childSet = selected.get(relation.childModel) || new Set<string>();
      const rows = await (client as any)[delegateName(relation.childModel)].findMany({
        where: { [relation.childField]: { in: parentIds } },
        select: { id: true }
      });
      for (const row of rows) {
        if (!childSet.has(row.id)) { childSet.add(row.id); changed = true; }
      }
      if (childSet.size) selected.set(relation.childModel, childSet);
      const total = [...selected.values()].reduce((sum, ids) => sum + ids.size, 0);
      if (total > maximumNodes) throw new Error(`دامنه حذف بیش از ${maximumNodes.toLocaleString('fa-IR')} رکورد است و نیازمند بررسی فنی مستقل است.`);
    }
  }
  const root = await (client as any).personnel.findUnique({ where: { id: personnelId }, select: { id: true } });
  if (!root) throw new Error('پرسنل پیدا نشد.');
  const nodes: Record<string, string[]> = Object.fromEntries([...selected.entries()].map(([model, ids]) => [model, [...ids].sort()]));
  const counts = Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => left.localeCompare(right)).map(([model, ids]) => [model, ids.length]));
  const recordDigests: PersonnelErasurePlan['recordDigests'] = [];
  for (const [modelName, ids] of Object.entries(nodes)) {
    const rows = await (client as any)[delegateName(modelName)].findMany({ where: { id: { in: ids } } });
    for (const row of rows) recordDigests.push({ model: modelName, id: row.id, digest: stableDeletionFingerprint(row, secret) });
  }
  recordDigests.sort((left, right) => `${left.model}:${left.id}`.localeCompare(`${right.model}:${right.id}`));
  const files: PersonnelErasurePlan['files'] = [];
  for (const [modelName, descriptor] of Object.entries(fileFields)) {
    const ids = nodes[modelName];
    if (!ids?.length) continue;
    const rows = await (client as any)[delegateName(modelName)].findMany({
      where: { id: { in: ids } },
      select: Object.fromEntries(descriptor.fields.map((field) => [field, true]))
    });
    for (const row of rows) for (const field of descriptor.fields) {
      const storageName = descriptor.localUrl ? localUploadStorageName(row[field]) : row[field];
      if (storageName) files.push({ storageName, storageRoot: descriptor.storageRoot, category: descriptor.category });
    }
  }
  for (const [modelName, descriptor] of Object.entries(jsonFileFields)) {
    const ids = nodes[modelName];
    if (!ids?.length) continue;
    const rows = await (client as any)[delegateName(modelName)].findMany({
      where: { id: { in: ids } },
      select: Object.fromEntries(descriptor.fields.map((field) => [field, true]))
    });
    for (const row of rows) for (const field of descriptor.fields) for (const storageName of nestedLocalUploadNames(row[field])) {
      files.push({ storageName, storageRoot: descriptor.storageRoot, category: descriptor.category });
    }
  }
  files.sort((left, right) => `${left.storageRoot}/${left.storageName}`.localeCompare(`${right.storageRoot}/${right.storageName}`));
  const order = deletionModelOrder(new Set(Object.keys(nodes)), relations);
  const fingerprint = stableDeletionFingerprint({ personnelId, nodes, recordDigests, files }, secret);
  return { personnelId, nodes, counts, order, recordDigests, files, fingerprint };
};

export const executePersonnelErasureGraph = async (client: Prisma.TransactionClient, plan: PersonnelErasurePlan) => {
  const relations = buildDeletionRelationIndex(Prisma.dmmf.datamodel.models as unknown as ModelShape[]);
  for (const relation of relations) {
    if (relation.childRequired) continue;
    const childIds = plan.nodes[relation.childModel];
    const parentIds = plan.nodes[relation.parentModel];
    if (!childIds?.length || !parentIds?.length) continue;
    await (client as any)[delegateName(relation.childModel)].updateMany({
      where: { id: { in: childIds }, [relation.childField]: { in: parentIds } },
      data: { [relation.childField]: null }
    });
  }
  for (const model of plan.order) {
    const ids = plan.nodes[model];
    if (!ids?.length) continue;
    await (client as any)[delegateName(model)].deleteMany({ where: { id: { in: ids } } });
  }
};
