"""Read-only immutable archive observation; no container creation or extraction."""
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys
import tarfile

sys.dont_write_bytecode = True


def browser_from_layers(archive, graph, role):
    if role == 'backend':
        return None
    files = {}
    with tarfile.open(archive, 'r:') as outer:
        manifest = json.load(outer.extractfile('blobs/sha256/' + graph['platform'][7:]))
        prefix = 'app/.next-build/' if role == 'frontend' else 'app/.next/'
        wanted = {prefix + 'BUILD_ID', prefix + ('browser-build-identity.json' if role == 'frontend' else 'required-server-files.json')}
        for layer in manifest['layers']:
            raw = outer.extractfile('blobs/sha256/' + layer['digest'][7:])
            mode = 'r|gz' if layer['mediaType'].endswith('+gzip') else 'r|'
            with tarfile.open(fileobj=raw, mode=mode) as expanded:
                for entry in expanded:
                    name = entry.name.removeprefix('./')
                    # Refuse ambiguous link/whiteout ancestry for identity files.
                    if any(target == name or target.startswith(name + '/') for target in wanted):
                        if name in wanted:
                            assert entry.isfile() and entry.size <= 1024 * 1024, 'BROWSER_IDENTITY_NOT_REGULAR'
                            files[name] = expanded.extractfile(entry).read()
                        else:
                            assert entry.isdir(), 'BROWSER_IDENTITY_LINK_ANCESTOR'
                    if '/.wh.' in name:
                        directory, whiteout = name.rsplit('/', 1)
                        target = directory + '/' + whiteout[4:]
                        for selected in list(files):
                            if (whiteout == '.wh..wh..opq' and selected.startswith(directory + '/')) or selected == target or selected.startswith(target + '/'):
                                del files[selected]
    assert set(files) == wanted, 'COMPILED_BROWSER_FILES_REQUIRED'
    native = files[prefix + 'BUILD_ID'].decode().strip()
    assert re.fullmatch(r'[A-Za-z0-9_-]{1,128}', native)
    if role == 'frontend':
        identity = json.loads(files[prefix + 'browser-build-identity.json'])
        assert identity['format'] == 'sabalan-browser-build/v1'
        build_id = identity['browserBuildId']
        assert build_id == identity['nativeBuildId'] == native
    else:
        config = json.loads(files[prefix + 'required-server-files.json'])['config']
        build_id = config.get('deploymentId')
        if build_id:
            assert config.get('env', {}).get('NEXT_PUBLIC_INQUIRY_BUILD_ID') == build_id
        else:
            assert not config.get('env', {}).get('NEXT_PUBLIC_INQUIRY_BUILD_ID')
            # Same native fallback as inquiry-compiled-browser.cjs. Native
            # Next builds without a deploymentId remain exact image content.
            build_id = 'inquiry_legacy_' + hashlib.sha256(native.encode()).hexdigest()
    # This is a narrow native-identity manifest, not a fabricated online browser receipt.
    manifest = [{'path': name, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in sorted(files.items())]
    return {'id': build_id, 'nativeBuildId': native, 'manifestSha256': hashlib.sha256(json.dumps(manifest, separators=(',', ':')).encode()).hexdigest()}


def observe(archive, image, role):
    root = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location('maintenance_oci_proof', root / 'scripts/qa/export-current-production-images-439.py')
    exporter = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = exporter
    spec.loader.exec_module(exporter)
    before = Path(archive).stat()
    graph = exporter.oci_proof(Path(archive), image, allow_config_identity=True)
    graph.pop('blobs', None)
    browser = browser_from_layers(archive, graph, role)
    after = Path(archive).stat()
    assert (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) == (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'ARCHIVE_CHANGED'
    assert exporter.full_hash(Path(archive)) == graph['archiveSha256'], 'ARCHIVE_CHANGED'
    return {'graph': graph, 'browser': browser}


if __name__ == '__main__':
    assert len(sys.argv) == 4 and sys.argv[3] in ('backend', 'frontend', 'inquiry')
    print(json.dumps(observe(*sys.argv[1:])))
