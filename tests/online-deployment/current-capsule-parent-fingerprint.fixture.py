"""Behavioral filesystem cases; run only in a private /tmp tree on existing Linux service."""
import os, pathlib, sys, tempfile, unittest

class HeldFingerprintCases(unittest.TestCase):
    def setUp(self):
        assert os.getuid() == 0
        self.temp = tempfile.TemporaryDirectory(prefix='issue419-private-fingerprint-', dir='/tmp')
        self.root = pathlib.Path(self.temp.name)
        assert self.root.resolve().parent == pathlib.Path('/tmp') and self.root.name.startswith('issue419-private-fingerprint-')
        (self.root / 'held').mkdir(mode=0o700)
        (self.root / 'held' / 'data.bin').write_bytes(b'preserved\x00\xff\r\n')
    def tearDown(self):
        root = self.root; self.temp.cleanup(); assert not root.exists()
    def test_byte_and_metadata_changes_have_distinct_fingerprints(self):
        first = capsule['fingerprint'](self.root)
        (self.root / 'held' / 'data.bin').write_bytes(b'changed!!\x00\xff\r\n')
        second = capsule['fingerprint'](self.root)
        self.assertNotEqual(first['treeSha256'], second['treeSha256'])
        os.chmod(self.root / 'held' / 'data.bin', 0o400)
        self.assertNotEqual(second['treeSha256'], capsule['fingerprint'](self.root)['treeSha256'])
    def test_symlinks_and_fifo_are_never_followed_or_opened(self):
        os.symlink('/never-follow-this-held-target', self.root / 'link')
        os.mkfifo(self.root / 'held-fifo', 0o600)
        first = capsule['fingerprint'](self.root)
        self.assertEqual(first['entries'], 5)
        self.assertEqual(first['bytes'], len(b'preserved\x00\xff\r\n'))
        self.assertEqual(first, capsule['fingerprint'](self.root))
    def test_mutation_during_file_read_is_refused(self):
        original = capsule['os'].read; changed = False
        def read(fd, size):
            nonlocal changed
            raw = original(fd, size)
            if raw and not changed:
                changed = True
                (self.root / 'held' / 'data.bin').write_bytes(b'changed-during-observation')
            return raw
        capsule['os'].read = read
        try:
            with self.assertRaises(AssertionError): capsule['fingerprint'](self.root)
        finally: capsule['os'].read = original

if __name__ == '__main__':
    result = unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromTestCase(HeldFingerprintCases))
    assert result.testsRun == 3, 'EXACT_THREE_BEHAVIORAL_CASES_REQUIRED'
    sys.exit(0 if result.wasSuccessful() else 1)
