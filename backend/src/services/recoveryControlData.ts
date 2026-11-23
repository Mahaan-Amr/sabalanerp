/** Uploaded application data cannot replace the current deployment's authority. */
export const APPLICATION_RECOVERY_CONTROL_TABLES = [
  'public.deployment_operations',
  'public.customer_allocation_release_control',
  'public.customer_allocation_release_audit',
  'public.partner_release_readiness_publications',
] as const;

export const APPLICATION_RECOVERY_CONTROL_SEQUENCES = ['public.customer_allocation_release_audit_id_seq'] as const;
