#!/usr/bin/env python3
"""Finite read-only observation inside the still-owned serving backend.

No lease, checkpoint, runtime, marker or business record is changed here.
Only the original controller selects the coordination root and gate endpoints.
"""
import hashlib
import json
import os
import stat
import sys
import urllib.error
import urllib.parse
import urllib.request


def observe(value):
    assert set(value) == {'coordinationDirectory', 'targets'}
    root = value['coordinationDirectory']
    assert isinstance(root, str) and os.path.isabs(root) and os.path.realpath(root) == root
    descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        before = os.fstat(descriptor)
        assert stat.S_ISDIR(before.st_mode) and before.st_uid == 0 and not before.st_mode & 0o022
        fields = ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode')

        def absent():
            assert tuple(getattr(os.fstat(descriptor), key) for key in fields) == tuple(getattr(before, key) for key in fields)
            assert tuple(getattr(os.lstat(root), key) for key in fields) == tuple(getattr(before, key) for key in fields)
            try:
                os.stat('deployment-maintenance.json', dir_fd=descriptor, follow_symlinks=False)
            except FileNotFoundError:
                return
            raise RuntimeError('ONLINE_CLIENT_MAINTENANCE_STILL_ACTIVE')

        absent()
        targets = value['targets']
        assert set(targets) == {'backend', 'frontend', 'inquiry', 'nginx'}

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *arguments, **keywords):
                return None

        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        results = []
        for name, url in targets.items():
            parsed = urllib.parse.urlsplit(url)
            assert parsed.scheme == 'http' and parsed.hostname and parsed.username is None and parsed.password is None
            assert not parsed.query and not parsed.fragment
            request = urllib.request.Request(url, headers={'Connection': 'close'})
            try:
                response = opener.open(request, timeout=10)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                status = response.status
                assert status == 200 or name in ('frontend', 'inquiry') and status in (301, 302, 303, 307, 308)
                body = response.read(1048577)
                assert len(body) <= 1048576
                results.append({'name': name, 'status': status, 'bodySha256': hashlib.sha256(body).hexdigest()})
        absent()
        return {'format': 'sabalan-original-client-terminal-observation/v1', 'maintenanceAbsent': True, 'endpoints': results, 'readOnly': True}
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    raw = sys.stdin.buffer.read(16385)
    assert 0 < len(raw) <= 16384
    print(json.dumps(observe(json.loads(raw)), separators=(',', ':')), flush=True)
