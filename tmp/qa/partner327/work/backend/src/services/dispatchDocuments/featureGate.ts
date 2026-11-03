export const CUSTOMER_SHIPMENT_STATEMENTS_GATE = 'CUSTOMER_SHIPMENT_STATEMENTS_ENABLED' as const;

type FeatureGateEnvironment = Readonly<Record<string, string | undefined>>;

export const isCustomerShipmentStatementsEnabled = (
  environment: FeatureGateEnvironment = process.env,
): boolean => environment[CUSTOMER_SHIPMENT_STATEMENTS_GATE] === 'true';

export type ShipmentStatementCutoverState = Readonly<{
  enabled: boolean;
  cutoverAt: Date | null;
}>;

export const isShipmentStatementFlowActive = (
  environment: FeatureGateEnvironment,
  cutover: ShipmentStatementCutoverState | null,
): boolean => isCustomerShipmentStatementsEnabled(environment)
  && cutover?.enabled === true
  && cutover.cutoverAt instanceof Date;

export const isPostCutoverFinalization = (finalizedAt: Date, cutoverAt: Date): boolean =>
  finalizedAt.getTime() >= cutoverAt.getTime();
