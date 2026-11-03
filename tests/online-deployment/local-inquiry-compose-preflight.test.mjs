import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {assertOriginalInquiryComposeModel,assertPlannedInquiryComposeModel} from '../../scripts/lib/local-inquiry-compose-preflight.mjs';
const fixture=JSON.parse(fs.readFileSync(new URL('./local-inquiry-compose-profile.fixture.json',import.meta.url)));
function input(){
 const row=structuredClone(fixture);delete row.format;delete row.testOnly;delete row.runtimeAdmission;
 row.composeFiles=[path.resolve('fixture-root/docker-compose.local.yml'),path.resolve('fixture-root/existing-override.json')];
 row.configHash=row.before.Config.Labels['com.docker.compose.config-hash'];row.composeVersion=row.before.Config.Labels['com.docker.compose.version'];
 row.before.Config.Labels['com.docker.compose.project.config_files']=row.composeFiles.join(',');row.before.Config.Labels['com.docker.compose.project.working_dir']=path.dirname(row.composeFiles[0]);
 return row;
}
function planned(row){
 const model=structuredClone(row.model),image=structuredClone(row.image),command=['/app/local-inquiry-preservation-carrier.cjs'],healthCommand=[...command,'health'];
 image.Id='sha256:'+'a'.repeat(64);image.Config.Labels['io.sabalan.carrier.role']='local-preservation-only';
 Object.assign(model.services.inquiry,{image:image.Id,command,entrypoint:['/usr/local/bin/node'],healthcheck:{test:['CMD','/usr/local/bin/node',...healthCommand],timeout:'15s',interval:'5s',start_period:'5s',retries:3}});
 model.services.inquiry.volumes.find(v=>v.target==='/data').read_only=true;
 return{originalModel:row.model,model,before:row.before,image,resources:row.resources,command,healthCommand};
}
test('complete bounded baseline and only the declared effective maintenance changes compare before UP',()=>{
 const row=input();assertOriginalInquiryComposeModel(row);const result=assertPlannedInquiryComposeModel(planned(row));
 assert.equal(result.completeOriginalProfileCompared,true);assert.equal(result.completePlannedServiceCompared,true);assert.equal(result.applicationReady,false);
});
test('base Compose drift and Docker-only resource/security/default drift refuse before UP',()=>{
 const changes=[r=>r.model.services.inquiry.cpus=2,r=>r.model.services.inquiry.mem_limit='1073741824',r=>r.model.services.inquiry.ports[0].published='9999',
  r=>r.model.services.inquiry.logging.options['max-size']='20m',r=>r.model.services.inquiry.volumes[0].source='foreign',r=>r.model.services.inquiry.privileged=true,
  r=>r.before.HostConfig.Memory++,r=>r.before.HostConfig.ReadonlyRootfs=true,r=>r.before.HostConfig.CapAdd=['SYS_ADMIN'],r=>r.before.HostConfig.UnreviewedNewField=0,
  r=>r.before.Config.OpenStdin=true,r=>r.before.Config.Labels['unreviewed']='added',r=>r.before.NetworkSettings.Networks[Object.keys(r.before.NetworkSettings.Networks)[0]].Aliases.push('foreign')];
 for(const change of changes){const row=input();change(row);assert.throws(()=>assertOriginalInquiryComposeModel(row));}
});
test('both effective plans refuse preserved-setting drift despite unchanged environment',()=>{
 const changes=[r=>r.model.services.inquiry.stop_grace_period='1s',r=>r.model.services.inquiry.mem_limit='1073741824',r=>r.model.services.inquiry.volumes[1].read_only=true,
  r=>r.model.services.inquiry.healthcheck.timeout='1s',r=>r.model.networks.default.driver='host',r=>r.resources.volumes[Object.keys(r.resources.volumes)[0]].Options={type:'nfs'},
  r=>r.model.services.inquiry.security_opt=['seccomp=unconfined'],r=>r.image.Config.User='foreign'];
 for(const change of changes){const row=planned(input());change(row);assert.throws(()=>assertPlannedInquiryComposeModel(row));}
});
test('config JSON literal-dollar serialization is decoded exactly once and runtime source remains exact',()=>{
 const row=planned(input()),source='const anchor=/^[a-f0-9]{64}$/; const literal="$DO_NOT_EXPAND";';
 row.command=['-e',source];row.healthCommand=['-e',source];
 row.model.services.inquiry.command=['-e',source.replaceAll('$',()=> '$$')];
 row.model.services.inquiry.healthcheck.test=['CMD','/usr/local/bin/node','-e',source.replaceAll('$',()=> '$$')];
 assert.equal(assertPlannedInquiryComposeModel(row).completePlannedServiceCompared,true);
 row.model.services.inquiry.command[1]=source;assert.throws(()=>assertPlannedInquiryComposeModel(row));
});
