const VIEW_SUFFIX = '_view';
const ACTION_SUFFIXES = [
  '_create', '_edit', '_delete', '_approve', '_reject', '_sign', '_print',
  '_import', '_export', '_update', '_toggle', '_start', '_end', '_assign',
  '_verify', '_validate', '_send',
];

export const featurePrerequisites = (
  feature: string,
  availableFeatures: readonly string[],
): string[] => {
  const actionSuffix = ACTION_SUFFIXES.find((suffix) => feature.endsWith(suffix));
  if (!actionSuffix) return [];
  const viewFeature = `${feature.slice(0, -actionSuffix.length)}${VIEW_SUFFIX}`;
  return availableFeatures.includes(viewFeature) ? [viewFeature] : [];
};
