"""Linux temporary files only. Native guardian closure real; SQL flag modeled."""
import unittest, tempfile, pathlib, os, json, hashlib, subprocess

class CompleteNamespaceTests(unittest.TestCase):
 def setup_namespace(self,base):
  key=base/'qualification-controller-public-key.pem';key.write_bytes(b'unit-existing-key');key.chmod(0o444)
  hold=base/'negative-held-original';hold.mkdir(mode=0o700);(hold/'receipt').write_bytes(b'negative remains negative');(hold/'receipt').chmod(0o400)
  stage={'__name__':'fixed_stage_component'};exec(compile(NAMESPACE_RECEIVER_SOURCE,'receiver','exec'),stage)
  original_path=stage['Path'];stage['Path']=lambda p:base if p=='/app/runtime-authority'else original_path(p)
  operation='a'*32;initial=stage['initial'](operation,stage['namespace'](base.lstat()))
  terminal={'__name__':'fixed_terminal_component'};exec(compile(NAMESPACE_TERMINAL_SOURCE,'terminal','exec'),terminal);terminal['BASE']=base
  root=base/('application-native-'+operation);coord=root/'restored-complete-app/recovery-coordination';coord.mkdir(parents=True,mode=0o700)
  child=subprocess.Popen(['/bin/true'],stdout=subprocess.PIPE,stderr=subprocess.PIPE);out,err=child.communicate();assert child.returncode==0 and out==err==b''
  active={'format':'sabalan-runtime-native/v1','phase':'ACTIVE','role':'control','instanceId':'b'*48,'namespace':'sabalan-rt-'+'b'*48,'clusterIdentifier':'unit-modeled-sql','commandSha256':'c'*64,'guardian':{'pid':child.pid,'startTicks':'1','bootId':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'pidNamespace':os.readlink('/proc/self/ns/pid')}}
  raw=(json.dumps(active)+'\n').encode();pin=hashlib.sha256(raw).hexdigest();(coord/'strict-original-active-native.json').write_bytes(raw);(coord/'strict-original-active-native.json').chmod(0o400)
  final={**active,'phase':'QUIESCENT','nativeReaped':True,'databaseQuiet':True,'nativeStatus':0,'stoppedBySignal':False,'activeClaimSha256':pin};raw=(json.dumps(final)+'\n').encode();(coord/'deployment-runtime-native.json').write_bytes(raw);(coord/'deployment-runtime-native.json').chmod(0o400)
  final_pin=hashlib.sha256(raw).hexdigest()
  publisher={'__name__':'fixed_inquiry_publication'};exec(compile(INQUIRY_PUBLICATION_SOURCE,'publication','exec'),publisher)
  runtime='d'*64;coordination='/app/recovery-coordination/complete-inquiry-'+operation+'/coordination';scope={'format':'sabalan-online-runtime-scope/v2','runtimeId':runtime,'releaseId':'qa-complete-inquiry-'+operation,'purpose':'http','role':'serving','worker':None,'image':'sha256:'+'e'*64,'coordinationDirectory':coordination,'nativeDirectory':coordination+'/online/native/'+runtime,'boundaryDirectory':coordination+'/online/work/'+runtime};raw=(json.dumps(scope,sort_keys=True,separators=(',',':'))+'\n').encode();digest=hashlib.sha256(raw).hexdigest()
  import base64
  publisher['publish'](base,{'operation':operation,'grant':{'operation':operation,'name':runtime+'.json','rawBase64':base64.b64encode(raw).decode(),'sha256':digest},'trustSha256':hashlib.sha256(key.read_bytes()).hexdigest(),'image':scope['image']});published=base/(runtime+'.json');st=published.lstat();terminal['_TEST_SCOPE']=scope;terminal['_TEST_GRANT']={'name':published.name,'sha256':digest,'bytes':len(raw),'device':str(st.st_dev),'inode':str(st.st_ino)}
  return operation,initial,terminal,{'outerActive':pin,'outerFinal':final_pin},root
 def test_retirement_preserves_all_existing_keys_and_negative_holds(self):
  with tempfile.TemporaryDirectory(prefix='complete-namespace-')as directory:
   base=pathlib.Path(directory);base.chmod(0o700);op,initial,t,pins,root=self.setup_namespace(base)
   value=t['retire'](op,initial,pins,t['_TEST_GRANT']);self.assertTrue(value['jobAbsent']);self.assertFalse(value['authorityEmpty']);self.assertTrue(value['existingAuthorityPreserved']);self.assertEqual((base/'qualification-controller-public-key.pem').read_bytes(),b'unit-existing-key');self.assertEqual((base/'negative-held-original/receipt').read_bytes(),b'negative remains negative')
 def test_existing_file_drift_refuses_before_first_removal(self):
  with tempfile.TemporaryDirectory(prefix='complete-namespace-')as directory:
   base=pathlib.Path(directory);base.chmod(0o700);op,initial,t,pins,root=self.setup_namespace(base);file=base/'negative-held-original/receipt';file.chmod(0o600);file.write_bytes(b'drift');file.chmod(0o400)
   with self.assertRaises(AssertionError):t['retire'](op,initial,pins,t['_TEST_GRANT'])
   self.assertTrue((root/'restored-complete-app/recovery-coordination/deployment-runtime-native.json').exists())
 def test_new_foreign_entry_refuses_before_first_removal(self):
  with tempfile.TemporaryDirectory(prefix='complete-namespace-')as directory:
   base=pathlib.Path(directory);base.chmod(0o700);op,initial,t,pins,root=self.setup_namespace(base);(base/'foreign-new').mkdir(mode=0o700)
   with self.assertRaises(AssertionError):t['retire'](op,initial,pins,t['_TEST_GRANT'])
   self.assertTrue((root/'restored-complete-app/recovery-coordination/deployment-runtime-native.json').exists())

 def test_large_conservation_snapshot_does_not_enter_argv(self):
  with tempfile.TemporaryDirectory(prefix='complete-namespace-')as directory:
   base=pathlib.Path(directory);base.chmod(0o700)
   for i in range(200):
    file=base/('retained-'+str(i));file.write_bytes(b'keep');file.chmod(0o400)
   op,initial,t,pins,root=self.setup_namespace(base)
   self.assertLess(len(json.dumps(initial)),3000);self.assertGreater((root/'existing-authority-snapshot.json').stat().st_size,24000)
   value=t['retire'](op,initial,pins,t['_TEST_GRANT']);self.assertTrue(value['existingAuthorityPreserved']);self.assertEqual(len(list(base.glob('retained-*'))),200)

 def test_closed_capture_authorizes_only_its_actual_published_grant(self):
  import base64,copy
  with tempfile.TemporaryDirectory(prefix='complete-namespace-')as directory:
   base=pathlib.Path(directory);base.chmod(0o700);op,initial,t,pins,root=self.setup_namespace(base);grant=t['_TEST_GRANT'];scope=t['_TEST_SCOPE'];loaded={'scope':scope,'sha256':grant['sha256'],'device':grant['device'],'inode':grant['inode']}
   def encoded(value):
    raw=json.dumps(value).encode();return {'rawBase64':base64.b64encode(raw).decode(),'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}
   expected={'scope':loaded,'inputSqlite':{'sha256':'f'*64},'originalDatabase':{'sha256':'e'*64}}
   retired={'format':'sabalan-restored-inquiry-retired/v1','retired':True,'inputSqlite':expected['inputSqlite'],'originalDatabase':expected['originalDatabase'],'closure':{'wrapperStatus':128,'nativeStatus':143,'naturalExitZero':False}}
   capture={'format':'sabalan-original-complete-capture/v1','request':{'operation':op},'workerClosedBeforeCapture':True,'cleanupStarted':False,'inquiryExpected':expected,'probe':{'originals':[{'role':'inquiry','evidence':{'finalNative':encoded({'phase':'QUIESCENT','onlineScope':loaded}),'retirement':encoded(retired)}}]}}
   cleanup={'__name__':'fixed_cleanup_component','__file__':str(base/'terminal_cleanup.py')};exec(compile(NAMESPACE_CLEANUP_SOURCE,'cleanup','exec'),cleanup)
   self.assertEqual(cleanup['closed_inquiry_grant'](capture,op),grant)
   bad=copy.deepcopy(capture);bad['probe']['originals'][0]['evidence']['retirement']=encoded({**retired,'retired':False})
   with self.assertRaises(AssertionError):cleanup['closed_inquiry_grant'](bad,op)
   bad=copy.deepcopy(capture);bad['inquiryExpected']['scope']['sha256']='0'*64
   with self.assertRaises(AssertionError):cleanup['closed_inquiry_grant'](bad,op)
   for i in range(200):
    file=base/('held-input-'+str(i));file.write_bytes(b'keep');file.chmod(0o400)
   terminal_source=base/'terminal_local.py';terminal_source.write_text(NAMESPACE_TERMINAL_SOURCE);terminal_source.chmod(0o400)
   described=copy.deepcopy(initial);described['root']='/app/runtime-authority/application-native-'+op;described['stage']=described['root']+'/strict-complete-material'
   binding={'applicationKeyBinding':{'operation':op},'authorityNamespace':initial['authorityNamespaceBefore'],'helperPins':{'terminal_local.py':hashlib.sha256(NAMESPACE_TERMINAL_SOURCE.encode()).hexdigest()},'candidateContainerId':'a'*64,'dockerExecutable':'/usr/bin/docker','linuxPython':'/usr/bin/python3.11'}
   command=cleanup['local_command'](binding,pins,described,capture);self.assertLess(len(command[-1].encode()),24000)
