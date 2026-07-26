import { stableCanonicalJson } from './canonicalJson';

const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

export const hashCanonicalValue = (value: unknown): string => {
  const serialized = stableCanonicalJson(value);
  let hash = FNV_OFFSET_BASIS_64;

  for (let index = 0; index < serialized.length; index += 1) {
    const codeUnit = serialized.charCodeAt(index);
    hash ^= BigInt(codeUnit & 0xff);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
    hash ^= BigInt(codeUnit >>> 8);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }

  return `cpg-fnv1a64-${hash.toString(16).padStart(16, '0')}`;
};
