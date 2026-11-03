"""Tests only new test-owned files; never opens an operational lease."""
import ctypes as C
from ctypes import wintypes as W
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import uuid

SOURCE = Path(__file__).with_name('reconciliation-fixture-existing-lease.ps1')
K = C.WinDLL('kernel32', use_last_error=True) if os.name == 'nt' else None
class ID128(C.Structure):
    _fields_ = [('value', C.c_ubyte * 16)]
class INFO(C.Structure):
    _fields_ = [('volume', C.c_ulonglong), ('value', ID128)]

def file_identity(path):
    K.CreateFileW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE]
    K.CreateFileW.restype = W.HANDLE
    K.GetFileInformationByHandleEx.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
    K.GetFileInformationByHandleEx.restype = W.BOOL
    K.CloseHandle.argtypes = [W.HANDLE]
    K.CloseHandle.restype = W.BOOL
    handle = K.CreateFileW(str(path), 0, 7, None, 3, 0x200000, None)
    if handle == C.c_void_p(-1).value:
        raise OSError(C.get_last_error(), 'fixture metadata open failed')
    try:
        info = INFO()
        if not K.GetFileInformationByHandleEx(handle, 18, C.byref(info), C.sizeof(info)):
            raise OSError(C.get_last_error(), 'fixture identity unavailable')
        return str(info.volume) + ':' + bytes(info.value.value).hex()
    finally:
        if not K.CloseHandle(handle):
            raise OSError(C.get_last_error(), 'fixture handle closure unproven')

@unittest.skipUnless(os.name == 'nt', 'Windows fixture only')
class ExistingLeaseTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / ('sabalan-phase1-fixture-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o700)
        self.target = self.root / 'fixture.lock'

    def run_child(self, expected):
        env = os.environ.copy()
        env['SABALAN_AUDIT_FIXTURE_LEASE'] = str(self.target)
        env['SABALAN_AUDIT_FIXTURE_FILE_ID'] = expected
        child = subprocess.Popen([r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
                                  '-NoProfile', '-NonInteractive', '-File', str(SOURCE)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=env)
        try:
            stdout, stderr = child.communicate('RELEASE_AFTER_VERIFIED_AUDIT\n', timeout=30)
        except subprocess.TimeoutExpired:
            # Keep custody and wait; never infer closure or kill by PID.
            child.wait()
            raise AssertionError('FIXTURE_TIMEOUT_UNKNOWN')
        return subprocess.CompletedProcess(child.args, child.returncode, stdout, stderr)

    def test_existing_matching_identity(self):
        self.target.write_bytes(b'fixture only')
        identity = file_identity(self.target)
        result = self.run_child(identity)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['LEASE_READY ' + identity, 'LEASE_CLOSED'])

    def test_missing_file_is_not_created(self):
        result = self.run_child('1:' + '0' * 32)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('LEASE_READY', result.stdout)
        self.assertFalse(self.target.exists())

    def test_wrong_identity_never_reports_ready(self):
        self.target.write_bytes(b'fixture only')
        result = self.run_child('1:' + '0' * 32)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('LEASE_READY', result.stdout)

if __name__ == '__main__':
    unittest.main()
