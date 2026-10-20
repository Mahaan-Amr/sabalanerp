import assert from 'node:assert/strict';
import test from 'node:test';
import {readOriginalPrivateLegacyUiCarrier,readOriginalPrivateLegacyUiRestoration} from '../../scripts/lib/original-private-legacy-ui-carrier.mjs';
test('a copied production image descriptor is not original creation or restoration custody',()=>{
 for(const value of [{},{image:'sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004',originalChildClosed:true},Object.freeze({})]){
  assert.throws(()=>readOriginalPrivateLegacyUiCarrier(value),/ORIGINAL_PRIVATE_LEGACY_UI_CARRIER_REQUIRED/);
  assert.throws(()=>readOriginalPrivateLegacyUiRestoration(value),/ORIGINAL_PRIVATE_LEGACY_UI_RESTORATION_REQUIRED/);
 }
});
