"""Host checks for original-handle custody and prepared-code refusal.

These exercise real small child processes/files, not native guardian acceptance.
The joined Linux cohort remains required for native/SQL/Chrome qualification.
"""
import hashlib
import importlib.util
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('candidate_owner', Path(__file__).with_name('application-native-candidate-controller.fixture.py'))
owner_module = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner_module)


class SmallPipeSelector:
    """Windows selectors lack POSIX pipe support; children emit < pipe capacity."""
    def __init__(self): self.streams = {}
    def register(self, stream, events, data): self.streams[stream] = data
    def unregister(self, stream): self.streams.pop(stream)
    def get_map(self): return self.streams
    def select(self, timeout):
        return [(types.SimpleNamespace(fileobj=stream, data=data), 1) for stream, data in list(self.streams.items())]
    def close(self): pass


class CandidateControllerTests(unittest.TestCase):
    def test_original_environment_refuses_loader_injection_instead_of_stripping_it(self):
        owner_module.assert_loading_environment({'NODE_OPTIONS': '--max-old-space-size=128', 'NODE_PATH': '/app/node_modules'})
        for key, value in [('NODE_OPTIONS', '--require=unreviewed.cjs'), ('NODE_PRELOAD', 'unreviewed.cjs'),
                           ('LD_PRELOAD', 'other.so'), ('LD_AUDIT', 'other.so'), ('LD_LIBRARY_PATH', '/other'),
                           ('DYLD_INSERT_LIBRARIES', 'other.so'), ('DYLD_LIBRARY_PATH', '/other'), ('NODE_PATH', '/other')]:
            with self.subTest(key=key), self.assertRaisesRegex(RuntimeError, 'CANDIDATE_LOADING_ENVIRONMENT_REFUSED'):
                owner_module.assert_loading_environment({key: value})

    def bare(self):
        owner = object.__new__(owner_module.CandidateOwner)
        owner.probes, owner.actors, owner.helpers, owner.sticky_failures = {}, {}, {}, []
        owner.controller_id = 'a' * 64
        return owner

    def test_only_original_pre_child_capacity_exception_can_issue_no_start_receipt(self):
        owner=self.bare();events=[]
        owner.channel=types.SimpleNamespace(emit=lambda event,body:events.append((event,body)),assert_observers_closed=lambda:None)
        snapshot=[dict(owner.actors),dict(owner.helpers),dict(owner.probes)]
        observed={'memoryMaximum':768*owner_module.MIB,'memoryAvailable':1,'memoryCurrent':768*owner_module.MIB-1,'events':{}}
        with patch.object(owner_module,'resource',return_value=observed):
            with self.assertRaises(owner_module._OriginalCapacityRefusal) as refusal:owner.capacity('chrome')
        body={'requestId':'b'*64}
        self.assertFalse(owner.refuse_before_start('START_CHROME',body,RuntimeError('capacity'),snapshot))
        self.assertTrue(owner.refuse_before_start('START_CHROME',body,refusal.exception,snapshot))
        self.assertEqual(events[0][0],'PHASE_REFUSED');self.assertIsNone(events[0][1]['actorId'])
        self.assertEqual(events[0][1]['decision'],'NATIVE_ACTOR_NOT_STARTED')
        # The SAME refusal cannot assert no work after an actual helper birth.
        helper=subprocess.Popen([sys.executable,'-c',"print('actual helper')"],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        owner.helpers['ingress']={'actor':helper,'closed':False}
        try:self.assertFalse(owner.refuse_before_start('START_CHROME',body,refusal.exception,snapshot))
        finally:
            helper.communicate(timeout=10);self.assertEqual(helper.returncode,0)
        self.assertEqual(len(events),1)
        with self.assertRaisesRegex(RuntimeError,'CANDIDATE_CAPACITY_REFUSAL_AUTHORITY_UNPROVEN'):
            owner_module._OriginalCapacityRefusal(object(),'chrome',observed,owner_module.CAPACITY['chrome'])

    def test_probe_overflow_drains_same_original_child_before_refusal(self):
        owner = self.bare()
        with patch.object(owner_module.selectors, 'DefaultSelector', SmallPipeSelector), patch.object(owner_module.os, 'set_blocking'):
            with self.assertRaisesRegex(RuntimeError, 'CANDIDATE_OBSERVER_OUTPUT_BOUND'):
                owner.probe('bounded', [sys.executable, '-c', "import sys;sys.stdout.write('x'*1024);sys.stderr.write('done')"], maximum=128)
        record = next(iter(owner.probes.values()))
        self.assertTrue(record['closed']); self.assertEqual(record['originalReturncode'], 0)
        self.assertEqual(record['outputBytes'], 1024); self.assertEqual(record['errorBytes'], 4)
        self.assertEqual(record['actor'].pid, record['originalPid'])

    def test_probe_setup_failure_retains_actual_original_handle(self):
        owner = self.bare()
        class BrokenSelector(SmallPipeSelector):
            def register(self, *args): raise KeyboardInterrupt('interrupt after child birth')
        with patch.object(owner_module.selectors, 'DefaultSelector', BrokenSelector), patch.object(owner_module.os, 'set_blocking'):
            with self.assertRaises(KeyboardInterrupt):
                owner.probe('interrupted', [sys.executable, '-c', "print('original')"])
        record = next(iter(owner.probes.values()))
        self.assertFalse(record['closed']); self.assertIsInstance(record['actor'], subprocess.Popen)
        output, _ = record['actor'].communicate(timeout=10)
        self.assertEqual(record['actor'].returncode, 0); self.assertIn(b'original', output)

    def test_reporting_pipe_failure_does_not_release_custody(self):
        owner = self.bare()
        owner.channel = types.SimpleNamespace(emit=lambda *args: (_ for _ in ()).throw(BrokenPipeError()))
        owner.held(RuntimeError('original remains owned'))
        self.assertEqual(owner.sticky_failures, ['RuntimeError:original remains owned'])

    def test_prepared_inquiry_compiled_bytes_must_match_enrolled_archive(self):
        owner = self.bare()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); app = root / 'app'; (app / '.next').mkdir(parents=True)
            target = app / '.next/server.js'; target.write_bytes(b'original compiled bytes')
            archive = root / 'inquiry-code.tar.gz'
            with tarfile.open(archive, 'w:gz') as output:
                directory = tarfile.TarInfo('.next'); directory.type = tarfile.DIRTYPE; output.addfile(directory)
                member = tarfile.TarInfo('.next/server.js'); member.size = target.stat().st_size
                output.addfile(member, io.BytesIO(target.read_bytes()))
            sha = hashlib.sha256(archive.read_bytes()).hexdigest()
            owner.files = {'inquiry-code.tar.gz': sha}; owner.artifact = lambda name: archive
            custody = {'codeArchiveSha256': sha, 'dependency': {'retainedDependencies': '/owned/retained-dependencies'}}
            with patch.object(owner_module.os, 'readlink', return_value='/owned/retained-dependencies'):
                owner.verify_inquiry_code(app, custody)
                target.write_bytes(b'altered! compiled bytes')
                with self.assertRaisesRegex(RuntimeError, 'CANDIDATE_INQUIRY_CODE_(BYTES|FILE)_CHANGED'):
                    owner.verify_inquiry_code(app, custody)


if __name__ == '__main__': unittest.main()
