"""Exact observed renewal-file successor; all existing cron/health/storage guards remain."""
import copy,hashlib,json,pathlib,runpy
ROOT=pathlib.Path(__file__).resolve().parents[2]
PARENT={'file':str(ROOT/'deploy/scripts/original-complete-production-admission.py'),'sha256':'bd05302adc0b5656f84c318b1248237bc5b786c5b4b7aa74ece946f01e54718f'}
OBSERVATION={'file':str(ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-21817c2ae82d65c519f1803e268dc11e.json'),'sha256':'e9d67b46892788c6107126124d245a6d430004e0ac0b8d6f4f638c440e8509b7'}
NEXT_OBSERVATION={'file':str(ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-7ca9dd49be9b52095d8d5a09fd08fbd2.json'),'sha256':'1a8bfdcccdfc16b1b9630be7b21ea6e0696c39a77c70bf3ad876529d7028c9e2'}
CURRENT_OBSERVATION={'file':str(ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-c78f3a499a5d22832e51004593ca36a9.json'),'sha256':'1174b19aadf35e59667b64bf4a421fa52d388f3854d374f6894abbe32203c623'}
NOVEMBER_OBSERVATION={'file':str(ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-7a69bc4fabbb5952f2016194a0404bba.json'),'sha256':'1edb13a8403638bda80d0eed89e7423d4cc0c0fc5a3bb7a91b8cbc041b21d4ce'}
NOVEMBER_SECOND_OBSERVATION={'file':str(ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-b0369320914192cacb227c405ddc1d75.json'),'sha256':'f2577c03c8ea5022ec909449d36ca6daddff7b4fc5e309938a19893fed9b5034'}
def checked(ref):
 p=pathlib.Path(ref['file']);a=p.lstat();assert p.resolve(strict=True)==p and p.is_file()and not p.is_symlink()and a.st_nlink==1
 raw=p.read_bytes();b=p.lstat();assert(a.st_dev,a.st_ino,a.st_mode,a.st_nlink,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_mode,b.st_nlink,b.st_size,b.st_mtime_ns,b.st_ctime_ns)and hashlib.sha256(raw).hexdigest()==ref['sha256'];return raw

def validate_renewal_projection(before,after,expected_semantics,actual_semantics):
 assert len(before)==len(after)==3;assert before[:2]==after[:2];old,new=before[2],after[2]
 assert old['path']==new['path']=='/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
 assert old['sha256']=='54814f9643c9922f03b309e2e81c06c52eed8e13012ed6bd78d0f982bb4c82a2'
 assert new['sha256']=='68aa38231cbdc271d56e112d963e7c991dbbcf98330a23b6d9f5daa932e943f9'
 assert {k for k in old if old[k]!=new[k]}=={'ctimeNs','inode','mtimeNs','sha256'}
 assert new['ctimeNs']==new['mtimeNs']==1793156411461000000 and new['inode']==526154
 assert new['uid']==0 and new['nlink']==1 and not new['mode']&0o022 and new['safeRootOwnedNonWritable']is True
 assert actual_semantics==expected_semantics and actual_semantics['authenticator']=='webroot'and actual_semantics['secretOrDomainValuesReturned']is False
 return True

def validate_next_renewal_projection(before,after,expected_semantics,actual_semantics):
 assert len(before)==len(after)==3 and before[:2]==after[:2]
 old,new=before[2],after[2]
 assert set(old)==set(new)
 assert old['path']==new['path']=='/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
 assert old['sha256']=='68aa38231cbdc271d56e112d963e7c991dbbcf98330a23b6d9f5daa932e943f9'
 assert new['sha256']=='acd80f25099d3caae4549d8b27ce779aab8bba93995dbf992f21429a5e053ab7'
 assert {k for k in old if old[k]!=new[k]}=={'ctimeNs','inode','mtimeNs','sha256'}
 assert new['inode']==526167 and new['mtimeNs']==1793242807857000000 and new['ctimeNs']==1793242807858000000
 assert new['uid']==0 and new['nlink']==1 and not new['mode']&0o022 and new['safeRootOwnedNonWritable']is True
 assert actual_semantics==expected_semantics and actual_semantics['authenticator']=='webroot'and actual_semantics['secretOrDomainValuesReturned']is False
 return True

def observed_renewal(reference):
 record=json.loads(checked(reference));assert record['diagnosticOnly']is True and record['qualificationAccepted']is False and record['leaseClosed']is True
 assert record['originalChildren']['allOriginalChildrenClosed']is True and record['originalChildren']['interrupted']is False
 assert len(record['children'])==2
 for child in record['children']:assert child['code']==0 and child['signal']is None and child['stdoutEof']is True and child['stderrEof']is True and child['killed']is False and child['outputBoundExceeded']is False
 assert hashlib.sha256(record['children'][0]['stdout'].encode()).hexdigest()==record['sourceSha256']
 # Read the captured original SSH stdout, never a reconstructed live capability.
 native=json.loads(record['children'][1]['stdout']);assert native['readOnly']is True and native['diagnosticOnly']is True and native['allOriginalChildrenClosed']is True and native['runtimeAccepted']is False
 for child in native['originalChildren']:assert child['code']==0 and child['stdoutEof']is True and child['stderrEof']is True and child['observationFault']is None
 for child in native['kernelChildren']:assert child['code']==0 and child['pipesClosed']is True and child['observationFault']is None
 return native

def validate_current_renewal_projection(before,after,expected_semantics,actual_semantics):
 assert len(before)==len(after)==3 and before[:2]==after[:2]
 old,new=before[2],after[2];assert set(old)==set(new)
 assert old['path']==new['path']=='/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
 assert old['sha256']=='acd80f25099d3caae4549d8b27ce779aab8bba93995dbf992f21429a5e053ab7'
 assert new['sha256']=='7acc0de218dea32354376d41e159fa87a2441174ba600689fe38df57bd37e73e'
 assert {key for key in old if old[key]!=new[key]}=={'ctimeNs','inode','mtimeNs','sha256'}
 assert new['inode']==526170 and new['mtimeNs']==1793415607676000000 and new['ctimeNs']==1793415607677000000
 assert new['uid']==0 and new['nlink']==1 and not new['mode']&0o022 and new['safeRootOwnedNonWritable']is True
 assert actual_semantics==expected_semantics and actual_semantics['authenticator']=='webroot'and actual_semantics['secretOrDomainValuesReturned']is False
 return True

def validate_november_renewal_projection(before,after,expected_semantics,actual_semantics):
 assert len(before)==len(after)==3 and before[:2]==after[:2]
 old,new=before[2],after[2];assert set(old)==set(new)
 assert old['path']==new['path']=='/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
 assert old['sha256']=='7acc0de218dea32354376d41e159fa87a2441174ba600689fe38df57bd37e73e'
 assert new['sha256']=='23e561a157a9044e6bf384af526090201cda9956518cadf0b030519abac5809e'
 assert {key for key in old if old[key]!=new[key]}=={'ctimeNs','inode','mtimeNs','sha256'}
 assert new['inode']==526190 and new['mtimeNs']==new['ctimeNs']==1793502007884000000
 assert new['uid']==0 and new['nlink']==1 and not new['mode']&0o022 and new['safeRootOwnedNonWritable']is True
 assert actual_semantics==expected_semantics and actual_semantics['authenticator']=='webroot'and actual_semantics['secretOrDomainValuesReturned']is False
 return True

def validate_november_second_renewal_projection(before,after,expected_semantics,actual_semantics):
 assert len(before)==len(after)==3 and before[:2]==after[:2]
 old,new=before[2],after[2];assert set(old)==set(new)
 assert old['path']==new['path']=='/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf'
 assert old['sha256']=='23e561a157a9044e6bf384af526090201cda9956518cadf0b030519abac5809e'
 assert new['sha256']=='046bb9a9710ff4dba0f6ec9648fe344d23bc632e800772b953ecb6892c1f60ce'
 assert {key for key in old if old[key]!=new[key]}=={'ctimeNs','inode','mtimeNs','sha256'}
 assert new['inode']==526203 and new['mtimeNs']==new['ctimeNs']==1793588407496000000
 assert new['uid']==0 and new['nlink']==1 and not new['mode']&0o022 and new['safeRootOwnedNonWritable']is True
 assert actual_semantics==expected_semantics and actual_semantics['authenticator']=='webroot'and actual_semantics['secretOrDomainValuesReturned']is False
 return True

def current_spec(reference,c=None):
 parent={ '__name__':'unchanged_restart21_admission','__file__':PARENT['file']};exec(compile(checked(PARENT),PARENT['file'],'exec'),parent)
 base=parent['current_spec'](reference,c);native=observed_renewal(OBSERVATION)
 for k,v in base['sourceHost'].items():assert native['host'][k]==v
 cron=native['cronPinsObservation'];assert cron['expected']==base['cronPins']and cron['stable']is True and cron['readOnly']is True and cron['admissionClaimed']is False and cron['semanticsEqual']is True
 validate_renewal_projection(cron['expected'],cron['actual'],base['cronRenewalSemantics'],cron['actualSemantics'])
 spec=copy.deepcopy(base);spec['cronPins']=copy.deepcopy(cron['actual']);spec['observedRenewalFileTransition20261028']={'observation':OBSERVATION,'onlyExactFourFieldsChanged':True,'semanticsUnchanged':True,'causeKnown':False,'liveCronRevalidationRequired':True,'productionAdmission':False}
 successor=observed_renewal(NEXT_OBSERVATION)
 for k,v in base['sourceHost'].items():assert successor['host'][k]==v
 latest=successor['cronPinsObservation'];assert latest['stable']is True and latest['readOnly']is True and latest['admissionClaimed']is False and latest['semanticsEqual']is True
 validate_next_renewal_projection(spec['cronPins'],latest['actual'],spec['cronRenewalSemantics'],latest['actualSemantics'])
 spec['cronPins']=copy.deepcopy(latest['actual']);spec['observedRenewalFileTransition20261029']={'observation':NEXT_OBSERVATION,'onlyExactFourFieldsChanged':True,'semanticsUnchanged':True,'causeKnown':False,'liveCronRevalidationRequired':True,'productionAdmission':False}
 current=observed_renewal(CURRENT_OBSERVATION)
 for key,value in base['sourceHost'].items():assert current['host'][key]==value
 now=current['cronPinsObservation'];assert now['expected']==cron['expected']and now['stable']is True and now['readOnly']is True and now['admissionClaimed']is False and now['semanticsEqual']is True
 validate_current_renewal_projection(spec['cronPins'],now['actual'],spec['cronRenewalSemantics'],now['actualSemantics'])
 spec['cronPins']=copy.deepcopy(now['actual']);spec['observedRenewalFileTransition20261031']={'observation':CURRENT_OBSERVATION,'onlyExactFourFieldsChanged':True,'semanticsUnchanged':True,'causeKnown':False,'liveCronRevalidationRequired':True,'productionAdmission':False}
 november=observed_renewal(NOVEMBER_OBSERVATION)
 for key,value in base['sourceHost'].items():assert november['host'][key]==value
 latest=november['cronPinsObservation'];assert latest['expected']==cron['expected']and latest['stable']is True and latest['readOnly']is True and latest['admissionClaimed']is False and latest['semanticsEqual']is True
 validate_november_renewal_projection(spec['cronPins'],latest['actual'],spec['cronRenewalSemantics'],latest['actualSemantics'])
 spec['cronPins']=copy.deepcopy(latest['actual']);spec['observedRenewalFileTransition20261101']={'observation':NOVEMBER_OBSERVATION,'onlyExactFourFieldsChanged':True,'semanticsUnchanged':True,'causeKnown':False,'liveCronRevalidationRequired':True,'productionAdmission':False}
 second=observed_renewal(NOVEMBER_SECOND_OBSERVATION)
 for key,value in base['sourceHost'].items():assert second['host'][key]==value
 today=second['cronPinsObservation'];assert today['expected']==cron['expected']and today['stable']is True and today['readOnly']is True and today['admissionClaimed']is False and today['semanticsEqual']is True
 validate_november_second_renewal_projection(spec['cronPins'],today['actual'],spec['cronRenewalSemantics'],today['actualSemantics'])
 spec['cronPins']=copy.deepcopy(today['actual']);spec['observedRenewalFileTransition20261102']={'observation':NOVEMBER_SECOND_OBSERVATION,'onlyExactFourFieldsChanged':True,'semanticsUnchanged':True,'causeKnown':False,'liveCronRevalidationRequired':True,'productionAdmission':False};return spec

def validate_spec(spec):
 r=spec['freshRuntimeBaselineReceipt'];assert spec==current_spec({'file':r['file'],'sha256':r['sha256']});return spec
validate_completed_source_install=validate_spec
