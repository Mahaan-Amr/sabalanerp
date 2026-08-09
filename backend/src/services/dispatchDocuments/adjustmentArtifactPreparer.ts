import { createHash, randomUUID } from 'node:crypto';
import type { DispatchArtifactPublisher, StatementAdjustmentRenderInput } from './contracts';
import type { DispatchArtifactStorage } from './ports';
import { DispatchDocumentIntegrityError, DispatchDocumentValidationError } from './service';

export type PreparedStatementAdjustmentArtifact = {
  id: string;
  templateVersion: string;
  storageKey: string;
  mediaType: 'application/pdf';
  byteLength: number;
  sha256: string;
  publishedAt: string;
};

export interface StatementAdjustmentArtifactPreparer {
  prepare(renderInput: StatementAdjustmentRenderInput): Promise<PreparedStatementAdjustmentArtifact>;
}

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const createStatementAdjustmentArtifactPreparer = (dependencies: {
  publisher: DispatchArtifactPublisher;
  storage: DispatchArtifactStorage;
  id?: () => string;
  now?: () => Date;
}): StatementAdjustmentArtifactPreparer => ({
  async prepare(renderInput) {
    if (renderInput.kind !== 'STATEMENT_ADJUSTMENT' || !Number.isInteger(renderInput.payload.sequence) || renderInput.payload.sequence <= 0) {
      throw new DispatchDocumentValidationError('A posted adjustment render input with a positive sequence is required.');
    }
    const output = await dependencies.publisher.publish(renderInput);
    if (output.mediaType !== 'application/pdf' || output.bytes.byteLength === 0) {
      throw new DispatchDocumentIntegrityError('Renderer did not produce a non-empty adjustment PDF.');
    }
    const id = (dependencies.id ?? randomUUID)();
    const storageKey = `dispatch-documents/${(dependencies.id ?? randomUUID)()}.pdf`;
    await dependencies.storage.stage({ storageKey, bytes: output.bytes });
    const verified = await dependencies.storage.read(storageKey);
    if (!verified || verified.byteLength !== output.bytes.byteLength || digest(verified) !== digest(output.bytes)) {
      throw new DispatchDocumentIntegrityError('Staged statement adjustment artifact failed verification.');
    }
    return { id, templateVersion: renderInput.templateVersion, storageKey, mediaType: 'application/pdf',
      byteLength: verified.byteLength, sha256: digest(verified), publishedAt: (dependencies.now ?? (() => new Date()))().toISOString() };
  },
});
