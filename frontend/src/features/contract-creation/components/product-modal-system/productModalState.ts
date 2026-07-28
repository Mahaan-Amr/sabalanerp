import { normalizeDigits } from '@/lib/numberFormat';

export type ProductModalView =
  | 'main'
  | 'contract-remainders'
  | 'build-from-remainder'
  | 'source-selection';

export interface ProductModalDraftState<Draft> {
  readonly viewStack: readonly ProductModalView[];
  readonly draft: Draft;
  readonly dirty: boolean;
  readonly pending: boolean;
  readonly errors: Readonly<Record<string, string>>;
}

export type ProductModalDraftAction<Draft> =
  | { readonly type: 'change'; readonly update: (draft: Draft) => Draft }
  | { readonly type: 'enter-view'; readonly view: Exclude<ProductModalView, 'main'> }
  | { readonly type: 'back' }
  | { readonly type: 'validation-failed'; readonly errors: Readonly<Record<string, string>> }
  | { readonly type: 'save-started' }
  | { readonly type: 'save-failed'; readonly errors?: Readonly<Record<string, string>> }
  | { readonly type: 'save-finished' }
  | { readonly type: 'reset'; readonly draft: Draft };

export const createProductModalDraftState = <Draft>(
  draft: Draft
): ProductModalDraftState<Draft> => ({
  viewStack: ['main'],
  draft,
  dirty: false,
  pending: false,
  errors: {}
});

export const reduceProductModalDraft = <Draft>(
  state: ProductModalDraftState<Draft>,
  action: ProductModalDraftAction<Draft>
): ProductModalDraftState<Draft> => {
  switch (action.type) {
    case 'change':
      return {
        ...state,
        draft: action.update(state.draft),
        dirty: true,
        errors: {}
      };
    case 'enter-view':
      return state.pending
        ? state
        : { ...state, viewStack: [...state.viewStack, action.view], errors: {} };
    case 'back':
      return state.pending || state.viewStack.length === 1
        ? state
        : { ...state, viewStack: state.viewStack.slice(0, -1), errors: {} };
    case 'validation-failed':
      return { ...state, pending: false, errors: { ...action.errors } };
    case 'save-started':
      return state.pending ? state : { ...state, pending: true, errors: {} };
    case 'save-failed':
      return { ...state, pending: false, errors: { ...(action.errors ?? {}) } };
    case 'save-finished':
      return { ...state, pending: false, dirty: false, errors: {} };
    case 'reset':
      return createProductModalDraftState(action.draft);
  }
};

const normalizeUnsignedDecimal = (value: string): string => {
  const trimmed = normalizeDigits(value).replace(/[,\s]/g, '').trim();
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) return value;
  const [integer, fraction = ''] = trimmed.split('.');
  const normalizedInteger = integer.replace(/^0+(?=\d)/, '') || '0';
  const normalizedFraction = fraction.replace(/0+$/, '');
  return normalizedFraction
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
};

const shiftDecimal = (value: string, places: number): string => {
  const normalized = normalizeUnsignedDecimal(value);
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return value;
  const [integer, fraction = ''] = normalized.split('.');
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + places;
  const shifted = decimalIndex <= 0
    ? `0.${'0'.repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${'0'.repeat(decimalIndex - digits.length)}`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return normalizeUnsignedDecimal(shifted);
};

export type CompactLengthUnit = 'cm' | 'm';

export const convertCompactLengthUnit = (
  value: string,
  from: CompactLengthUnit,
  to: CompactLengthUnit
): string => {
  if (from === to || value.trim() === '') return value;
  return shiftDecimal(value, from === 'm' ? 2 : -2);
};

export const currentProductModalView = <Draft>(
  state: ProductModalDraftState<Draft>
): ProductModalView => state.viewStack[state.viewStack.length - 1];
