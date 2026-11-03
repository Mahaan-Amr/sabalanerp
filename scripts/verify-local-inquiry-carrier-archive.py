"""Verify local carrier OCI bytes, exact overlay and startup dependency closure."""
import gzip
import hashlib
import io
import json
from pathlib import PurePosixPath
import posixpath
import struct
import sys
import tarfile


def require(value, code):
    if not value:
        raise RuntimeError(code)


def verify(archive, index_digest, recipe):
    files, directories = {}, {}
    with tarfile.open(archive) as outer:
        def blob(digest):
            raw = outer.extractfile('blobs/sha256/' + digest.split(':')[1]).read()
            require('sha256:' + hashlib.sha256(raw).hexdigest() == digest, 'OCI_BLOB_CHANGED')
            return raw
        index = json.loads(blob(index_digest))
        platforms = [r for r in index['manifests'] if r.get('platform') == {'architecture': 'amd64', 'os': 'linux'}]
        require(len(platforms) == 1, 'OCI_PLATFORM_AMBIGUOUS')
        manifest = json.loads(blob(platforms[0]['digest']))
        config = json.loads(blob(manifest['config']['digest']))
        require(config['rootfs']['diff_ids'][:len(recipe['baseDiffIds'])] == recipe['baseDiffIds'], 'BASE_PREFIX_CHANGED')
        require(len(config['rootfs']['diff_ids']) == len(manifest['layers']), 'LAYER_COUNT_CHANGED')
        deltas = {}
        for number, layer in enumerate(manifest['layers']):
            raw = blob(layer['digest'])
            digest = hashlib.sha256()
            expanded = gzip.GzipFile(fileobj=io.BytesIO(raw)) if raw[:2] == b'\x1f\x8b' else io.BytesIO(raw)
            with expanded:
                while part := expanded.read(1024 * 1024):
                    digest.update(part)
            require('sha256:' + digest.hexdigest() == config['rootfs']['diff_ids'][number], 'DIFF_ID_CHANGED')
            added = number >= len(recipe['baseDiffIds'])
            with tarfile.open(fileobj=io.BytesIO(raw), mode='r|*') as inner:
                for member in inner:
                    name = member.name.removeprefix('./').rstrip('/')
                    require(name and not name.startswith('/') and '..' not in PurePosixPath(name).parts, 'LAYER_PATH_UNSAFE')
                    if PurePosixPath(name).name.startswith('.wh.'):
                        require(not added, 'OVERLAY_WHITEOUT_REFUSED')
                        if PurePosixPath(name).name == '.wh..wh..opq':
                            prefix = str(PurePosixPath(name).parent).rstrip('/') + '/'
                            files = {k: v for k, v in files.items() if not k.startswith(prefix)}
                        else:
                            target = str(PurePosixPath(name).with_name(PurePosixPath(name).name[4:]))
                            files = {k: v for k, v in files.items() if k != target and not k.startswith(target + '/')}
                        continue
                    if member.isdir():
                        metadata = dict(mode=member.mode, uid=member.uid, gid=member.gid)
                        if added:
                            parents = {str(parent) for file in recipe['files'] for parent in PurePosixPath(file).parents}
                            require(name in parents and name in directories, 'UNDECLARED_OVERLAY_DIRECTORY')
                            require(metadata == directories[name], 'OVERLAY_DIRECTORY_METADATA_CHANGED')
                        directories[name] = metadata
                        continue
                    require(member.isfile() or member.issym() or member.islnk(), 'LAYER_ENTRY_UNSUPPORTED')
                    value = dict(mode=member.mode, uid=member.uid, gid=member.gid,
                                 kind='file' if member.isfile() else 'symlink' if member.issym() else 'hardlink')
                    if member.isfile():
                        stream = inner.extractfile(member)
                        prefix = stream.read(4)
                        digest = hashlib.sha256(prefix)
                        retain = prefix == b'\x7fELF' and name.startswith(('usr/bin/', 'usr/local/bin/', 'usr/lib/', 'lib/'))
                        parts = [prefix] if retain else []
                        while part := stream.read(1024 * 1024):
                            digest.update(part)
                            if retain:
                                parts.append(part)
                        value.update(sha256=digest.hexdigest(), bytes=member.size)
                        if retain:
                            value['body'] = b''.join(parts)
                    else:
                        value['target'] = member.linkname
                    files[name] = value
                    if added:
                        require(name in recipe['files'] and name not in deltas and member.isfile(), 'UNDECLARED_OVERLAY_FILE')
                        expected = recipe['files'][name]
                        require(member.uid == 0 and member.gid == 0, 'OVERLAY_FILE_OWNER_CHANGED')
                        require(value['sha256'] == expected['sha256'] and value['mode'] == expected['mode'], 'OVERLAY_BYTES_CHANGED')
                        deltas[name] = {k: value[k] for k in ('sha256', 'bytes', 'mode', 'uid', 'gid')}
        require(set(deltas) == set(recipe['files']), 'STARTUP_FILE_MISSING')
        runtime = config['config']
        require(runtime['Cmd'] == ['node', '/app/local-inquiry-preservation-carrier.cjs'], 'STARTUP_COMMAND_CHANGED')
        require(runtime['Healthcheck'] == recipe['healthcheck'], 'HEALTH_CONTRACT_CHANGED')
        base_config = recipe['baseConfig']
        ignored = {'Cmd', 'Healthcheck', 'Labels'}
        require({k: v for k, v in runtime.items() if k not in ignored} == {k: v for k, v in base_config.items() if k not in ignored}, 'INHERITED_CONFIG_CHANGED')
        require(runtime['Labels'] == {**base_config.get('Labels', {}), 'io.sabalan.carrier.role': 'local-preservation-only'}, 'SOURCE_LABEL_CHANGED')

        def resolve(name, seen=None):
            name = posixpath.normpath(name.lstrip('/'))
            seen = set() if seen is None else seen
            require(name not in seen, 'STARTUP_DEPENDENCY_CYCLE')
            seen.add(name)
            if name not in files:
                ancestors = list(PurePosixPath(name).parents)[:-1]
                for ancestor in reversed(ancestors):
                    link = files.get(str(ancestor))
                    if link and link['kind'] == 'symlink':
                        target = link['target']
                        if not target.startswith('/'):
                            target = posixpath.join(str(ancestor.parent), target)
                        return resolve(posixpath.join(target, posixpath.relpath(name, str(ancestor))), seen)
                raise RuntimeError('STARTUP_DEPENDENCY_MISSING')
            row = files[name]
            if row['kind'] == 'file':
                return name, row
            target = row['target']
            if row['kind'] == 'symlink' and not target.startswith('/'):
                target = posixpath.join(posixpath.dirname(name), target)
            return resolve(target, seen)

        checked = {}
        def elf(name):
            resolved, row = resolve(name)
            if resolved in checked:
                return
            raw = row.get('body', b'')
            require(raw[:6] == b'\x7fELF\x02\x01', 'STARTUP_ELF_UNPROVEN')
            phoff = struct.unpack_from('<Q', raw, 32)[0]
            phsize, phcount = struct.unpack_from('<HH', raw, 54)
            headers = [struct.unpack_from('<IIQQQQQQ', raw, phoff + i * phsize) for i in range(phcount)]
            dynamic = [h for h in headers if h[0] == 2]
            require(len(dynamic) == 1, 'STARTUP_ELF_DYNAMIC_UNPROVEN')
            tags = []
            for offset in range(dynamic[0][2], dynamic[0][2] + dynamic[0][5], 16):
                tag, value = struct.unpack_from('<qQ', raw, offset)
                if tag == 0:
                    break
                tags.append((tag, value))
            strings_address = next(v for t, v in tags if t == 5)
            segment = next(h for h in headers if h[0] == 1 and h[3] <= strings_address < h[3] + h[5])
            string_offset = segment[2] + strings_address - segment[3]
            read = lambda offset: raw[string_offset + offset:].split(b'\x00', 1)[0].decode()
            dependencies = [read(v) for t, v in tags if t == 1]
            checked[resolved] = dict(sha256=row['sha256'], needed=dependencies)
            for header in headers:
                if header[0] == 3:
                    interpreter = raw[header[2]:header[2] + header[5]].rstrip(b'\x00').decode()
                    resolved_interpreter, interpreter_row = resolve(interpreter)
                    require(interpreter_row.get('body', b'')[:4] == b'\x7fELF', 'ELF_INTERPRETER_MISSING')
                    checked[resolved_interpreter] = dict(sha256=interpreter_row['sha256'], needed=[])
            search = ['/lib/x86_64-linux-gnu', '/usr/lib/x86_64-linux-gnu', '/lib', '/usr/lib', '/usr/local/lib']
            for dependency in dependencies:
                matches = [posixpath.join(p, dependency) for p in search if posixpath.join(p, dependency).lstrip('/') in files]
                require(bool(matches), 'ELF_LIBRARY_MISSING')
                elf(matches[0])

        for executable in ['/usr/local/bin/node', '/usr/bin/python3', '/usr/bin/sqlite3']:
            elf(executable)
        for name in ['usr/lib/python3.11/encodings/__init__.py', 'usr/lib/python3.11/sqlite3/__init__.py',
                     'app/node_modules/next/dist/bin/next', 'app/online-runtime/entry.cjs']:
            resolve(name)
        extensions = [n for n in files if n.startswith('usr/lib/python3.11/lib-dynload/_sqlite3.') and n.endswith('.so')]
        require(len(extensions) == 1, 'PYTHON_SQLITE_EXTENSION_MISSING')
        elf(extensions[0])
        return dict(format='sabalan-local-inquiry-carrier-archive-proof/v1', pass_=True,
                    index=index_digest, platform=platforms[0]['digest'], config=manifest['config']['digest'],
                    completeBasePrefixLayers=len(recipe['baseDiffIds']), exactHelperDeltas=deltas,
                    startupElfClosure=checked, compiledApplicationRebuilt=False,
                    maintenanceOnly=True, applicationReady=False, runtimeAccepted=False, productionAdmission=False)


if __name__ == '__main__':
    with open(sys.argv[3], 'rb') as stream:
        recipe = json.load(stream)
    print(json.dumps(verify(sys.argv[1], sys.argv[2], recipe)))
