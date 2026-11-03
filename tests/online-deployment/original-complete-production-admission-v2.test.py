import pathlib,runpy,json,copy,unittest
ROOT=pathlib.Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'deploy/scripts/original-complete-production-admission-v2.py'),run_name='renewal_projection_test')
class RenewalTests(unittest.TestCase):
 def daily_fixture(self):
  old=json.loads((ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-21817c2ae82d65c519f1803e268dc11e.json').read_bytes())
  new=json.loads((ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-7ca9dd49be9b52095d8d5a09fd08fbd2.json').read_bytes())
  before=json.loads(old['children'][1]['stdout'])['cronPinsObservation'];after=new['observation']['cronPinsObservation']
  return before['actual'],after['actual'],before['actualSemantics'],after['actualSemantics']
 def test_next_observed_renewal_preserves_existing_exact_successor_chain(self):
  self.assertTrue(M['validate_next_renewal_projection'](*self.daily_fixture()))
 def test_next_renewal_rejects_every_unobserved_pin_or_semantic_change(self):
  edits=[lambda a:a[0].update(inode=1),lambda a:a[1].update(sha256='a'*64),lambda a:a[2].update(uid=1),lambda a:a[2].update(mode=0o666),lambda a:a[2].update(nlink=2),lambda a:a[2].update(inode=526168),lambda a:a[2].update(mtimeNs=1793242807857000001),lambda a:a[2].update(ctimeNs=1793242807858000001),lambda a:a[2].update(sha256='a'*64),lambda a:a[2].update(bytes=a[2]['bytes']+1),lambda a:a[2].update(unobserved=True)]
  for edit in edits:
   old,new,s,t=self.daily_fixture();edit(new)
   with self.subTest(new=new),self.assertRaises(AssertionError):M['validate_next_renewal_projection'](old,new,s,t)
  old,new,s,t=self.daily_fixture();t['cloudflareCredentialSettingPresent']=True
  with self.assertRaises(AssertionError):M['validate_next_renewal_projection'](old,new,s,t)
 def test_next_observation_requires_exact_original_receipt(self):
  record=M['observed_renewal'](M['NEXT_OBSERVATION']);self.assertTrue(record['readOnly']);self.assertFalse(record['runtimeAccepted'])
  with self.assertRaises(AssertionError):M['observed_renewal']({**M['NEXT_OBSERVATION'],'sha256':'a'*64})
 def fixture(self):
  r=json.loads((ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-21817c2ae82d65c519f1803e268dc11e.json').read_bytes());v=json.loads(r['children'][1]['stdout'])['cronPinsObservation'];return v['expected'],v['actual'],v['actualSemantics']
 def test_only_exact_observed_four_fields_with_unchanged_semantics(self):
  old,new,s=self.fixture();self.assertTrue(M['validate_renewal_projection'](old,new,s,s))
 def test_all_other_pin_policy_and_semantic_changes_refuse(self):
  edits=[lambda a:a[0].update(sha256='a'*64),lambda a:a[1].update(inode=1),lambda a:a[2].update(mode=0o666),lambda a:a[2].update(uid=1),lambda a:a[2].update(nlink=2),lambda a:a[2].update(sha256='a'*64),lambda a:a[2].update(mtimeNs=a[2]['mtimeNs']+1),lambda a:a[2].update(bytes=a[2]['bytes']+1)]
  for edit in edits:
   old,new,s=self.fixture();edit(new)
   with self.assertRaises(AssertionError):M['validate_renewal_projection'](old,new,s,s)
  old,new,s=self.fixture()
  with self.assertRaises(AssertionError):M['validate_renewal_projection'](old,new,s,{**s,'authenticator':'dns-cloudflare'})
 def test_expired_actual_baseline_cannot_be_reused_after_renewal_successor(self):
  with self.assertRaisesRegex(AssertionError,'FRESH_HEALTHY_BASELINE_REQUIRED'):
   M['current_spec']({'file':'D:/sabalanerp-online-qa/source-install-healthy-baseline-20261028T110359520624Z.json','sha256':'53c3e8ba4e7959b24d7ef3a32aeab345a1a9f2cc10bd31230008b5219b02e39a'})
class CurrentRenewalTests(unittest.TestCase):
 def fixture(self):
  a=json.loads((ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-7ca9dd49be9b52095d8d5a09fd08fbd2.json').read_bytes())['observation']['cronPinsObservation'];b=json.loads((ROOT/'reports/qa/issue-419-c3-bindings-20261026/CRON-PIN-OBSERVATION-c78f3a499a5d22832e51004593ca36a9.json').read_bytes())['observation']['cronPinsObservation'];return a['actual'],b['actual'],a['actualSemantics'],b['actualSemantics']
 def test_current_observed_renewal_exact_delta(self):self.assertTrue(M['validate_current_renewal_projection'](*self.fixture()))
 def test_unobserved_fields_and_secrets_refuse(self):
  for edit in [lambda a:a[0].update(inode=1),lambda a:a[1].update(sha256='a'*64),lambda a:a[2].update(inode=1),lambda a:a[2].update(mtimeNs=1),lambda a:a[2].update(ctimeNs=1),lambda a:a[2].update(sha256='a'*64),lambda a:a[2].update(unobserved=True),lambda a:a[2].update(nlink=2)]:
   args=list(self.fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_current_renewal_projection'](*args)
  args=list(self.fixture());args[3]['cloudflareCredentialSettingPresent']=True
  with self.assertRaises(AssertionError):M['validate_current_renewal_projection'](*args)
class NovemberRenewalTests(unittest.TestCase):
 def fixture(self):
  a=M['observed_renewal'](M['CURRENT_OBSERVATION'])['cronPinsObservation'];b=M['observed_renewal'](M['NOVEMBER_OBSERVATION'])['cronPinsObservation'];return a['actual'],b['actual'],a['actualSemantics'],b['actualSemantics']
 def test_exact_november_observation_and_natural_originals(self):self.assertTrue(M['validate_november_renewal_projection'](*self.fixture()))
 def test_all_other_fields_or_unobserved_successors_refuse(self):
  for edit in [lambda a:a[0].update(inode=1),lambda a:a[1].update(sha256='a'*64),lambda a:a[2].update(inode=1),lambda a:a[2].update(mtimeNs=1),lambda a:a[2].update(ctimeNs=1),lambda a:a[2].update(sha256='a'*64),lambda a:a[2].update(unobserved=True),lambda a:a[2].update(nlink=2),lambda a:a[2].update(mode=0o666),lambda a:a[2].update(uid=1),lambda a:a[2].update(bytes=640)]:
   args=list(self.fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_november_renewal_projection'](*args)
  args=list(self.fixture());args[3]['cloudflareCredentialSettingPresent']=True
  with self.assertRaises(AssertionError):M['validate_november_renewal_projection'](*args)
 def test_new_observation_rejects_changed_receipt(self):
  with self.assertRaises(AssertionError):M['observed_renewal']({**M['NOVEMBER_OBSERVATION'],'sha256':'a'*64})
class NovemberSecondRenewalTests(unittest.TestCase):
 def fixture(self):
  a=M['observed_renewal'](M['NOVEMBER_OBSERVATION'])['cronPinsObservation'];b=M['observed_renewal'](M['NOVEMBER_SECOND_OBSERVATION'])['cronPinsObservation'];return a['actual'],b['actual'],a['actualSemantics'],b['actualSemantics']
 def test_only_exact_second_november_renewal_preserves_semantics(self):
  self.assertTrue(M['validate_november_second_renewal_projection'](*self.fixture()))
 def test_other_file_pin_future_incarnation_policy_or_semantics_refuse(self):
  for edit in [lambda a:a[0].update(inode=1),lambda a:a[1].update(sha256='a'*64),lambda a:a[2].update(inode=526204),lambda a:a[2].update(mtimeNs=1),lambda a:a[2].update(ctimeNs=1),lambda a:a[2].update(sha256='a'*64),lambda a:a[2].update(nlink=2),lambda a:a[2].update(mode=0o666),lambda a:a[2].update(uid=1),lambda a:a[2].update(bytes=640),lambda a:a[2].update(extra=True)]:
   args=list(self.fixture());edit(args[1])
   with self.assertRaises(AssertionError):M['validate_november_second_renewal_projection'](*args)
  args=list(self.fixture());args[3]['authenticator']='dns-cloudflare'
  with self.assertRaises(AssertionError):M['validate_november_second_renewal_projection'](*args)
 def test_changed_observation_pin_refuses(self):
  with self.assertRaises(AssertionError):M['observed_renewal']({**M['NOVEMBER_SECOND_OBSERVATION'],'sha256':'a'*64})
if __name__=='__main__':unittest.main()
