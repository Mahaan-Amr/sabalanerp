export type AccessLevel = 'view' | 'edit' | 'admin';

export type AccessFeatureDefinition = {
  key: string;
  workspace: string;
  label: string;
  requiredLevel: AccessLevel;
  prerequisites: string[];
};

export type AccessDraft = {
  workspaceLevels: Record<string, AccessLevel | null>;
  explicitlySelectedFeatures: Set<string>;
  selectedFeatures: Set<string>;
  automaticallyAddedFeatures: Set<string>;
};

type DraftInput = {
  workspaceLevels?: Record<string, AccessLevel | null>;
  explicitlySelectedFeatures?: Iterable<string>;
};

const closePrerequisites = (
  explicit: ReadonlySet<string>,
  definitions: readonly AccessFeatureDefinition[],
) => {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const selected = new Set<string>();
  const include = (key: string) => {
    if (selected.has(key)) return;
    for (const prerequisite of byKey.get(key)?.prerequisites ?? []) include(prerequisite);
    selected.add(key);
  };
  explicit.forEach(include);
  return selected;
};

const rebuild = (
  workspaceLevels: Record<string, AccessLevel | null>,
  explicit: Set<string>,
  definitions: readonly AccessFeatureDefinition[],
): AccessDraft => {
  const selectedFeatures = closePrerequisites(explicit, definitions);
  return {
    workspaceLevels: { ...workspaceLevels },
    explicitlySelectedFeatures: explicit,
    selectedFeatures,
    automaticallyAddedFeatures: new Set(
      Array.from(selectedFeatures).filter((feature) => !explicit.has(feature)),
    ),
  };
};

export const createAccessDraft = (input: DraftInput = {}): AccessDraft => {
  const explicit = new Set(input.explicitlySelectedFeatures ?? []);
  return {
    workspaceLevels: { ...input.workspaceLevels },
    explicitlySelectedFeatures: explicit,
    selectedFeatures: new Set(explicit),
    automaticallyAddedFeatures: new Set(),
  };
};

export const setFeatureSelection = (
  draft: AccessDraft,
  definitions: readonly AccessFeatureDefinition[],
  feature: string,
  selected: boolean,
): AccessDraft => {
  const explicit = new Set(draft.explicitlySelectedFeatures);
  if (selected) explicit.add(feature);
  else explicit.delete(feature);
  return rebuild(draft.workspaceLevels, explicit, definitions);
};

export const selectAllInWorkspace = (
  draft: AccessDraft,
  definitions: readonly AccessFeatureDefinition[],
  workspace: string,
  level: AccessLevel,
): AccessDraft => {
  const explicit = new Set(draft.explicitlySelectedFeatures);
  definitions.filter((definition) => definition.workspace === workspace).forEach(({ key }) => explicit.add(key));
  return rebuild({ ...draft.workspaceLevels, [workspace]: level }, explicit, definitions);
};

export const deselectAllInWorkspace = (
  draft: AccessDraft,
  definitions: readonly AccessFeatureDefinition[],
  workspace: string,
): AccessDraft => {
  const workspaceFeatures = new Set(
    definitions.filter((definition) => definition.workspace === workspace).map(({ key }) => key),
  );
  const explicit = new Set(
    Array.from(draft.explicitlySelectedFeatures).filter((feature) => !workspaceFeatures.has(feature)),
  );
  return rebuild({ ...draft.workspaceLevels, [workspace]: null }, explicit, definitions);
};
