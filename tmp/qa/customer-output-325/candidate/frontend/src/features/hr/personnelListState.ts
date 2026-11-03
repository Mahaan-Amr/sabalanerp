export type PersonnelListState = {
  view: 'active' | 'archived';
  search: string;
  page: number;
  focus: string;
  panel: '' | 'schedule' | 'exceptional';
  relationshipStatus: string;
  attention: string;
  organizationalUnitId: string;
  workplaceId: string;
  costCenterId: string;
  dependencyAt: string;
  origin: string;
};

export const exceptionalPersonnelDraftKey = (userId: string) => `hr-personnel-draft:${userId}:exceptional`;
export const personnelScheduleDraftPrefix = (userId: string) => `hr-personnel-draft:${userId}:schedule:`;
export const personnelScheduleDraftKey = (userId: string, personnelId: string) => `${personnelScheduleDraftPrefix(userId)}${personnelId}`;

const clean = (value: string | null) => String(value ?? '').trim();

export const safePersonnelOrigin = (value: unknown) => {
  const candidate = clean(String(value ?? ''));
  if (!candidate.startsWith('/dashboard/') || candidate.startsWith('//') || /[\r\n]/.test(candidate)) return '';
  let parsed: URL;
  try { parsed = new URL(candidate, 'https://sabalan.local'); } catch { return ''; }
  const allowed = [
    /^\/dashboard\/hr\/?$/,
    /^\/dashboard\/hr\/(?:structure|hiring|migration|tasks|duties)(?:\/[^/?#]+)*\/?$/,
  ].some((pattern) => pattern.test(parsed.pathname));
  return allowed ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '';
};

export const parsePersonnelListState = (params: URLSearchParams): PersonnelListState => {
  const page = Number(params.get('page'));
  const panel = params.get('panel');
  return {
    view: params.get('view') === 'archived' ? 'archived' : 'active',
    search: clean(params.get('q')),
    page: Number.isInteger(page) && page > 0 ? page : 1,
    focus: clean(params.get('focus')),
    panel: panel === 'schedule' || panel === 'exceptional' ? panel : '',
    relationshipStatus: clean(params.get('relationshipStatus')),
    attention: clean(params.get('attention')),
    organizationalUnitId: clean(params.get('organizationalUnitId')),
    workplaceId: clean(params.get('workplaceId')),
    costCenterId: clean(params.get('costCenterId')),
    dependencyAt: clean(params.get('dependencyAt')),
    origin: safePersonnelOrigin(params.get('origin')),
  };
};

export const personnelListSearch = (state: PersonnelListState) => {
  const params = new URLSearchParams();
  if (state.view === 'archived') params.set('view', 'archived');
  if (state.search) params.set('q', state.search);
  if (state.relationshipStatus) params.set('relationshipStatus', state.relationshipStatus);
  if (state.attention) params.set('attention', state.attention);
  if (state.organizationalUnitId) params.set('organizationalUnitId', state.organizationalUnitId);
  if (state.workplaceId) params.set('workplaceId', state.workplaceId);
  if (state.costCenterId) params.set('costCenterId', state.costCenterId);
  if (state.dependencyAt) params.set('dependencyAt', state.dependencyAt);
  if (state.page > 1) params.set('page', String(state.page));
  if (state.focus) params.set('focus', state.focus);
  if (state.panel) params.set('panel', state.panel);
  if (state.origin) params.set('origin', state.origin);
  return params.toString();
};
