import path from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { HR_HIRING_STORAGE_DIR } from './hrHiringFileStorage';
import { stableDeletionFingerprint } from './hrRecordRetentionPolicy';

export type DeletionRelation = { childModel: string; childField: string; parentModel: string; childRequired: boolean;
  childFields?: string[]; parentFields?: string[]; nullableFields?: string[] };
type ModelShape = { name: string; primaryKey?: { fields: string[] } | null;
  fields: Array<{ name: string; kind: string; type?: string; isId?: boolean; isRequired?: boolean; relationFromFields?: string[]; relationToFields?: string[] }> };
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

const keyFailure = (): never => { throw new Error('ساختار کلید رکورد در دامنه حذف پرسنل پشتیبانی نمی‌شود.'); };
const modelIdentity = (model: ModelShape) => {
  const names = model.primaryKey?.fields.length ? model.primaryKey.fields : model.fields.filter(field => field.isId).map(field => field.name);
  const fields = names.map(name => model.fields.find(field => field.name === name) || keyFailure());
  if (!fields.length || fields.some(field => !['String', 'Int'].includes(field.type || '') && field.kind !== 'enum')) keyFailure();
  const plain = fields.length === 1 && fields[0].type !== 'Int';
  const values = (row: Record<string, unknown>) => fields.map(field => {
    const value = row[field.name];
    if (field.type === 'Int' ? !Number.isSafeInteger(value) : typeof value !== 'string') keyFailure();
    return value as string | number;
  });
  const decode = (key: string) => {
    if (plain) return { [fields[0].name]: key };
    let tuple: unknown;
    try { tuple = JSON.parse(key); } catch { return keyFailure(); }
    if (!Array.isArray(tuple) || tuple.length !== fields.length) return keyFailure();
    const row = Object.fromEntries(fields.map((field, index) => [field.name, tuple[index]]));
    values(row); return row;
  };
  return { select: Object.fromEntries(fields.map(field => [field.name, true])),
    encode: (row: Record<string, unknown>) => { const tuple = values(row); return plain ? String(tuple[0]) : JSON.stringify(tuple); },
    where: (keys: string[]) => { if (!keys.length) return keyFailure(); return { OR: keys.map(decode) }; } };
};
const chunks = <T>(values: T[], size = 500): T[][] => {
  const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};
const identities = (models: ModelShape[]) => new Map(models.map(model => [model.name, modelIdentity(model)]));
const relationPredicates = async (client: PrismaClient | Prisma.TransactionClient, relation: DeletionRelation,
  parentKeys: string[], keys: ReturnType<typeof identities>) => {
  const childFields = relation.childFields || [relation.childField], parentFields = relation.parentFields || ['id'];
  const predicates: Record<string, unknown>[] = [];
  for (const batch of chunks(parentKeys)) {
    const rows = await (client as any)[delegateName(relation.parentModel)].findMany({
      where: keys.get(relation.parentModel)!.where(batch), select: Object.fromEntries(parentFields.map(field => [field, true])),
    });
    for (const row of rows) if (parentFields.every(field => row[field] !== null && row[field] !== undefined)) {
      predicates.push(Object.fromEntries(childFields.map((field, index) => [field, row[parentFields[index]]])));
    }
  }
  return chunks(predicates);
};

