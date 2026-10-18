import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { installDispatchDocumentsCommands } from '../dispatchAllocation';
import { createPrismaDispatchDocumentAccessPolicy } from './prismaAccessPolicy';
import { installStatementAdjustmentArtifactPreparer } from '../statementAdjustmentRuntime';
import { createStatementAdjustmentArtifactPreparer } from './adjustmentArtifactPreparer';
import type { DispatchArtifactPublisher } from './contracts';
import { createFilesystemDispatchArtifactStorage, createScopedVersionedFilesystemDispatchArtifactStorage } from './filesystemStorage';
import type { VersionedFileRootScope } from '../versionedFilePublication';
import { createDispatchIntegrityIncidentReporter } from './integrityIncidentReporter';
import { PrismaDispatchDocumentRepository } from './prismaRepository';
import { allocationPricingIntegrityVerifier, PrismaDispatchDocumentSourceReader } from './prismaSourceReader';
import { createDispatchDocuments } from './service';

export const configureDispatchDocumentsRuntime = (input: {
  prisma: PrismaClient;
  publisher: DispatchArtifactPublisher;
  templateVersion: string;
  generatorVersion: string;
  storageRoot?: string;
  filePublication?: VersionedFileRootScope;
}) => {
  const root = input.storageRoot || path.join(process.cwd(), 'storage', 'dispatch-documents');
  const storage = input.filePublication
    ? createScopedVersionedFilesystemDispatchArtifactStorage(root, input.filePublication)
    : createFilesystemDispatchArtifactStorage(root);
  const service = createDispatchDocuments({
    repository: new PrismaDispatchDocumentRepository(input.prisma, allocationPricingIntegrityVerifier, storage),
    sourceReader: new PrismaDispatchDocumentSourceReader(input.prisma, input.templateVersion, input.generatorVersion),
    publisher: input.publisher,
    storage,
    incidents: createDispatchIntegrityIncidentReporter(input.prisma),
    access: createPrismaDispatchDocumentAccessPolicy(input.prisma),
  });
  installDispatchDocumentsCommands(service);
  installStatementAdjustmentArtifactPreparer({
    templateVersion: input.templateVersion,
    storage,
    preparer: createStatementAdjustmentArtifactPreparer({
      publisher: input.publisher,
      storage,
      generatorVersion: input.generatorVersion,
      sourceVersionIdentities: {
        generatorVersion: input.generatorVersion,
        templateVersion: input.templateVersion,
      },
    }),
  });
  return service;
};
