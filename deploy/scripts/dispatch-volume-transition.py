#!/usr/bin/env python3
"""First-release dispatch volume transition under the original deployment owner.

The early stage allocates only an empty volume.  The old backend never mounts it.
After the old backend drains, verify its container layer and database again
before the checkpoint can use that volume.  Any ambiguity fails closed.
"""
import fcntl
import http.client
import json
import os
import re
import socket
import stat
import subprocess
import sys
import tarfile
from pathlib import Path
from urllib.parse import quote

TARGET = '/app/storage/dispatch-documents'
SOURCE = 'backend_storage_dispatch_documents'
ERROR = 'DISPATCH_TRANSITION_UNPROVEN'


def require(value):
    if not value:
        raise RuntimeError(ERROR)


def command(args):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=45, check=False)
    require(result.returncode == 0 and len(result.stdout) < 16 * 1024 * 1024)
    return result.stdout.decode('utf-8')


def assert_old_layer(old, old_id, old_image, project, running, rows):
    require(old.get('Id') == old_id and old.get('Image') == old_image)
    state = old.get('State') or {}
    require(state.get('Running') is running)
    if not running:
        require(state.get('Pid') == 0 and not state.get('OOMKilled'))
    labels = (old.get('Config') or {}).get('Labels') or {}
    require(labels.get('com.docker.compose.project') == project)
    require(labels.get('com.docker.compose.service') == 'backend')
    for mount in old.get('Mounts') or []:
        destination = mount.get('Destination', '').rstrip('/')
        require(destination != TARGET and not TARGET.startswith(destination + '/'))
    require(rows == 0)


def assert_owned_lock(root):
    require(os.getuid() == 0)
    lock = root / '.deploy-state/deployment.lock'
    actual, named = os.fstat(9), lock.lstat()
    require(stat.S_ISREG(actual.st_mode) and actual.st_uid == 0 and actual.st_nlink == 1)
    require((actual.st_dev, actual.st_ino) == (named.st_dev, named.st_ino))
    require(not actual.st_mode & 0o022)
    fdinfo = Path('/proc/self/fdinfo/9').read_text()
    require(re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+'
                      r'[0-9a-f]+:[0-9a-f]+:' + str(actual.st_ino) + r'\s+0\s+EOF\s*$',
                      fdinfo, re.M))


class DockerConnection(http.client.HTTPConnection):
    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.connect('/var/run/docker.sock')


def assert_empty_legacy_path(old_id):
    path = '/containers/' + old_id + '/archive?path=' + quote(TARGET, safe='')
    connection = DockerConnection('localhost', timeout=30)
    try:
        connection.request('HEAD', path)
        response = connection.getresponse()
        status = response.status
        response.read()
    finally:
        connection.close()
    require(status in (200, 404))
    if status == 404:
        return
    connection = DockerConnection('localhost', timeout=30)
    try:
        connection.request('GET', path)
        response = connection.getresponse()
        require(response.status == 200)
        seen_root = False
        with tarfile.open(fileobj=response, mode='r|') as archive:
            for member in archive:
                require(member.name.rstrip('/') == 'dispatch-documents' and member.isdir())
                require(not seen_root)
                seen_root = True
        require(seen_root)
    finally:
        connection.close()


def database_rows(compose):
    pgid = command(compose + ['ps', '-q', 'postgres']).strip()
    require(re.fullmatch(r'[a-f0-9]{12,64}', pgid))
    [postgres] = json.loads(command(['docker', 'inspect', pgid]))
    require(postgres['Id'].startswith(pgid) and postgres['State']['Running'])
    require(postgres['Config']['Labels']['com.docker.compose.service'] == 'postgres')
    rows = command(['docker', 'exec', pgid, 'sh', '-c',
                    'exec psql -XAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" '
                    '-c "SELECT count(*) FROM public.dispatch_document_artifacts"']).strip()
    require(re.fullmatch(r'[0-9]+', rows))
    return int(rows)


