import type { DispatchArtifactPublisher, StatementAdjustmentRenderInput } from './contracts';
import type { DispatchArtifactStorage } from './ports';
import { DispatchDocumentValidationError } from './service';
import { prepareDispatchArtifact } from './artifactPreparation';

export type PreparedStatementAdjustmentArtifact = {
  id: string;
  templateVersion: string;
  generatorVersion: string;
  sourceVersionIdentities: Readonly<Record<string, string>>;
  storageKey: string;
  mediaType: 'application/pdf';
  byteLength: number;
  sha256: string;
  publishedAt: string;
};

export interface StatementAdjustmentArtifactPreparer {
  prepare(renderInput: StatementAdjustmentRenderInput): Promise<PreparedStatementAdjustmentArtifact>;
}

export const createStatementAdjustmentArtifactPreparer = (dependencies: {
  publisher: DispatchArtifactPublisher;
  storage: DispatchArtifactStorage;
  id?: () => string;
  now?: () => Date;
  generatorVersion: string;
  sourceVersionIdentities: Readonly<Record<string, string>>;
}): StatementAdjustmentArtifactPreparer => ({
  async prepare(renderInput) {
    if (renderInput.kind !== 'STATEMENT_ADJUSTMENT' || !Number.isInteger(renderInput.payload.sequence) || renderInput.payload.sequence <= 0) {
      throw new DispatchDocumentValidationError('A posted adjustment render input with a positive sequence is required.');
    }
    const { kind: _kind, ...artifact } = await prepareDispatchArtifact(dependencies, renderInput);
    return { ...artifact, generatorVersion: dependencies.generatorVersion,
      sourceVersionIdentities: dependencies.sourceVersionIdentities };
  },
});