export const buildDeletionRelationIndex = (models: ModelShape[]): DeletionRelation[] => models.flatMap((model) => {
  if (excludedModels.has(model.name)) return [];
  const relationBackedFields = new Set(model.fields.flatMap((field) => field.kind === 'object' ? field.relationFromFields || [] : []));
  const declared = model.fields.flatMap((field) => {
    if (field.kind !== 'object' || !field.type) return [];
    if (!field.relationFromFields?.length || field.relationFromFields.length !== field.relationToFields?.length) return [];
    if (model.name === field.type) return [];
    // Retain the complete foreign-key tuple, including alternate parent keys.
    // An id-shaped projection is not a row identity for every Prisma model.
    const parentIdIndex = field.relationToFields.indexOf('id');
    const childField = field.relationFromFields[parentIdIndex < 0 ? 0 : parentIdIndex];
    const nullableFields = field.relationFromFields.filter(name => model.fields.find(candidate => candidate.name === name)?.isRequired === false);
    return [{ childModel: model.name, childField, parentModel: field.type, childRequired: nullableFields.length === 0,
      childFields: field.relationFromFields, parentFields: field.relationToFields, nullableFields }];
  });
  const scalarUserReferences = model.fields.flatMap((field) => {
    if (scalarAttributionExcludedModels.has(model.name)) return [];
    if (field.kind !== 'scalar' || field.type !== 'String' || relationBackedFields.has(field.name)) return [];
    if (!/(?:By|ById|UserId|userId)$/.test(field.name)) return [];
    return [{ childModel: model.name, childField: field.name, parentModel: 'User', childRequired: field.isRequired !== false,
      childFields: [field.name], parentFields: ['id'], nullableFields: field.isRequired === false ? [field.name] : [] }];
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
  HrCompanyEvaluationOccurrence: { fields: ['resultStorageName'], storageRoot: HR_HIRING_STORAGE_DIR, category: 'COMPANY_EVALUATION' },
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
  const keys = identities(models);
  if (!Number.isSafeInteger(maximumNodes) || maximumNodes < 1 || maximumNodes > 50_000) keyFailure();
  const relations = buildDeletionRelationIndex(models);
  const selected = new Map<string, Set<string>>([['Personnel', new Set([personnelId])]]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relation of relations) {
      const parentIds = [...(selected.get(relation.parentModel) || [])];
      if (!parentIds.length) continue;
      const childSet = selected.get(relation.childModel) || new Set<string>();
      const childIdentity = keys.get(relation.childModel)!;
      for (const predicates of await relationPredicates(client, relation, parentIds, keys)) {
        const rows = await (client as any)[delegateName(relation.childModel)].findMany({
          where: { OR: predicates }, select: childIdentity.select, take: maximumNodes + 1,
        });
        for (const row of rows) {
          const key = childIdentity.encode(row);
          if (!childSet.has(key)) { childSet.add(key); changed = true; }
        }
        if (childSet.size > maximumNodes) throw new Error('دامنه حذف پرسنل از حد مجاز بزرگ‌تر است.');
      }
      if (childSet.size) selected.set(relation.childModel, childSet);
      const total = [...selected.values()].reduce((sum, ids) => sum + ids.size, 0);
      if (total > maximumNodes) throw new Error(`دامنه حذف بیش از ${maximumNodes.toLocaleString('fa-IR')} رکورد است و نیازمند بررسی فنی مستقل است.`);
    }
    const applicationIds = [...(selected.get('HrJobApplication') || [])];
    if (applicationIds.length) {
      const workItemSet = selected.get('HrWorkItem') || new Set<string>();
      const applicationWorkItems = await (client as any).hrWorkItem.findMany({
        where: {
          sourceType: 'HIRING_ACTION',
          OR: applicationIds.map((applicationId) => ({
            sourceKey: { startsWith: `HIRING:${applicationId}:` },
          })),
        },
        select: { id: true },
      });
      for (const workItem of applicationWorkItems) {
        if (!workItemSet.has(workItem.id)) {
          workItemSet.add(workItem.id);
          changed = true;
        }
      }
      if (workItemSet.size) selected.set('HrWorkItem', workItemSet);
    }
    const total = [...selected.values()].reduce((sum, ids) => sum + ids.size, 0);
    if (total > maximumNodes) throw new Error(`دامنه حذف بیش از ${maximumNodes.toLocaleString('fa-IR')} رکورد است و نیازمند بررسی فنی مستقل است.`);
  }
  const root = await (client as any).personnel.findUnique({ where: { id: personnelId }, select: { id: true } });
  if (!root) throw new Error('پرسنل پیدا نشد.');
  const nodes: Record<string, string[]> = Object.fromEntries([...selected.entries()].map(([model, ids]) => [model, [...ids].sort()]));
  const counts = Object.fromEntries(Object.entries(nodes).sort(([left], [right]) => left.localeCompare(right)).map(([model, ids]) => [model, ids.length]));
  const recordDigests: PersonnelErasurePlan['recordDigests'] = [];
  for (const [modelName, ids] of Object.entries(nodes)) {
    const identity = keys.get(modelName)!;
    for (const batch of chunks(ids)) {
      const rows = await (client as any)[delegateName(modelName)].findMany({ where: identity.where(batch) });
      for (const row of rows) recordDigests.push({ model: modelName, id: identity.encode(row), digest: stableDeletionFingerprint(row, secret) });
    }
  }
  recordDigests.sort((left, right) => `${left.model}:${left.id}`.localeCompare(`${right.model}:${right.id}`));
  const files: PersonnelErasurePlan['files'] = [];
  for (const [modelName, descriptor] of Object.entries(fileFields)) {
    const ids = nodes[modelName];
    if (!ids?.length) continue;
    for (const batch of chunks(ids)) {
      const rows = await (client as any)[delegateName(modelName)].findMany({
        where: keys.get(modelName)!.where(batch),
        select: Object.fromEntries(descriptor.fields.map((field) => [field, true]))
      });
      for (const row of rows) for (const field of descriptor.fields) {
        const storageName = descriptor.localUrl ? localUploadStorageName(row[field]) : row[field];
        if (storageName) files.push({ storageName, storageRoot: descriptor.storageRoot, category: descriptor.category });
      }
    }
  }
  for (const [modelName, descriptor] of Object.entries(jsonFileFields)) {
    const ids = nodes[modelName];
    if (!ids?.length) continue;
    for (const batch of chunks(ids)) {
      const rows = await (client as any)[delegateName(modelName)].findMany({
        where: keys.get(modelName)!.where(batch),
        select: Object.fromEntries(descriptor.fields.map((field) => [field, true]))
      });
      for (const row of rows) for (const field of descriptor.fields) for (const storageName of nestedLocalUploadNames(row[field])) {
        files.push({ storageName, storageRoot: descriptor.storageRoot, category: descriptor.category });
      }
    }
  }
  files.sort((left, right) => `${left.storageRoot}/${left.storageName}`.localeCompare(`${right.storageRoot}/${right.storageName}`));
  const order = deletionModelOrder(new Set(Object.keys(nodes)), relations);
  const fingerprint = stableDeletionFingerprint({ personnelId, nodes, recordDigests, files }, secret);
  return { personnelId, nodes, counts, order, recordDigests, files, fingerprint };
};

export const executePersonnelErasureGraph = async (client: Prisma.TransactionClient, plan: PersonnelErasurePlan) => {
  const models = Prisma.dmmf.datamodel.models as unknown as ModelShape[];
  const keys = identities(models), relations = buildDeletionRelationIndex(models);
  for (const relation of relations) {
    if (relation.childRequired) continue;
    const childIds = plan.nodes[relation.childModel];
    const parentIds = plan.nodes[relation.parentModel];
    if (!childIds?.length || !parentIds?.length) continue;
    for (const predicates of await relationPredicates(client, relation, parentIds, keys)) for (const batch of chunks(childIds)) {
      await (client as any)[delegateName(relation.childModel)].updateMany({
        where: { AND: [keys.get(relation.childModel)!.where(batch), { OR: predicates }] },
        data: Object.fromEntries((relation.nullableFields || [relation.childField]).map(field => [field, null])),
      });
    }
  }
  for (const model of plan.order) {
    const ids = plan.nodes[model];
    if (!ids?.length) continue;
    for (const batch of chunks(ids)) await (client as any)[delegateName(model)].deleteMany({ where: keys.get(model)!.where(batch) });
  }
};