def assert_volume(name, project, empty):
    [volume] = json.loads(command(['docker', 'volume', 'inspect', name]))
    labels = volume.get('Labels') or {}
    require(volume.get('Name') == name and volume.get('Driver') == 'local')
    require(volume.get('Scope') == 'local' and not volume.get('Options'))
    require(labels.get('com.docker.compose.project') == project)
    require(labels.get('com.docker.compose.volume') == SOURCE)
    mount = Path(volume['Mountpoint'])
    require(mount.is_absolute() and not mount.is_symlink() and mount.resolve(strict=True) == mount)
    metadata = mount.stat()
    require(stat.S_ISDIR(metadata.st_mode) and metadata.st_uid == 0)
    if empty:
        require(not any(mount.iterdir()))


def run():
    require(sys.platform == 'linux' and len(sys.argv) == 6)
    mode, compose_file, env_file, old_id, old_image = sys.argv[1:]
    require(mode in ('stage', 'attest', 'verify-mounted'))
    require(re.fullmatch(r'[a-f0-9]{64}', old_id))
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', old_image))
    compose_path, env_path = Path(compose_file), Path(env_file)
    require(compose_path.is_absolute() and env_path.is_absolute())
    require(compose_path.name in ('docker-compose.prod.yml', 'docker-compose.rehearsal.yml'))
    require(compose_path.resolve(strict=True) == compose_path and env_path.resolve(strict=True) == env_path)
    root = compose_path.parent
    assert_owned_lock(root)
    compose = ['docker', 'compose', '--env-file', str(env_path), '-f', str(compose_path)]
    config = json.loads(command(compose + ['config', '--format', 'json']))
    project = config['name']
    require(re.fullmatch(r'[a-z0-9_-]+', project))
    mounts = [mount for mount in config['services']['backend']['volumes'] if mount['target'] == TARGET]
    require(len(mounts) == 1 and mounts[0]['type'] == 'volume' and mounts[0]['source'] == SOURCE
            and not mounts[0].get('read_only'))
    name = config['volumes'][SOURCE]['name']
    require(name == project + '_' + SOURCE)
    observed_id = command(compose + ['ps', '-a', '-q', 'backend']).strip()
    require(re.fullmatch(r'[a-f0-9]{12,64}', observed_id) and old_id.startswith(observed_id))
    [old] = json.loads(command(['docker', 'inspect', old_id]))
    running = mode in ('stage', 'verify-mounted')
    rows = database_rows(compose)
    mount = [item for item in old.get('Mounts') or [] if item.get('Destination') == TARGET]
    if mount:
        require(len(mount) == 1 and mount[0].get('Type') == 'volume'
                and mount[0].get('Name') == name and mount[0].get('RW'))
        require(old.get('Id') == old_id and old.get('Image') == old_image
                and old['State']['Running'] is running)
        assert_volume(name, project, False)
        print('mounted')
        return
    require(mode != 'verify-mounted')
    assert_old_layer(old, old_id, old_image, project, running, rows)
    assert_empty_legacy_path(old_id)
    names = command(['docker', 'volume', 'ls', '--format', '{{.Name}}']).splitlines()
    if name not in names:
        require(mode == 'stage')
        created = command(['docker', 'volume', 'create',
                           '--label', 'com.docker.compose.project=' + project,
                           '--label', 'com.docker.compose.volume=' + SOURCE, name]).strip()
        require(created == name)
    assert_volume(name, project, True)
    # A live stage can race with a new legacy write; the drained attestation is mandatory.
    if mode == 'attest':
        [old_again] = json.loads(command(['docker', 'inspect', old_id]))
        assert_old_layer(old_again, old_id, old_image, project, False, database_rows(compose))
        assert_empty_legacy_path(old_id)
    print('legacy')


if __name__ == '__main__':
    try:
        run()
    except (Exception, OSError) as error:
        print(ERROR + ': ' + type(error).__name__, file=sys.stderr)
        sys.exit(1)
