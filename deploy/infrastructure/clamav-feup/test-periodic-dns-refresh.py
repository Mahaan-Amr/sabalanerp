import importlib.util,pathlib,unittest,hashlib
P=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location('helper',P/'sabalan-clamav-feup-tunnel-20261022.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Deadline:
 def __init__(self):self.expires=100;self.now=10;self.checks=0
 def check(self):
  self.checks+=1
  if self.now>=self.expires:raise RuntimeError('DNS_EXPIRED')
class Tests(unittest.TestCase):
 def setUp(self):self.d=Deadline();self.old={'ipv4':['1.2.3.4'],'ipv6':[],'expiresMonotonic':100};self.new={'ipv4':['4.3.2.1'],'ipv6':['2001:db8::1'],'expiresMonotonic':150}
 def test_transient_then_valid_only_returns_fully_validated_new_dns(self):
  calls=[];attempt=[0]
  def q(mode,addresses=None):
   calls.append((mode,addresses));attempt[0]+=mode=='dns'
   if mode=='dns' and attempt[0]==1:raise m.CommandFailure('nsenter',1,b'resolver failed')
   return self.new if mode=='dns' else {'isolated':True}
  self.assertIsNone(m.periodic_dns_refresh(q,self.d,self.old));self.assertEqual(self.d.expires,100)
  self.assertIs(m.periodic_dns_refresh(q,self.d,self.old),self.new);self.assertEqual(calls,[('dns',None),('ipv6',[]),('dns',None),('ipv6',['2001:db8::1'])]);self.assertEqual(self.d.expires,100)
 def test_old_absolute_expiry_stops_retries(self):
  calls=[]
  def q(mode,addresses=None):calls.append(mode);self.d.now=100;raise m.CommandFailure('nsenter',1,b'dns')
  with self.assertRaisesRegex(RuntimeError,'DNS_EXPIRED'):m.periodic_dns_refresh(q,self.d,self.old)
  self.assertEqual(calls,['dns']);self.assertEqual(self.d.expires,100)
 def test_ipv6_failure_after_dns_success_is_immediate(self):
  def q(mode,addresses=None):
   if mode=='dns':return self.new
   raise m.CommandFailure('nsenter',1,b'ipv6')
  with self.assertRaises(m.CommandFailure):m.periodic_dns_refresh(q,self.d,self.old)
 def test_ipv6_failure_on_retry_is_immediate(self):
  def q(mode,addresses=None):raise m.CommandFailure('nsenter',1,mode.encode())
  with self.assertRaises(m.CommandFailure):m.periodic_dns_refresh(q,self.d,self.old)
 def test_identity_failure_not_retried_or_swallowed(self):
  def q(mode,addresses=None):raise RuntimeError('TARGET_INCARNATION_CHANGED')
  with self.assertRaisesRegex(RuntimeError,'TARGET_INCARNATION_CHANGED'):m.periodic_dns_refresh(q,self.d,self.old)
 def test_diagnostics_never_include_raw_stderr(self):
  error=m.CommandFailure('nsenter',1,b'private credential ABC');self.assertNotIn('private',str(error));self.assertEqual(error.stderrSha256,hashlib.sha256(b'private credential ABC').hexdigest());self.assertEqual(error.stderrBytes,22)
 def test_monitor_retry_preserves_existing_guard_order_and_no_startup_retry(self):
  import inspect
  source=inspect.getsource(m.monitor);loop=source.split('while not STOP.wait(2):',1)[1]
  for guard in ["profile(file,digest,False)==p","executable_identity(p)==executable_pins","observe(p)","os.fstat(fd).st_ino==p['netnsInode']","child_query('ipv6',dns['ipv6'])"]:self.assertLess(loop.index(guard),loop.index('periodic_dns_refresh('))
  self.assertEqual(source.count('periodic_dns_refresh('),1);self.assertLess(loop.index('if updated is None:continue'),loop.index('owner.change('));self.assertLess(loop.index('if updated is None:continue'),loop.index('deadline.replace('))
if __name__=='__main__':unittest.main()
