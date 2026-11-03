"""Materialize ONE fresh production stream phase; never launches its owner."""
import argparse,pathlib,runpy,json,hashlib,re
HERE=pathlib.Path(__file__).resolve().parent;Q=HERE.parent
AD=Q/'C30-observed-second-backend-restart-current-admission-source-r2-20261025/admission.py';AD_SHA='8c7dc32fd6ad614f2931865141ee46f63c83c19506176730de7383ccdc38003b'
PRIVATE=Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py';PRIVATE_SHA='0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb'
CUSTODY=Q/'C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024/custody.py';CUSTODY_SHA='a6ab3ec32561ef0865100485ff5a1ab566a5225c95a5831382a305cd8080f2d1'
PROFILE=Q/'fixed-production-openssh-profile-20261020.json';PROFILE_SHA='71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def ref(p):return {'file':str(p),'sha256':sha(p.read_bytes())}
def checked(p,digest):assert sha(p.read_bytes())==digest;return p
def prepare(baseline,preflight,phase,operation,encryption_phase=None,service=None):
 assert phase in ['encrypt-existing','local-decrypt']and re.fullmatch('[a-f0-9]{32}',operation)
 packet=json.loads((HERE/'source-review.json').read_bytes())
 for row in packet['files'].values():checked(pathlib.Path(row['file']),row['sha256'])
 ad=runpy.run_path(str(checked(AD,AD_SHA)),run_name='exact_current_admission');spec=ad['current_spec'](baseline);ad['validate_spec'](spec)
 component=runpy.run_path(str(HERE/'components.py'))['select'](service);assert next(r for r in spec['expectedEight']if r['service']==service)['image']==component['image']
 cipher=None
 if phase=='local-decrypt':
  assert encryption_phase and set(encryption_phase)=={'file','sha256'};previous=json.loads(checked(pathlib.Path(encryption_phase['file']),encryption_phase['sha256']).read_bytes())
  if previous.get('format')=='sabalan-source-a-closed-native-existing-gzip-encryption-component/v1':
   cipher=runpy.run_path(str(HERE/'frontend-cipher-component.py'))['authenticate'](encryption_phase,service,component)
  else:
   assert previous['format']=='sabalan-source-a-original-closed-stream-phase/v1'and previous['phase']=='encrypt-existing'and previous['allOriginalChildrenClosed']is True and previous['productionAdmission']is False
   for key in ['stageOriginal','binaryOriginal']:
    row=previous[key];assert row['code']==0 and row['signal']is None and row['stdoutEof']and row['stderrEof']and not row['observationFaults']and not row['localInterrupted']
   native=previous['remote'];assert native['format']=='sabalan-source-a-closed-stream-phase/v1'and native['allOriginalChildrenClosed']is True and native['image']==component['image']and previous['component']==component and previous['service']==service
   cipher=previous['streamOutput'];assert cipher['bytes']==native['native']['result']['cipherBytes']and cipher['sha256']==native['native']['result']['cipherSha256']
 else:assert encryption_phase is None
 source=Q/('C30-source-a-existing-material-'+service+'-'+phase+'-'+operation);output=Q/('C30-source-a-existing-'+service+'-'+phase+'-'+operation);assert not source.exists()and not output.exists()
 builder=runpy.run_path(str(HERE/'build-phase.py'),run_name='fixed_stream_phase_producer');material=builder['render'](spec,operation,source,preflight,phase,None if cipher is None else{'bytes':cipher['bytes'],'sha256':cipher['sha256']},service=service)
 private=runpy.run_path(str(checked(PRIVATE,PRIVATE_SHA)),run_name='exact_private_materializer');acl=private['private_output'](source)
 files={}
 validator_source=(HERE/'validate-gzip.cjs').read_text();assert validator_source.count('const COMPONENT=null;')==1;validator_source=validator_source.replace('const COMPONENT=null;','const COMPONENT='+json.dumps(component,sort_keys=True)+';')
 for name,raw in [('components.py',(HERE/'components.py').read_bytes()),('frontend-cipher-component.py',(HERE/'frontend-cipher-component.py').read_bytes()),('stage.py',material['stageSource']),('runtime.py',material['runtimeSource']),('runtime-spec.json',json.dumps(spec,sort_keys=True,separators=(',',':')).encode()),('original.py',runpy.run_path(str(HERE/'build-original.py'))['build']()),('validate-gzip.cjs',validator_source.encode())]:files[name]=private['write'](source/name,raw)
 validator=builder['PARENT']/'source-a-preflight.py'
 binding={'format':'sabalan-source-a-finite-original-stream-input/v1','phase':phase,'service':service,'component':component,'operation':operation,'sourceFiles':files,'runtimeSpec':files['runtime-spec.json'],'runtimeSourceSha256':sha(material['runtimeSource']),'remoteCommand':material['remoteCommand'],'output':str(output),'admission':ref(checked(AD,AD_SHA)),'preflightValidator':ref(validator),'preflight':preflight,'profile':ref(checked(PROFILE,PROFILE_SHA)),'custody':ref(checked(CUSTODY,CUSTODY_SHA)),'sshOwner':ref(checked(Q/'C30-production-control-image-import-source-r4-exact-six-service-census-20261024/owner.py','62236fe988dff14e21fa62016fea000e9830599771acfaf7d9e01f26b5c6db04')),'privateOutputProducer':ref(checked(PRIVATE,PRIVATE_SHA)),'windowsNode':private['NODE'],'encryptionPhase':encryption_phase,'cipherInput':cipher,'producerReview':ref(HERE/'source-review.json'),'productionAdmission':False}
 template=(HERE/'windows-owner.template.py').read_text();assert template.count('BOUND=None')==1;owner=template.replace('BOUND=None','BOUND='+repr(binding));compile(owner,'fixed-production-stream-original','exec');files['owner.py']=private['write'](source/'owner.py',owner.encode())
 return private['write'](source/'material.json',(json.dumps({'format':'sabalan-source-a-stream-phase-material/v1','phase':phase,'operation':operation,'files':files,'sourcePrivateAcl':acl,'baseline':baseline,'preflight':preflight,'sourceReview':ref(HERE/'source-review.json'),'runtimeExecuted':False,'productionAdmission':False},indent=2)+'\n').encode())
def main():
 p=argparse.ArgumentParser()
 for name in ['baseline','baseline-sha256','preflight','preflight-sha256','phase','operation']:p.add_argument('--'+name,required=True)
 p.add_argument('--service',choices=['frontend','inquiry'],required=True);p.add_argument('--encryption-phase');p.add_argument('--encryption-phase-sha256');a=p.parse_args();previous=None
 if a.encryption_phase:assert a.encryption_phase_sha256;previous={'file':str(pathlib.Path(a.encryption_phase).resolve()),'sha256':a.encryption_phase_sha256}
 print(json.dumps(prepare({'file':str(pathlib.Path(a.baseline).resolve()),'sha256':a.baseline_sha256},{'file':str(pathlib.Path(a.preflight).resolve()),'sha256':a.preflight_sha256},a.phase,a.operation,previous,service=a.service)))
if __name__=='__main__':main()
