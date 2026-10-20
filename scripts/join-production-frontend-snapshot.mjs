/** Source-only join of original captures and a fully verified local OCI archive. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readProductionInquirySnapshot} from './lib/production-inquiry-snapshot.mjs';
import {stableFrontendBaseFile} from './lib/production-frontend-base-artifacts.mjs';
import {inspectPrivateDockerArchive} from './lib/private-docker-image-archive.mjs';
import {validateMeasuredFrontendSnapshot} from '../deploy/scripts/production-frontend-snapshot.mjs';
const args=process.argv.slice(2);assert.equal(args.length,10);for(const [i,key]of ['--snapshot-receipt','--snapshot-sha256','--code-receipt','--export-receipt','--output'].entries())assert.equal(args[i*2],key);
const snapshot=readProductionInquirySnapshot(args[1],args[3]),row=file=>{const resolved=fs.realpathSync(file),before=stableFrontendBaseFile(resolved,16*1024**2),raw=fs.readFileSync(resolved);assert.deepEqual(stableFrontendBaseFile(resolved,16*1024**2),before);return{file:resolved,sha256:before.sha256,rawBase64:raw.toString('base64')};};
const baseline=row(snapshot.file),observation=row(args[5]),exported=row(args[7]);assert.equal(baseline.sha256,snapshot.sha256);const exportValue=JSON.parse(Buffer.from(exported.rawBase64,'base64'));
const archive=fs.realpathSync(path.join(exportValue.directory,'frontend.docker.tar')),proof=inspectPrivateDockerArchive(archive,snapshot.services.frontend.image);
const packet={format:'sabalan-measured-production-frontend-snapshot/v1',baseline,observation,export:exported,archive:{file:archive,proof},productionAdmission:false};const result=validateMeasuredFrontendSnapshot(packet),raw=Buffer.from(JSON.stringify(packet,null,2)+'\n'),output=path.resolve(args[9]);assert.equal(fs.realpathSync(path.dirname(output)),path.dirname(output));fs.writeFileSync(output,raw,{flag:'wx',mode:0o600});
console.log(JSON.stringify({file:output,sha256:createHash('sha256').update(raw).digest('hex'),image:result.source.sourceIndex,configIdentity:result.source.configIdentity,nativeBuildId:result.browser.nativeBuildId,files:result.manifest.files.length,productionAdmission:false}));
