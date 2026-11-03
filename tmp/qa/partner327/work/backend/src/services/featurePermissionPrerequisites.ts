const ACTION_SUFFIXES = [
  '_cancel_after_approval', '_update_status', '_assign_owner', '_approve_void',
  '_create', '_edit', '_delete', '_approve', '_reject', '_sign', '_print',
  '_import', '_export', '_update', '_toggle', '_start', '_end', '_assign',
  '_verify', '_validate', '_send', '_manage', '_finalize', '_cancel', '_lock',
  '_blacklist', '_reassign', '_generate', '_archive', '_attributes', '_template',
  '_stats',
];

const EXPLICIT_VIEW_REQUIREMENTS: Record<string, string> = {
  crm_project_addresses: 'crm_customers_view',
  crm_phone_numbers: 'crm_customers_view',
  sales_contract_items: 'sales_contracts_view',
  sales_verification: 'sales_contracts_view',
  logistics_corrections: 'logistics_loadings_view',
};

const workspaceDashboard = (feature: string) => `${feature.split('_')[0]}_dashboard_view`;

export const featurePrerequisites = (
  feature: string,
  availableFeatures: readonly string[],
): string[] => {
  if (feature.endsWith('_view')) return [];
  const available = new Set(availableFeatures);
  const explicitPrefix = Object.keys(EXPLICIT_VIEW_REQUIREMENTS).find((prefix) => feature.startsWith(`${prefix}_`));
  if (explicitPrefix && available.has(EXPLICIT_VIEW_REQUIREMENTS[explicitPrefix])) return [EXPLICIT_VIEW_REQUIREMENTS[explicitPrefix]];

  const suffix = ACTION_SUFFIXES.find((candidate) => feature.endsWith(candidate));
  if (suffix) {
    const stem = feature.slice(0, -suffix.length);
    const exactView = `${stem}_view`;
    if (available.has(exactView)) return [exactView];
  }

  const dashboard = workspaceDashboard(feature);
  return available.has(dashboard) ? [dashboard] : [];
};

export const expandFeaturePrerequisites = (
  selectedFeatures: readonly string[],
  availableFeatures: readonly string[],
) => {
  const selected = new Set<string>();
  const include = (feature: string) => {
    if (selected.has(feature)) return;
    for (const prerequisite of featurePrerequisites(feature, availableFeatures)) include(prerequisite);
    selected.add(feature);
  };
  selectedFeatures.forEach(include);
  return [...selected];
};
