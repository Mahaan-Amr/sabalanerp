import type { DispatchArtifactStorage, StatementAdjustmentArtifactPreparer } from './dispatchDocuments';

export type ConfiguredStatementAdjustmentArtifactPreparer = {
  templateVersion: string;
  preparer: StatementAdjustmentArtifactPreparer;
  storage: DispatchArtifactStorage;
};

let configured: ConfiguredStatementAdjustmentArtifactPreparer | null = null;

export const installStatementAdjustmentArtifactPreparer = (
  value: ConfiguredStatementAdjustmentArtifactPreparer,
) => {
  configured = value;
};

export const getStatementAdjustmentArtifactPreparer = () => configured;
