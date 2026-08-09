import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { installDispatchDocumentsCommands } from '../dispatchAllocation';
import { resolveNarrowFeatureAccess } from '../narrowFeatureAccess';
import type { DispatchArtifactPublisher } from './contracts';
import { createFilesystemDispatchArtifactStorage } from './filesystemStorage';
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
}) => {
  const service = createDispatchDocuments({
    repository: new PrismaDispatchDocumentRepository(input.prisma, allocationPricingIntegrityVerifier),
    sourceReader: new PrismaDispatchDocumentSourceReader(input.prisma, input.templateVersion, input.generatorVersion),
    publisher: input.publisher,
    storage: createFilesystemDispatchArtifactStorage(input.storageRoot || path.join(process.cwd(), 'storage', 'dispatch-documents')),
    incidents: createDispatchIntegrityIncidentReporter(input.prisma),
    access: { async canReadWaybill({ actorId }) {
      const actor = await input.prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, isActive: true } });
      if (!actor?.isActive) return false;
      return (await resolveNarrowFeatureAccess(input.prisma, { userId: actor.id, role: actor.role,
        workspace: 'accounting', feature: 'accounting_dispatch_candidates_view', requiredPermission: 'view' })).allowed;
    } },
  });
  installDispatchDocumentsCommands(service);
  return service;
};
