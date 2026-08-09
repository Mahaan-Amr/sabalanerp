import { createHash, randomUUID } from 'node:crypto';
import type { DispatchArtifactPublisher, DispatchDocumentRenderInput } from './contracts';
import type { DispatchArtifactStorage } from './ports';
import { DispatchDocumentIntegrityError } from './service';

export type PreparedDispatchArtifact = {
  id: string;
  kind: DispatchDocumentRenderInput['kind'];
  templateVersion: string;
  storageKey: string;
  mediaType: 'application/pdf';
  byteLength: number;
  sha256: string;
  publishedAt: string;
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const prepareDispatchArtifact = async (dependencies: {
  publisher: DispatchArtifactPublisher;
  storage: DispatchArtifactStorage;
  id?: () => string;
  now?: () => Date;
}, renderInput: DispatchDocumentRenderInput): Promise<PreparedDispatchArtifact> => {
  const output = await dependencies.publisher.publish(renderInput);
  if (output.mediaType !== 'application/pdf' || output.bytes.byteLength === 0) {
    throw new DispatchDocumentIntegrityError('Renderer did not produce a non-empty dispatch PDF.');
  }
  const createId = dependencies.id ?? randomUUID;
  const id = createId();
  const storageKey = `dispatch-documents/${createId()}.pdf`;
  await dependencies.storage.stage({ storageKey, bytes: output.bytes });
  const verified = await dependencies.storage.read(storageKey);
  if (!verified || verified.byteLength !== output.bytes.byteLength || digest(verified) !== digest(output.bytes)) {
    throw new DispatchDocumentIntegrityError('Staged dispatch artifact failed verification.');
  }
  return { id, kind: renderInput.kind, templateVersion: renderInput.templateVersion, storageKey,
    mediaType: 'application/pdf', byteLength: verified.byteLength, sha256: digest(verified),
    publishedAt: (dependencies.now ?? (() => new Date()))().toISOString() };
};
