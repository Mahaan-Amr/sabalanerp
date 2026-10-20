"""Original one-role importer; retained SAME handles until explicit retirement.

Only fixed canonical codec and graph materializer are used. No production keys,
tags, unverified first-decrypt streaming, or report-file ownership adoption.
"""
import hashlib, importlib.util, json, os, pathlib, stat, subprocess, sys, threading, time

MIB = 1024 ** 2

def require(value, code):
    if not value: raise RuntimeError(code)

def identity(value):
    return tuple(getattr(value, key) for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_uid', 'st_mode', 'st_nlink'])

def digest(file, private=True):
    file = pathlib.Path(file)
    require(file.resolve() == file, 'IMAGE_PATH_ALIAS')
    before = file.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1 and
            (stat.S_IMODE(before.st_mode) == 0o400 if private else not before.st_mode & 0o022), 'IMAGE_PRIVATE_FILE')
    h = hashlib.sha256()
    with file.open('rb') as stream:
        require(identity(os.fstat(stream.fileno())) == identity(before), 'IMAGE_OPEN_IDENTITY')
        for raw in iter(lambda: stream.read(MIB), b''): h.update(raw)
        require(identity(os.fstat(stream.fileno())) == identity(before), 'IMAGE_FILE_MUTATED')
    require(identity(file.lstat()) == identity(before), 'IMAGE_NAMED_MUTATED')
    return h.hexdigest()

def import_budget(measured, installed_layers, archive_bytes, retained_reserve):
    """Shared layers count only when the complete ordered prefix matches."""
    layers = [row['diffId'] for row in measured['layers']]
    prefix = max([0] + [next((i for i, pair in enumerate(zip(layers, row)) if pair[0] != pair[1]), min(len(layers), len(row))) for row in installed_layers])
    missing = sum(row['expandedBytes'] for row in measured['layers'][prefix:])
    # Docker load may spool the complete source-encoded classic stream before
    # extraction. Reserve it separately, even though our plaintext is tmpfs.
    spool = archive_bytes + (len(layers) + 8) * 10240
    # The archive spool retires before any restore/app stage. The new layers
    # remain. Count the maximum of those two actual lifetimes, not their sum.
    return {'sharedPrefixLayers': prefix, 'missingExpandedBytes': missing,
            'sourceEncodedSpoolBytes': spool, 'subsequentStageReserveBytes': retained_reserve,
            'requiredDiskBytes': missing + max(retained_reserve, spool + 128 * MIB)}

