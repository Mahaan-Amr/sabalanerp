"""Inspect the accepted SourceA Inquiry filesystem offline; never import/run an image."""
import hashlib
import json
from pathlib import Path
import tarfile

evidence = Path(__file__).resolve().parent
output = evidence / 'INQUIRY-CARRIER-ARTIFACT.json'
assert not output.exists()
component_file = Path('D:/sabalanerp-online-qa/C30-source-a-image-component-45d688378778428f8e5b823f83ce7e2b/component.json')
component_raw = component_file.read_bytes()
sha = lambda raw: hashlib.sha256(raw).hexdigest()
assert sha(component_raw) == '64eea77f6820ab385c4fca9122a9ceb669ae45bac37226922574b335da1ffa7f'
component = json.loads(component_raw)
reference = component['rawArchive']
archive = Path(reference['file'])
h = hashlib.sha256()
with archive.open('rb') as stream:
    while chunk := stream.read(1024 * 1024):
        h.update(chunk)
assert h.hexdigest() == reference['sha256'] and archive.stat().st_size == reference['bytes']
targets = {
    'usr/bin/python3', 'usr/bin/python3.11',
    'app/online-runtime/entry.cjs', 'app/online-runtime/manifest.json',
    'app/online-runtime/scripts/online-inquiry-owner.py',
    'app/online-runtime/scripts/online-runtime-scope.py',
    'app/run-inquiry-with-recovery.sh', 'app/.next/BUILD_ID',
    'app/inquiry-compiled-browser.cjs', 'app/node_modules/next/dist/bin/next',
    'app/.next/server/server-reference-manifest.json',
}
files = {}
with tarfile.open(archive) as outer:
    def blob(digest):
        name = 'blobs/sha256/' + digest.removeprefix('sha256:')
        member = outer.getmember(name)
        raw = outer.extractfile(member).read()
        assert 'sha256:' + sha(raw) == digest
        return raw

    index = json.loads(blob(component['archiveGraph']['index']))
    platform = component['archiveGraph']['platform']
    assert any(row['digest'] == platform for row in index['manifests'])
    manifest = json.loads(blob(platform))
    assert manifest['config']['digest'] == component['archiveGraph']['config']
    config_raw = blob(manifest['config']['digest'])
    config = json.loads(config_raw)
    assert config['rootfs']['diff_ids'] == component['archiveGraph']['rootfsDiffIds']
    layers = []
    for layer in manifest['layers']:
        name = 'blobs/sha256/' + layer['digest'].removeprefix('sha256:')
        member = outer.getmember(name)
        assert member.size == layer['size']
        # Authenticate the complete compressed blob before parsing its stream.
        with outer.extractfile(member) as incoming:
            digest = hashlib.sha256()
            while chunk := incoming.read(1024 * 1024):
                digest.update(chunk)
        assert 'sha256:' + digest.hexdigest() == layer['digest']
        with outer.extractfile(member) as incoming, tarfile.open(fileobj=incoming, mode='r|*') as inner:
            for entry in inner:
                name = entry.name.removeprefix('./').removeprefix('/')
                path = Path(name)
                if path.name == '.wh..wh..opq':
                    prefix = path.parent.as_posix() + '/'
                    files = {key: value for key, value in files.items() if not key.startswith(prefix)}
                elif path.name.startswith('.wh.'):
                    removed = path.with_name(path.name[4:]).as_posix()
                    files = {key: value for key, value in files.items() if key != removed and not key.startswith(removed + '/')}
                elif name in targets:
                    value = {'bytes': entry.size, 'mode': entry.mode, 'uid': entry.uid, 'gid': entry.gid,
                             'type': entry.type.decode('ascii'), 'layer': layer['digest']}
                    if entry.isfile():
                        raw = inner.extractfile(entry).read()
                        value['sha256'] = sha(raw)
                        if name == 'app/.next/BUILD_ID':
                            value['nativeBuildId'] = raw.decode().strip()
                    elif entry.issym() or entry.islnk():
                        value['linkname'] = entry.linkname
                    files[name] = value
        layers.append({'digest': layer['digest'], 'bytes': layer['size']})

result = {
    'format': 'sabalan-419-offline-inquiry-carrier-artifact/v1',
    'component': {'file': str(component_file), 'sha256': sha(component_raw)},
    'rawArchive': reference, 'graph': component['archiveGraph'], 'layersVerified': layers,
    'configSha256': sha(config_raw), 'files': files,
    'sourceLabels': {key: value for key, value in config['config'].get('Labels', {}).items()
                     if key.startswith(('io.sabalan.', 'org.opencontainers.image.revision'))},
    'entrypoint': config['config'].get('Entrypoint'), 'command': config['config'].get('Cmd'),
    'missing': sorted(targets - set(files)), 'imageImported': False, 'imageStarted': False,
    'runtimeAccepted': False, 'productionAdmission': False,
}
with output.open('x', encoding='utf-8') as stream:
    json.dump(result, stream, indent=2)
    stream.write('\n')
print(json.dumps({'file': str(output), 'missing': result['missing'], 'layersVerified': len(layers)}))
