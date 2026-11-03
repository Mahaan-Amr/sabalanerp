"""Prepare one independently owned RSA stream check, never invokes credentials."""
import pathlib,json,hashlib,runpy,re,argparse
HERE=pathlib.Path(__file__).resolve().parent;Q=HERE.parent
PRODUCTION=Q/'C30-source-a-no-workspace-stream-owner-source-r7-deployment-profile-20261025'
PRODUCTION_SHA='2f85bb5addcbc798b485327bf428da0f073ba55cd5c832720b174391f08d5031'
R6=Q/'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025'
def sha(raw):return hashlib.sha256(raw).hexdigest()
def ref(p):return {'file':str(p),'sha256':sha(p.read_bytes())}
def read(row):
 p=pathlib.Path(row['file']);raw=p.read_bytes();assert 0<len(raw)<=2*1024**2 and sha(raw)==row['sha256'];return json.loads(raw)
def prepare(encryption,local,operation,service):
 component=runpy.run_path(str(HERE/'components.py'))['select'](service)
 assert re.fullmatch('[a-f0-9]{32}',operation)
 packet=json.loads((HERE/'source-review.json').read_bytes())
 for row in packet['files'].values():assert sha(pathlib.Path(row['file']).read_bytes())==row['sha256']
 a=read(encryption);b=read(local)
 for value,phase in [(a,'encrypt-existing'),(b,'local-decrypt')]:
  assert value['format']==('sabalan-source-a-original-closed-stream-phase/v1'if phase=='encrypt-existing'else'sabalan-source-a-original-closed-local-hash-phase/v1')and value['phase']==phase and value['allOriginalChildrenClosed']is True and value['productionAdmission']is False
  for name in ['stageOriginal','binaryOriginal']:
   row=value[name];assert row['code']==0 and row['signal']is None and row['stdoutEof']and row['stderrEof']and not row['observationFaults']and not row['localInterrupted']and row['installedSshHeldAcrossSameOriginal']is True
  assert value['remote']['image']==component['image']and value['component']==component and value['service']==service and value['remote']['allOriginalChildrenClosed']is True
 assert b['remote']['format']=='sabalan-source-a-closed-local-hash-phase/v1'and b['binaryOriginal']['stderrBytes']==0 and b['hashProofPacket']=={**b['binaryOriginal']['stdout'],'bytes':b['binaryOriginal']['stdoutBytes']};cipher=a['streamOutput'];plain=b['reusedPlaintextRef'];assert plain==component['gzip']and b['encryptionPhase']==encryption and b['remote']['plaintextReturned']is False and b['remote']['plaintextTransportBytes']==0;assert read(b['hashProofPacket'])==b['remote'];decoded=b['canonicalLocalArchiveValidation'];assert decoded['format']=='sabalan-source-a-private-local-gzip-oci/v1'and decoded['archiveGraph']['index']==a['remote']['image']and decoded['archiveGraph']['rootfsDiffIds']==a['remote']['rootfsDiffIds']
 native=b['remote']['native']['result'];assert native['gcmAuthenticated']is True and native['cipherBytes']==cipher['bytes']and native['cipherSha256']==cipher['sha256']and native['plainBytes']==plain['bytes']and native['plainSha256']==plain['sha256']and decoded['compressed']==plain
 expected={'image':a['remote']['image'],'cipherBytes':cipher['bytes'],'cipherSha256':cipher['sha256'],'plainBytes':plain['bytes'],'plainSha256':plain['sha256']};built=runpy.run_path(str(HERE/'build-independent.py'))['build'](operation,expected,service)
 source=Q/('C30-source-a-existing-independent-material-'+service+'-'+operation);output=Q/('C30-source-a-existing-independent-runtime-'+service+'-'+operation);assert not source.exists()and not output.exists()
 raw=(PRODUCTION/'source-review.json').read_bytes();assert sha(raw)==PRODUCTION_SHA;production=json.loads(raw)
 for row in production['files'].values():assert sha(pathlib.Path(row['file']).read_bytes())==row['sha256']
 r6review=(R6/'source-review.json').read_bytes();assert sha(r6review)=='e20fd6ac89c0b78bd4602399ef38a3905f3116a153bcbaac07d0f697d7ff03ca';rows=[r for r in json.loads(r6review)['files']if pathlib.Path(r['file']).name=='backup_credential.py'];assert len(rows)==1 and sha((R6/'backup_credential.py').read_bytes())==rows[0]['sha256']
 parent=R6/'prepare.py';assert sha(parent.read_bytes())=='0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb';private=runpy.run_path(str(parent));acl=private['private_output'](source);files={}
 original=runpy.run_path(str(PRODUCTION/'build-original.py'))['build']().decode();old="('nativeSshSignature','stageSource','binaryPhase','validateArchive')";assert original.count(old)==1;original=original.replace(old,"('credentialIdentity','credentialAcl','backupStage','backupVerify')")
 old="('backupPrepare','backupReseal','cipherDownload','backupCleanup')";assert original.count(old)==1;original=original.replace(old,"('backupStage','backupVerify')");compile(original,'independent-original-core','exec')
 for name,data in [('components.py',(HERE/'components.py').read_bytes()),('original.py',original.encode()),('stage.py',built['stageSource']),('runtime.py',built['runtimeSource']),('backup_credential.py',(R6/'backup_credential.py').read_bytes()),('public-window-helpers.py',(PRODUCTION/'windows-owner.template.py').read_bytes())]:files[name]=private['write'](source/name,data)
 binding={'format':'sabalan-source-a-independent-image-stream-input/v1','operation':operation,'service':service,'component':component,'files':files,'producerReview':ref(HERE/'source-review.json'),'productionReview':ref(PRODUCTION/'source-review.json'),'output':str(output),'root':built['root'],'runtimeSha256':built['runtimeSha256'],'verifyCommand':built['verifyCommand'],'expected':expected,'cipherInput':cipher,'encryptionPhase':encryption,'localPhase':local,'privateOutputProducer':ref(parent),'custody':{'file':str(Q/'C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024/custody.py'),'sha256':'a6ab3ec32561ef0865100485ff5a1ab566a5225c95a5831382a305cd8080f2d1'},'productionAdmission':False}
 template=(HERE/'owner-independent.template.py').read_text();assert template.count('BOUND=None')==1;owner=template.replace('BOUND=None','BOUND='+repr(binding));compile(owner,'independent-image-owner','exec');files['owner.py']=private['write'](source/'owner.py',owner.encode())
 return private['write'](source/'material.json',(json.dumps({'format':'sabalan-source-a-independent-image-stream-material/v1','operation':operation,'files':files,'sourcePrivateAcl':acl,'sourceReview':ref(HERE/'source-review.json'),'runtimeExecuted':False,'productionAdmission':False},indent=2)+'\n').encode())
def main():
 p=argparse.ArgumentParser()
 for name in ['encryption-phase','encryption-phase-sha256','local-phase','local-phase-sha256','operation']:p.add_argument('--'+name,required=True)
 p.add_argument('--service',choices=['frontend','inquiry'],required=True)
 a=p.parse_args();print(json.dumps(prepare({'file':str(pathlib.Path(a.encryption_phase).resolve()),'sha256':a.encryption_phase_sha256},{'file':str(pathlib.Path(a.local_phase).resolve()),'sha256':a.local_phase_sha256},a.operation,a.service)))
if __name__=='__main__':main()