def main():
    require(sys.platform == 'linux' and os.getuid() == 0 and len(sys.argv) == 3, 'IMAGE_STAGE_HOST')
    os.umask(0o077)
    file = pathlib.Path(sys.argv[1]); require(digest(file) == sys.argv[2], 'IMAGE_STAGE_INPUT_SHA')
    cfg = json.loads(file.read_bytes()); require(cfg['format'] == 'sabalan-original-independent-image-stage-input/v1', 'IMAGE_STAGE_FORMAT')
    role, graph = cfg['role'], cfg['archiveGraph']; require(role in ['backend', 'frontend', 'inquiry'], 'IMAGE_STAGE_ROLE')
    own_root = pathlib.Path(cfg['temporaryRoot'])
    require(str(own_root) == '/dev/shm/sabalan-independent-image-' + cfg['operation'] + '-' + role and not own_root.exists(), 'IMAGE_STAGE_ROOT')
    require(digest(cfg['nodeExecutable'], private=False) == cfg['nodeExecutableSha256'], 'IMAGE_STAGE_NODE_SHA')
    require(digest(cfg['decryptWorkerPath']) == cfg['decryptWorkerSha256'], 'IMAGE_DECRYPT_WORKER_SHA')
    require(digest(cfg['materializerPath']) == cfg['materializerSha256'], 'IMAGE_MATERIALIZER_SHA')
    children, failures = [], []
    def emit(event, **values):
        print(json.dumps(dict(event=event, role=role, **values), separators=(',', ':')), flush=True)
    def start(args, *, sink=None, limit=16 * MIB, piped_input=False):
        child = subprocess.Popen(args, stdin=subprocess.PIPE if piped_input else subprocess.DEVNULL,
                                 stdout=sink if sink is not None else subprocess.PIPE, stderr=subprocess.PIPE)
        row = {'child': child, 'stdout': bytearray(), 'stderr': bytearray(), 'threads': []}; children.append(row)
        def pump(stream, name):
            try:
                for raw in iter(lambda: stream.read(65536), b''):
                    require(len(row[name]) + len(raw) <= limit, 'IMAGE_STAGE_OUTPUT_BOUND')
                    row[name].extend(raw)
            except Exception as error: failures.append(str(error))
        for name in ['stdout', 'stderr']:
            stream = getattr(child, name)
            if stream is not None:
                thread = threading.Thread(target=pump, args=(stream, name), daemon=True); row['threads'].append(thread); thread.start()
        return row
    def finish(row):
        code = row['child'].wait(timeout=900)
        for thread in row['threads']: thread.join(timeout=30); require(not thread.is_alive(), 'IMAGE_STAGE_PIPE_UNKNOWN')
        require(not failures and code == 0, 'IMAGE_STAGE_ORIGINAL_CHILD_NONZERO')
        return bytes(row['stdout'])
    def command(args): return finish(start(args))
    def containers():
        ids = command(['/usr/bin/docker', 'ps', '--all', '--no-trunc', '--quiet']).decode().split()
        return json.loads(command(['/usr/bin/docker', 'inspect', *ids])) if ids else []
    def exact_image():
        result = json.loads(command(['/usr/bin/docker', 'image', 'inspect', graph['config']]))
        require(len(result) == 1 and result[0]['Id'] == graph['config'] and result[0]['RootFS']['Layers'] == graph['rootfsDiffIds'], 'IMAGE_INSTALLED_GRAPH')
        return result[0]
    mutated = False
    try:
        # Inspect IDs rather than treat arbitrary inspect errors as "missing".
        image_ids = set(command(['/usr/bin/docker', 'image', 'ls', '--all', '--quiet', '--no-trunc']).decode().split())
        imported = graph['config'] not in image_ids
        if imported or cfg.get('verifyRetainedSourceBeforeReuse') is True:
            available = int(next(line.split()[1] for line in pathlib.Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:'))) * 1024
            required_memory = graph['archiveBytes'] + (384 + 192 + 512 + 128) * MIB
            require(available >= required_memory, 'IMAGE_STAGE_MEMORY_BUDGET')
            own_root.mkdir(mode=0o700); mutated = True
            decrypted = json.loads(finish(start([cfg['nodeExecutable'], '--max-old-space-size=192', cfg['decryptWorkerPath'], str(file), sys.argv[2]])))
            require(decrypted['fullGcmAuthenticated'] is True and decrypted['plaintextSha256'] == graph['archiveSha256'] and decrypted['plaintextBytes'] == graph['archiveBytes'], 'IMAGE_AUTHENTICATED_PLAINTEXT')
            plain = pathlib.Path(decrypted['plaintextPath']); require(plain.parent == own_root and digest(plain) == graph['archiveSha256'], 'IMAGE_PLAINTEXT_SHA')
            spec = importlib.util.spec_from_file_location('original_fixed_materializer', cfg['materializerPath']); materializer = importlib.util.module_from_spec(spec); spec.loader.exec_module(materializer)
            measured = materializer.measure(plain, graph['archiveSha256'], graph['index'], graph['platform'], graph['config'])
            require([row['diffId'] for row in measured['layers']] == graph['rootfsDiffIds'] and measured['expandedLayerIdentityVerified'] is True, 'IMAGE_EXPANDED_GRAPH')
            if imported:
                installed = json.loads(command(['/usr/bin/docker', 'image', 'inspect', *sorted(image_ids)])) if image_ids else []
                budget = import_budget(measured, [v.get('RootFS', {}).get('Layers', []) for v in installed], graph['archiveBytes'], cfg['retainedDiskReserveBytes'])
                capacity = os.statvfs(cfg['diskRoot']); require(capacity.f_bavail * capacity.f_frsize >= budget['requiredDiskBytes'], 'IMAGE_STAGE_DISK_BUDGET')
                loader = start(['/usr/bin/docker', 'image', 'load'], piped_input=True)
                # Same ORIGINAL producer owns the actual output pipe and waits for
                # its original Docker loader; no external shell or process adoption.
                material = materializer.materialize_to_stream(plain, loader['child'].stdin, graph['archiveSha256'], graph['index'], graph['platform'], graph['config'], preserve_source_encoding=True)
                loader['child'].stdin.close(); finish(loader)
                require(material['rootfsDiffIds'] == graph['rootfsDiffIds'], 'IMAGE_IMPORT_GRAPH')
                exact_image()
            else:exact_image();budget=None
            require(digest(plain) == graph['archiveSha256'], 'IMAGE_POSTIMPORT_SOURCE_SHA'); plain.unlink(); own_root.rmdir()
        else:
            exact_image(); budget = None; decrypted = None; measured = None
        emit('READY', image=graph['config'], sourceImage=graph['index'], importedByOriginalController=imported, budget=budget,
             decryption=decrypted, expandedMeasurement=measured, originalChildren=[{'pid':v['child'].pid,'returncode':v['child'].returncode} for v in children])
        require(sys.stdin.readline() == 'RETIRE\n', 'IMAGE_RETIRE_ORIGINAL_COMMAND')
        if imported: require(all(v['Image'] != graph['config'] for v in containers()), 'IMAGE_STILL_REFERENCED')
        exact_image()
        # Encrypted independent source remains exact/retrievable before eviction.
        metadata = json.loads(pathlib.Path(cfg['metadataPath']).read_bytes())
        require(digest(cfg['metadataPath']) == cfg['metadataSha256'], 'IMAGE_RETIRE_METADATA_SHA')
        require(digest(cfg['cipherPath']) == metadata['encryption']['images'][role]['cipherSha256'], 'IMAGE_RETIRE_CIPHER_SHA')
        if imported: command(['/usr/bin/docker', 'image', 'rm', graph['config']])
        require(all(v['child'].returncode == 0 for v in children), 'IMAGE_STAGE_ORIGINAL_CLOSURE')
        emit('CLOSED', image=graph['config'], removedOwnImportedImage=imported, encryptedSourcePreserved=True,
             originalChildren=[{'pid':v['child'].pid,'returncode':v['child'].returncode} for v in children], productionAdmission=False)
    except BaseException:
        if mutated or children:
            try: emit('HELD', code='ORIGINAL_IMAGE_STAGE_FAILED_OR_UNKNOWN', productionAdmission=False)
            except BaseException: pass  # Broken original pipe is UNKNOWN, not permission to abandon custody.
            while True: time.sleep(30)
        raise

if __name__ == '__main__': main()
