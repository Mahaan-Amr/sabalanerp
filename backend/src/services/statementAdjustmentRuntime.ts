import type { StatementAdjustmentArtifactPreparer } from './dispatchDocuments';

export type ConfiguredStatementAdjustmentArtifactPreparer = {
  templateVersion: string;
  preparer: StatementAdjustmentArtifactPreparer;
};

let configured: ConfiguredStatementAdjustmentArtifactPreparer | null = null;

export const installStatementAdjustmentArtifactPreparer = (
  value: ConfiguredStatementAdjustmentArtifactPreparer,
) => {
  configured = value;
};

export const getStatementAdjustmentArtifactPreparer = () => configured;
