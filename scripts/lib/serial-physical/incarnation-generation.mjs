/** Process-wide revocation for the one existing local PostgreSQL service.
 * Revocation grants nothing and cannot recreate a completion from a receipt. */
import assert from 'node:assert/strict';
let generation=0;
export function serialIncarnationGeneration(){return generation;}
export function invalidateSerialIncarnation(){generation++;}
export function assertSerialIncarnationGeneration(expected){assert.equal(generation,expected,'SERIAL_RESTORED_INCARNATION_REVOKED');}
