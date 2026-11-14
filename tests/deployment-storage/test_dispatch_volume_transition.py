import importlib.util
import unittest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch


SOURCE = Path(__file__).resolve().parents[2] / 'deploy/scripts/dispatch-volume-transition.py'
spec = importlib.util.spec_from_file_location('dispatch_transition', SOURCE)
transition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(transition)


class DispatchVolumeTransitionTests(unittest.TestCase):
    def setUp(self):
        self.old = {
            'Id': 'a' * 64, 'Image': 'sha256:' + 'b' * 64,
            'State': {'Running': False, 'Pid': 0},
            'Config': {'Labels': {'com.docker.compose.project': 'sabalanerp',
                                  'com.docker.compose.service': 'backend'}},
            'Mounts': [],
        }

    def test_stopped_legacy_container_and_zero_rows_admit_empty_transition(self):
        transition.assert_old_layer(self.old, 'a' * 64, 'sha256:' + 'b' * 64,
                                    'sabalanerp', False, 0)

    def test_legacy_rows_or_any_masking_mount_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
            transition.assert_old_layer(self.old, 'a' * 64, 'sha256:' + 'b' * 64,
                                        'sabalanerp', False, 1)
        self.old['Mounts'] = [{'Destination': '/app/storage', 'Type': 'volume'}]
        with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
            transition.assert_old_layer(self.old, 'a' * 64, 'sha256:' + 'b' * 64,
                                        'sabalanerp', False, 0)

    def test_legacy_files_and_changed_identity_fail_closed(self):
        with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
            transition.assert_old_layer(self.old, 'a' * 64, 'sha256:' + 'b' * 64,
                                        'sabalanerp', True, 0)
        with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
            transition.assert_old_layer(self.old, 'c' * 64, 'sha256:' + 'b' * 64,
                                        'sabalanerp', False, 0)

    def test_first_release_volume_must_be_empty_and_compose_owned(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            volume = {'Name': 'sabalanerp_backend_storage_dispatch_documents', 'Driver': 'local',
                      'Scope': 'local', 'Options': None, 'Mountpoint': str(root),
                      'Labels': {'com.docker.compose.project': 'sabalanerp',
                                 'com.docker.compose.volume': 'backend_storage_dispatch_documents'}}
            with patch.object(transition, 'command', side_effect=lambda _args: json.dumps([volume])):
                transition.assert_volume(volume['Name'], 'sabalanerp', True)
                (root / 'late-partner.pdf').write_bytes(b'late acknowledged artifact')
                with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
                    transition.assert_volume(volume['Name'], 'sabalanerp', True)
                (root / 'late-partner.pdf').unlink()
                volume['Labels']['com.docker.compose.project'] = 'other'
                with self.assertRaisesRegex(RuntimeError, 'DISPATCH_TRANSITION_UNPROVEN'):
                    transition.assert_volume(volume['Name'], 'sabalanerp', True)

    def test_deployment_orders_empty_stage_then_drained_attestation_before_checkpoint(self):
        script = (SOURCE.parent / 'deploy.sh').read_text()
        stage = 'dispatch_volume_transition stage'
        attest = 'dispatch_volume_transition attest'
        self.assertLess(script.index(stage), script.index('storage-preflight.sh', script.index(stage)))
        drained = script.index('phase SERVICES_DRAINED')
        self.assertLess(drained, script.index(attest, drained))
        self.assertLess(script.index(attest, drained), script.index('capture_clamav_checkpoint\n', drained))


if __name__ == '__main__':
    unittest.main()
