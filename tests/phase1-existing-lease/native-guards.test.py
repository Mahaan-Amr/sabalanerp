"""Pure synthetic validation; never opens a lease or touches operational paths."""
import copy
import importlib.util
from pathlib import Path
import unittest

source=Path(__file__).parents[2]/'scripts/lib/reconciliation-phase1-native-launcher.py'
spec=importlib.util.spec_from_file_location('phase1_native_validation',source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def records():
    ident='1:'+'0'*32
    lease={'fileId':ident,'originalPid':123,'lockIdentitySourceSha256':'a'*64,'birth':'UNKNOWN'}
    coverage={'scope':'KNOWN_OPERATION_ENTRIES_ONLY','knownMatches':0,'unreadableRelevant':1,'unreadableRelevance':'UNKNOWN','wslNative':'NOT_GLOBAL_CENSUS','processSourceSha256':'b'*64}
    evidence=[{'label':label,'bytes':0,'sha256':'c'*64,'fileId':ident,'sourceSha256':'d'*64,'pathSnapshot':'NONATOMIC_ANCESTOR_UNPROVEN','concurrentContentMutation':'UNPROVEN'} for label in ('baseline','roleHeld')]
    common={'format':'phase1-audit-record/v1','oldObligation':'RETAINED_UNRESOLVED','historicalEof':'UNKNOWN','safeState':'UNKNOWN','scopeReuse':False,'productionAdmission':False,'outputRootFileId':ident,'newLease':lease,'actorCoverage':coverage,'evidence':evidence,'directoryDurability':'UNKNOWN','acl':'UNVERIFIED_DEFAULT'}
    pre={**common,'stage':'PRE_RELEASE','ownLeaseClosure':'UNKNOWN','closure':None}
    closed={**common,'stage':'OWN_LEASE_CLOSED','ownLeaseClosure':'CALLER_REPORTED_NOT_INDEPENDENT','closure':{'pid':123,'birth100ns':'UNKNOWN','exitCode':0,'signal':None,'stdoutEof':True,'stderrEof':True,'closeMarker':'LEASE_CLOSED','observedAt':'2026-11-02T10:00:00.000Z','evidenceType':'ORIGINAL_PARENT_REPORTED'}}
    return pre,closed,ident

class GuardTests(unittest.TestCase):
    def test_close_failure_and_timeout_never_become_success(self):
        result={'exitCode':0,'stdoutEof':True,'stderrEof':True,'jobActive':0,'closeResults':{'thread':'CLOSED','process':'CLOSED','job':'UNKNOWN'}}
        self.assertFalse(module.child_observer_closed(result,[]))
        result['closeResults']['job']='CLOSED';result['timeout']=True
        self.assertFalse(module.child_observer_closed(result,[]))

    def test_identity_mismatch_and_partial_receipt_rejected(self):
        pre,closed,identity=records();module.validate_receipts(pre,closed,identity)
        changed=copy.deepcopy(closed);changed['closure']['pid']=999
        with self.assertRaises(RuntimeError):module.validate_receipts(pre,changed,identity)
        changed=copy.deepcopy(closed);del changed['evidence']
        with self.assertRaises(RuntimeError):module.validate_receipts(pre,changed,identity)

if __name__=='__main__':unittest.main()
