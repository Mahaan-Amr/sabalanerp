"""Source-interface tests only; no native/Popen/SQL authority is minted."""
import importlib.util
import io
import json
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).with_name('application-native-candidate-controller.fixture.py')
spec = importlib.util.spec_from_file_location('candidate_interface_subject', SOURCE)
subject = importlib.util.module_from_spec(spec)
spec.loader.exec_module(subject)

class Actor:
    pid = 12345
    def __init__(self): self.stdin = io.BytesIO()
    def poll(self): return None

class CandidateInterfaces(unittest.TestCase):
    def test_point_inquiry_cannot_start_early_or_retire_another_original_actor(self):
        owner=subject.CandidateOwner.__new__(subject.CandidateOwner);owner.completed=set();owner.actors={}
        with self.assertRaisesRegex(RuntimeError,'POINT_INQUIRY_ORDER_INVALID'):
            owner.start_online_point_inquiry({'input':{}})
        owner.actors={'online-point-inquiry':{'id':'a'*64,'closed':False}}
        with self.assertRaisesRegex(RuntimeError,'STOP_OWNER_CHANGED'):
            owner.finish_online_point_inquiry({'input':{'actorId':'b'*64}})

    def test_pristine_observer_cannot_run_after_diagnostic_actor_or_with_foreign_input(self):
        owner=subject.CandidateOwner.__new__(subject.CandidateOwner)
        owner.completed={'migration'};owner.actors={}
        with self.assertRaisesRegex(RuntimeError,'MUST_PRECEDE_MIGRATION'):
            owner.pristine_performance({'input':{'seedSha256':'a'*64}})
        owner.completed=set();owner.actors={'old':{'closed':True}}
        with self.assertRaisesRegex(RuntimeError,'MUST_PRECEDE_MIGRATION'):
            owner.pristine_performance({'input':{'seedSha256':'a'*64}})
        owner.actors={}
        with self.assertRaisesRegex(RuntimeError,'INPUT_INVALID'):
            owner.pristine_performance({'input':{'seedSha256':'a'*64,'origin':'http://foreign'}})

    def test_private_wire_rejects_wrong_owner_and_newline_before_write(self):
        owner = subject.CandidateOwner.__new__(subject.CandidateOwner)
        actor = Actor(); value = dict(id='a'*64,actor=actor,birth={'pinned':True},closed=False,grant={'sha256':'b'*64},privatePrepared=False)
        owner.actors = {'private-jobs':value}
        for request in [dict(actorId='c'*64,wire='{}'),dict(actorId='a'*64,wire='{}\n{}')]:
            with self.assertRaises(RuntimeError): owner.private_wire({'requestId':'1'*64,'input':request},True)
        self.assertEqual(actor.stdin.getvalue(),b'')

    def test_private_wire_preserves_signed_bytes_and_prepare_is_not_close(self):
        owner = subject.CandidateOwner.__new__(subject.CandidateOwner)
        actor = Actor(); value = dict(id='a'*64,actor=actor,birth={'pinned':True},closed=False,grant={'sha256':'b'*64},privatePrepared=False)
        owner.actors = {'private-jobs':value}; emitted=[]
        owner.channel = type('Channel',(),{'session':'9'*64,'emit':staticmethod(lambda event,body:emitted.append((event,body)))})()
        owner.wait_event=lambda *args:dict(format='sabalan-private-qualification-worker/v1',session='9'*64,actorId='a'*64,scopeSha256='b'*64,sequence=1)
        previous=subject.birth;subject.birth=lambda pid:{'pinned':True}
        try:
            wire='{"format":"signed-original-input","signature":"example"}'
            owner.private_wire({'requestId':'1'*64,'input':dict(actorId='a'*64,wire=wire)},True)
            self.assertEqual(actor.stdin.getvalue(),wire.encode()+b'\n')
            self.assertTrue(value['privatePrepared']);self.assertFalse(value['closed'])
            self.assertEqual(emitted[0][0],'PRIVATE_JOBS_PREPARED')
            with self.assertRaises(RuntimeError):owner.private_wire({'requestId':'1'*64,'input':dict(actorId='a'*64,wire=wire)},True)
        finally:subject.birth=previous

    def test_private_start_cannot_overlap_prior_original_actor(self):
        owner=subject.CandidateOwner.__new__(subject.CandidateOwner)
        owner.completed={'migration','restored-baseline','restored-inquiry','restored-http','chrome'}
        owner.actors={'old':{'closed':False}};owner.helpers={}
        owner.new_process=lambda *args,**kwargs:self.fail('must refuse before Popen')
        with self.assertRaisesRegex(RuntimeError,'PRIOR_ORIGINAL_OWNER_ACTIVE'):owner.private_runtime({'requestId':'1'*64,'input':{}},'private-jobs')

    def test_second_http_control_is_scoped_to_its_own_original_actor(self):
        owner = subject.CandidateOwner.__new__(subject.CandidateOwner)
        actor = Actor(); value = dict(id='a'*64,actor=actor,birth={'pinned':True},closed=False,grant={'sha256':'b'*64},privatePrepared=False)
        owner.actors = {'private-http2':value}; emitted=[]
        owner.channel = type('Channel',(),{'session':'9'*64,'emit':staticmethod(lambda event,body:emitted.append((event,body)))})()
        owner.wait_event=lambda *args:dict(format='sabalan-private-qualification-worker/v1',session='9'*64,actorId='a'*64,scopeSha256='b'*64,sequence=1)
        wire='{"originalSignedControl":"unchanged"}'
        with patch.object(subject,'birth',lambda pid:{'pinned':True}):
            with self.assertRaises(KeyError):owner.private_wire({'requestId':'1'*64,'input':dict(actorId='a'*64,wire=wire)},True,'private-jobs')
            self.assertEqual(actor.stdin.getvalue(),b'')
            owner.private_wire({'requestId':'1'*64,'input':dict(actorId='a'*64,wire=wire)},True,'private-http2')
            self.assertEqual(actor.stdin.getvalue(),wire.encode()+b'\n')
            self.assertEqual(emitted[0][0],'PRIVATE_HTTP2_PREPARED')
            self.assertTrue(value['privatePrepared']);self.assertFalse(value['closed'])
            with self.assertRaisesRegex(RuntimeError,'CONTROL_ORDER_INVALID'):
                owner.private_wire({'requestId':'1'*64,'input':dict(actorId='a'*64,wire=wire)},True,'private-http2')

    def test_prepared_http_cannot_admit_new_jobs_or_reuse_scope(self):
        owner=subject.CandidateOwner.__new__(subject.CandidateOwner)
        owner.completed={'migration','restored-baseline','restored-inquiry','restored-http','chrome'}
        owner.actors={'private-http2':{'closed':False,'privatePrepared':True}};owner.helpers={}
        owner.new_process=lambda *args,**kwargs:self.fail('must refuse before Popen')
        with self.assertRaisesRegex(RuntimeError,'PRIOR_ORIGINAL_OWNER_ACTIVE'):
            owner.private_runtime({'requestId':'1'*64,'input':{}},'private-jobs')

    def test_catalog_manifest_bytes_checked_and_traversal_refused(self):
        base=Path('D:/sabalanerp-online-qa').resolve()
        with tempfile.TemporaryDirectory(prefix='candidate-catalog-interface-',dir=base) as directory, patch.object(subject,'private_read',lambda file,maximum:Path(file).read_bytes()):
            root=Path(directory).resolve();self.assertTrue(root.is_relative_to(base))
            app=root/'full-catalog';app.mkdir();script=app/'run-full-catalog-controller.py';script.write_bytes(b'pass\n')
            manifest=dict(format='sabalan-full-catalog-source/v1',operation='1'*32,files={'run-full-catalog-controller.py':{'sha256':hashlib.sha256(script.read_bytes()).hexdigest(),'bytes':5}})
            def save():
                raw=json.dumps(manifest).encode();(app/'source-manifest.json').write_bytes(raw);(root/'full-catalog-source-manifest.json').write_bytes(raw);return hashlib.sha256(raw).hexdigest()
            owner=subject.CandidateOwner.__new__(subject.CandidateOwner);owner.root=root
            owner.artifact=lambda name:root/name;owner.index={'catalog':{'operation':'1'*32,'sourceManifestSha256':save()}}
            self.assertEqual(owner.catalog_sources(),app)
            script.write_bytes(b'FAIL\n')
            with self.assertRaisesRegex(RuntimeError,'SOURCE_BYTES_CHANGED'):owner.catalog_sources()
            manifest['files']={'../escape.py':{'sha256':'0'*64,'bytes':1}};owner.index['catalog']['sourceManifestSha256']=save()
            with self.assertRaisesRegex(RuntimeError,'SOURCE_MEMBER_INVALID'):owner.catalog_sources()

    def test_catalog_original_cli_identity_and_known_failed_closure(self):
        owner=subject.CandidateOwner.__new__(subject.CandidateOwner)
        owner.root=Path('D:/source-interface-only')
        owner.index={'oid':'111'}
        owner.catalog_input=dict(operation='1'*32,databaseName='qa_source',databaseOid='111',systemIdentifier='222',adminUsername='qa-admin')
        actor=Actor();actor.returncode=0
        value=dict(actor=actor,birth={'original':'interface-only'},before={'events':{}},deadlineExceeded=False,pumps=[],closed=False)
        result=dict(format='sabalan-native-full-catalog-original-controller/v1',operation='1'*32,passResult=True,
            cliOriginal=dict(pid=23456,state='S',parentPid=actor.pid,startTicks='123'),cliCode=0,
            allObservedOriginalBrowsersClosed=True,sourceFilesUnchanged=True,borrowsOriginalNativeIngress=True,databaseQuietVerifiedByChild=False,
            nativeDatabase={name:owner.catalog_input[name] for name in ['databaseName','databaseOid','systemIdentifier','adminUsername']},
            catalogApplicationName='qa-catalog-'+'1'*32,browserLaunches=[dict(originalCliDescendant=True,identity={'pinned':'interface-only'},originalPidfdExitObserved=True,exitCode='0',exitSignal='null')])
        owner.catalog_sources=lambda:None
        owner.sql=lambda text:'222' if 'system_identifier' in text else '111' if 'SELECT oid' in text else 'true' if 'rolsuper' in text else '0'
        with patch.object(subject,'private_read',lambda *args:json.dumps(result).encode()),patch.object(subject,'resource',lambda:{'events':{}}):
            returned,closure=owner.catalog_closed(value,True)
            self.assertEqual(closure['originalReturncode'],0);self.assertIsNone(closure['nativeRawBase64'])
            result['cliOriginal']=True
            with self.assertRaisesRegex(RuntimeError,'CLI_IDENTITY_UNPROVEN'):owner.catalog_closed(value,False)
            result['cliOriginal']=dict(pid=23456,state='S',parentPid=actor.pid+1,startTicks='123')
            with self.assertRaisesRegex(RuntimeError,'CLI_IDENTITY_UNPROVEN'):owner.catalog_closed(value,False)
            result['cliOriginal']['parentPid']=actor.pid;result['cliCode']=1;result['passResult']=False;actor.returncode=1
            returned,closure=owner.catalog_closed(value,False)
            self.assertFalse(returned['passResult']);self.assertEqual(closure['originalReturncode'],1)
            with self.assertRaisesRegex(RuntimeError,'QUALIFICATION_FAILED'):owner.catalog_closed(value,True)

if __name__=='__main__': unittest.main()
