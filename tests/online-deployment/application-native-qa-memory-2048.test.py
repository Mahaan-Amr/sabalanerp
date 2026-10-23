"""Pure resource-profile boundaries; no Docker or native qualification."""
import copy,hashlib,importlib.util,json,pathlib,unittest
spec=importlib.util.spec_from_file_location('expanded_candidate_resource',pathlib.Path(__file__).with_name('application-native-candidate-controller.fixture.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
MIB=1024*1024
def fixture():
 limits=lambda:{'MemorySwap':1536*MIB,'MemoryReservation':0,'NanoCpus':1000000000,'CpuQuota':0,'CpuPeriod':0,'PidsLimit':None,'OomKillDisable':None}
 old={s:dict(id=str(i+1)*64,image='sha256:'+str(i+3)*64,startedAt='2026-10-23T00:00:00.000Z')for i,s in enumerate(['backend-candidate','backend-retained'])};before={s:limits()for s in old};after=copy.deepcopy(before);after['backend-candidate']['MemorySwap']=2048*MIB
 v=dict(pass_=True);v={'pass':True,'originalLimitsUnchanged':False,'phase':'COMPLETE','productionAdmission':False,'up':dict(code=0,signal=None),'originalChildren':dict(allOriginalChildrenClosed=True,interrupted=False),'previous':old,'inputs':{'D:/fixture/prior.json':'a'*64},'actual':{s:dict(id=str(i+7)*64,memoryBytes=(2048 if i==0 else 768)*MIB,memorySwapBytes=(2048 if i==0 else 1536)*MIB)for i,s in enumerate(old)},'reobservedBaseline':dict(identities=old,previousIdentities=old),'candidateQaMemoryTransition':dict(format='sabalan-explicit-local-qa-candidate-memory-transition/v3',before={'backend-candidate':1536*MIB,'backend-retained':768*MIB},after={'backend-candidate':2048*MIB,'backend-retained':768*MIB},runtimeLimitsBefore=before,runtimeLimitsAfter=after,nativeActorFloorBytes=384*MIB,cacheCreditUsed=False,predecessor=dict(file='D:/fixture/prior.json',sha256='a'*64),beforeUp=dict(platform='win32',availableBytes=2048*MIB),afterUp=dict(platform='win32',availableBytes=2048*MIB))}
 return v
def invoke(v,mutate=None):
 raw=json.dumps(v).encode();digest=hashlib.sha256(raw).hexdigest();cfg=dict(roleQualification=dict(sha256=digest),qaMemoryProfile=dict(format='sabalan-explicit-local-qa-memory-profile/v1',candidateBytes=2048*MIB,candidateSwapBytes=2048*MIB,replacementReceiptSha256=digest,receiptFile='qa-memory-replacement-receipt.json'))
 if mutate:mutate(cfg)
 m.configure_qa_memory_profile(cfg,raw)
class ProfileTests(unittest.TestCase):
 def tearDown(self):m.configure_qa_memory_profile({},b'')
 def test_default_remains1536_and_explicitactual_v3_selects2048(self):
  m.configure_qa_memory_profile({},b'');self.assertEqual(m.EXPECTED_CANDIDATE_MEMORY_BYTES,1536*MIB);invoke(fixture());self.assertEqual(m.EXPECTED_CANDIDATE_MEMORY_BYTES,2048*MIB)
 def test_receipt_hash_source_and_unsupported_profile_refuse(self):
  for change in [lambda c:c['qaMemoryProfile'].__setitem__('replacementReceiptSha256','0'*64),lambda c:c['qaMemoryProfile'].__setitem__('candidateBytes',1792*MIB),lambda c:c['qaMemoryProfile'].__setitem__('receiptFile','elsewhere.json'),lambda c:c['qaMemoryProfile'].__setitem__('pass',True)]:
   with self.assertRaises(RuntimeError):invoke(fixture(),change)
 def test_cpu_retained_floor_oldcap_cache_and_host_drift_refuse(self):
  for change in [lambda v:v['candidateQaMemoryTransition']['runtimeLimitsAfter']['backend-candidate'].__setitem__('NanoCpus',1),lambda v:v['candidateQaMemoryTransition']['runtimeLimitsAfter']['backend-retained'].__setitem__('MemorySwap',2048*MIB),lambda v:v['candidateQaMemoryTransition'].__setitem__('nativeActorFloorBytes',383*MIB),lambda v:v['candidateQaMemoryTransition'].__setitem__('cacheCreditUsed',True),lambda v:v['candidateQaMemoryTransition']['before'].__setitem__('backend-candidate',1280*MIB),lambda v:v['candidateQaMemoryTransition']['afterUp'].__setitem__('availableBytes',2048*MIB-1),lambda v:v['candidateQaMemoryTransition']['runtimeLimitsAfter']['backend-candidate'].__setitem__('MemorySwap',1536*MIB),lambda v:v['actual']['backend-candidate'].__setitem__('id',v['previous']['backend-candidate']['id'])]:
   v=fixture();change(v)
   with self.assertRaises(RuntimeError):invoke(v)
 def test_preserved_successor_keeps2048_and_refuses_missing_anchor(self):
  v=fixture();v['originalLimitsUnchanged']=True;t=v.pop('candidateQaMemoryTransition');t['format']='sabalan-preserved-local-qa-candidate-memory-profile/v1';t['before']['backend-candidate']=2048*MIB;t['runtimeLimitsBefore']['backend-candidate']['MemorySwap']=2048*MIB;t['transition']=dict(file='D:/fixture/transition.json',sha256='b'*64);v['inputs'][t['transition']['file']]=t['transition']['sha256'];v['candidateQaMemoryProfile']=t;invoke(v);self.assertEqual(m.EXPECTED_CANDIDATE_MEMORY_BYTES,2048*MIB);del v['inputs'][t['transition']['file']]
  with self.assertRaises((RuntimeError,KeyError)):invoke(v)
 def test_native_floor_is_still384_and_capacity_precedes_catalog_sql(self):
  self.assertEqual(m.CAPACITY['full-catalog'],384*MIB);source=pathlib.Path(m.__file__).read_text();start=source.index('    def full_catalog(');self.assertLess(source.index("self.capacity('full-catalog')",start),source.index("check(self.sql('SELECT system_identifier",start))
if __name__=='__main__':unittest.main(verbosity=2)
