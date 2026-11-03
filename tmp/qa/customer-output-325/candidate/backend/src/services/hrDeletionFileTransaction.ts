import fs from 'node:fs';
import path from 'node:path';
import { HR_HIRING_STORAGE_DIR } from './hrHiringFileStorage';

export type StagedHiringFile = { originalPath: string; stagedPath: string; storageName: string };

const assertStagedRecord = (item: StagedHiringFile) => {
  const safeName = safeSegment(item.storageName, 'نام فایل');
  const expectedOriginal = path.join(path.dirname(item.originalPath), safeName);
  const trashRoot = path.join(path.dirname(item.originalPath), '.deletion-trash');
  const relativeStaged = path.relative(trashRoot, item.stagedPath);
  if (path.resolve(item.originalPath) !== path.resolve(expectedOriginal) || relativeStaged.startsWith('..') || path.isAbsolute(relativeStaged)) {
    throw new Error('مسیر فایل مرحله‌بندی‌شده ناامن است.');
  }
};

const safeSegment = (value: string, label: string) => {
  const safe = path.basename(value);
  if (!value || safe !== value || value === '.' || value === '..') throw new Error(`${label} ناامن است.`);
  return safe;
};

const restoreStagedFileList = (staged: StagedHiringFile[]) => {
  for (const item of [...staged].reverse()) {
    assertStagedRecord(item);
    if (!fs.existsSync(item.stagedPath)) continue;
    fs.mkdirSync(path.dirname(item.originalPath), { recursive: true });
    fs.renameSync(item.stagedPath, item.originalPath);
  }
};

export const planHiringFilesForDeletion = (
  storageNames: Array<string | null | undefined>,
  operationId: string,
  storageRoot = HR_HIRING_STORAGE_DIR,
) => {
  const safeOperationId = safeSegment(operationId, 'شناسه عملیات حذف');
  const trashDirectory = path.join(storageRoot, '.deletion-trash', safeOperationId);
  const planned: StagedHiringFile[] = [];
  for (const storageName of [...new Set(storageNames.filter(Boolean) as string[])]) {
    const safeName = safeSegment(storageName, 'نام فایل');
    const originalPath = path.join(storageRoot, safeName);
    if (!fs.existsSync(originalPath)) continue;
    planned.push({ originalPath, stagedPath: path.join(trashDirectory, safeName), storageName: safeName });
  }
  return planned;
};

export const stagePlannedHiringFiles = (planned: StagedHiringFile[]) => {
  const staged: StagedHiringFile[] = [];
  try {
    for (const item of planned) {
      assertStagedRecord(item);
      if (!fs.existsSync(item.originalPath)) continue;
      fs.mkdirSync(path.dirname(item.stagedPath), { recursive: true });
      fs.renameSync(item.originalPath, item.stagedPath);
      staged.push(item);
    }
  } catch (error) {
    restoreStagedFileList(staged);
    throw error;
  }
  return staged;
};

export const stageHiringFilesForDeletion = (
  storageNames: Array<string | null | undefined>,
  operationId: string,
  storageRoot = HR_HIRING_STORAGE_DIR,
) => stagePlannedHiringFiles(planHiringFilesForDeletion(storageNames, operationId, storageRoot));

export const restoreStagedHiringFiles = (staged: StagedHiringFile[]) => {
  restoreStagedFileList(staged);
};

export const commitStagedHiringFiles = (staged: StagedHiringFile[]) => {
  const failures: string[] = [];
  for (const item of staged) {
    try {
      assertStagedRecord(item);
      if (fs.existsSync(item.stagedPath)) fs.unlinkSync(item.stagedPath);
    } catch {
      failures.push(item.storageName);
    }
  }
  return failures;
};
