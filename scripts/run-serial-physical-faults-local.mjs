import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {LocalBoundedSerialDriver} from './lib/serial-physical/local-bounded-driver.mjs';
import {runBoundedSerialFaultProof} from './lib/serial-physical/bounded-runner.mjs';
assert.equal(process.argv[2],'--execute-ticket-416');
const directory=path.resolve(process.argv[3]);
assert.equal(path.dirname(directory).toLowerCase(),'d:\\sabalanerp-online-qa');
const root=path.resolve(fileURLToPath(new URL('../',import.meta.url)));
const retainedEvidenceRoots=process.argv.slice(4).map(value=>{assert.match(value,/^--retain-evidence=serial-physical-[a-f0-9]{32}$/);return value.slice('--retain-evidence='.length);});
const driver=new LocalBoundedSerialDriver({directory,implementationRoot:root,retainedEvidenceRoots});
try{const result=await runBoundedSerialFaultProof(driver);console.log(JSON.stringify({directory,...result}));}
catch(error){
 if(driver.lease&&!driver.leaseReleased)driver.retainHeldOwner();
 const failure=/^[A-Z][A-Z_0-9]*(?::[a-z-]+)?$/.test(error?.message)?error.message:'SOURCE_OR_NATIVE_FAILURE';
 console.log(JSON.stringify({directory,state:'NEGATIVE_OR_HELD',failure,lastPhase:driver.lastPhase,leaseMayRemainHeld:true}));process.exitCode=1;
}
