import assert from 'node:assert/strict';
import {openInheritedReadonlyTransportRetirementChannel} from '../../deploy/scripts/readonly-transport-retirement.mjs';
assert.equal(process.platform,'linux');
const mode=process.argv[2];assert.ok(['regular-file','write-only-pipe','substituted-source'].includes(mode));
await assert.rejects(openInheritedReadonlyTransportRetirementChannel());
console.log(JSON.stringify({format:'sabalan-original-channel-negative/v1',mode,rejected:true,productionAdmission:false}));
