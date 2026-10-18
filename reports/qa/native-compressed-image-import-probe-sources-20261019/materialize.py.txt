"""Read one immutable image from a retained multi-image archive into fresh staging.

No Docker command, tag assignment, release admission, retention or deletion.
Compressed blobs and uncompressed diff IDs are independently verified. The
resulting classic archive has no tags and preserves the exact config identity.
Interrupted output is retained; callers own their native/storage/host boundary.
"""
import argparse
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import tarfile


def require(value, code):
    if not value:
        raise RuntimeError(code)


def sha(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            value.update(chunk)
    return value.hexdigest()


def sync(directory):
    if os.name == 'nt':
        return  # Windows unit fixtures never certify Linux persistence.
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def immutable_id(value):
    require(isinstance(value, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', value), 'IMAGE_ID_INVALID')
    return 'blobs/sha256/' + value[7:]


def scan(archive):
    seen = set()
    expanded = 0
    with tarfile.open(archive, 'r|gz') as stream:
        for member in stream:
            name = member.name.rstrip('/') if member.isdir() else member.name
            require(name and not name.startswith('/') and '\\' not in name
                    and all(p not in ['', '.', '..'] for p in name.split('/'))
                    and name not in seen and (member.isfile() or member.isdir()), 'IMAGE_ARCHIVE_MEMBER_UNSAFE')
            seen.add(name)
            expanded += member.size
            require(len(seen) <= 50000 and expanded <= 32 * 1024 ** 3, 'IMAGE_ARCHIVE_TOO_LARGE')
            yield member, stream


def read_plan(archive, archive_sha, index_id, platform_id, config_id,
              maximum_layer_bytes=1024 ** 3, maximum_image_bytes=2 * 1024 ** 3):
    archive = Path(archive)
    require(re.fullmatch(r'[a-f0-9]{64}', archive_sha), 'IMAGE_ARCHIVE_HASH_INVALID')
    names = {value: immutable_id(value) for value in [index_id, platform_id, config_id]}
    require(archive.is_absolute() and archive.resolve(strict=True) == archive, 'IMAGE_ARCHIVE_ALIAS')
    before = archive.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 1024 <= before.st_size <= 8 * 1024 ** 3,
            'IMAGE_ARCHIVE_UNSAFE')
    require(sha(archive) == archive_sha, 'IMAGE_ARCHIVE_CHANGED')
    metadata = {}
    for member, stream in scan(archive):
        if member.name in names.values():
            require(member.isfile() and 0 < member.size <= 8 * 1024 ** 2, 'IMAGE_METADATA_UNSAFE')
            data = stream.extractfile(member).read(member.size + 1)
            require(len(data) == member.size and hashlib.sha256(data).hexdigest() == member.name[13:], 'IMAGE_METADATA_HASH_INVALID')
            metadata[member.name] = data
    require(set(metadata) == set(names.values()), 'IMAGE_METADATA_MISSING')
    index, platform, config = [json.loads(metadata[names[value]]) for value in [index_id, platform_id, config_id]]
    require(index.get('schemaVersion') == 2 and platform.get('schemaVersion') == 2, 'IMAGE_GRAPH_INVALID')
    matches = [p for p in index['manifests'] if p.get('platform', {}).get('os') == 'linux'
               and p.get('platform', {}).get('architecture') == 'amd64']
    require(len(matches) == 1 and matches[0]['digest'] == platform_id
            and matches[0]['size'] == len(metadata[names[platform_id]])
            and platform['config']['digest'] == config_id
            and platform['config']['size'] == len(metadata[names[config_id]]), 'IMAGE_GRAPH_IDENTITY_MISMATCH')
    layers, diff_ids = platform['layers'], config['rootfs']['diff_ids']
    require(config.get('os') == 'linux' and config.get('architecture') == 'amd64'
            and config['rootfs']['type'] == 'layers' and 0 < len(layers) == len(diff_ids) <= 256, 'IMAGE_CONFIG_INVALID')
    wanted = {}
    for layer in layers:
        name = immutable_id(layer['digest'])
        require(type(layer['size']) is int and 0 < layer['size'] <= maximum_layer_bytes, 'IMAGE_LAYER_TOO_LARGE')
        require(layer['mediaType'] in ['application/vnd.oci.image.layer.v1.tar+gzip',
                'application/vnd.docker.image.rootfs.diff.tar.gzip', 'application/vnd.oci.image.layer.v1.tar',
                'application/vnd.docker.image.rootfs.diff.tar'], 'IMAGE_LAYER_ENCODING_UNSUPPORTED')
        if name in wanted:
            require(wanted[name] == layer, 'IMAGE_LAYER_DESCRIPTOR_CONFLICT')
        wanted[name] = layer
    require(sum(row['size'] for row in wanted.values()) <= maximum_image_bytes, 'IMAGE_SELECTED_BYTES_TOO_LARGE')
    return archive, before, metadata, names, layers, diff_ids, wanted


def materialize(archive, destination, archive_sha, index_id, platform_id, config_id,
                maximum_layer_bytes=1024 ** 3, maximum_image_bytes=2 * 1024 ** 3):
    archive, before, metadata, names, layers, diff_ids, wanted = read_plan(
        archive, archive_sha, index_id, platform_id, config_id,
        maximum_layer_bytes, maximum_image_bytes)
    destination = Path(destination)
    require(destination.is_absolute() and destination.parent.resolve(strict=True) == destination.parent,
            'IMAGE_DESTINATION_ALIAS')
    destination.mkdir(mode=0o700)  # Never reuse partial or foreign work.
    blobs = destination / 'blobs'
    blobs.mkdir(mode=0o700)
    copied = set()
    for member, stream in scan(archive):
        if member.name not in wanted:
            continue
        expected = wanted[member.name]
        require(member.isfile() and member.size == expected['size'], 'IMAGE_LAYER_SIZE_MISMATCH')
        value = hashlib.sha256()
        count = 0
        with stream.extractfile(member) as source, (blobs / expected['digest'][7:]).open('xb') as output:
            os.chmod(output.name, 0o600)
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                require(count <= expected['size'], 'IMAGE_LAYER_SIZE_MISMATCH')
                value.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
        require(count == expected['size'] and value.hexdigest() == expected['digest'][7:], 'IMAGE_LAYER_HASH_INVALID')
        copied.add(member.name)
    require(copied == set(wanted), 'IMAGE_LAYER_MISSING')
    expanded = 0
    paths = []
    for number, (layer, diff_id) in enumerate(zip(layers, diff_ids)):
        immutable_id(diff_id)
        target = destination / ('layer-' + str(number).zfill(4) + '.tar')
        value = hashlib.sha256()
        count = 0
        blob = blobs / layer['digest'][7:]
        with blob.open('rb') as source, target.open('xb') as output:
            os.chmod(target, 0o600)
            reader = gzip.GzipFile(fileobj=source) if layer['mediaType'].endswith(('+gzip', '.gzip')) else source
            try:
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    expanded += len(chunk)
                    require(count <= maximum_layer_bytes and expanded <= maximum_image_bytes, 'IMAGE_EXPANSION_LIMIT')
                    value.update(chunk)
                    output.write(chunk)
            finally:
                if reader is not source:
                    reader.close()
            output.flush()
            os.fsync(output.fileno())
        require(value.hexdigest() == diff_id[7:], 'IMAGE_DIFF_ID_MISMATCH')
        paths.append(target)
    classic = destination / 'image.tar'
    with classic.open('xb') as raw:
        os.chmod(classic, 0o600)
        with tarfile.open(fileobj=raw, mode='w', format=tarfile.USTAR_FORMAT) as output:
            def add(name, data):
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(data), 0o600
                output.addfile(info, io.BytesIO(data))
            config_name = config_id[7:] + '.json'
            add(config_name, metadata[names[config_id]])
            for file in paths:
                info = tarfile.TarInfo(file.name)
                info.size, info.mode = file.stat().st_size, 0o600
                with file.open('rb') as source:
                    output.addfile(info, source)
            add('manifest.json', json.dumps([{'Config': config_name, 'RepoTags': None,
                'Layers': [p.name for p in paths]}], separators=(',', ':')).encode())
        raw.flush()
        os.fsync(raw.fileno())
    after = archive.lstat()
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    require(identity(before) == identity(after), 'IMAGE_SOURCE_MUTATED')
    result = {'format': 'sabalan-private-image-materialization/v1', 'sourceArchiveSha256': archive_sha,
              'sourceIndex': index_id, 'platformManifest': platform_id, 'configImageId': config_id,
              'rootfsDiffIds': diff_ids, 'selectedBlobCount': len(wanted), 'expandedLayerBytes': expanded,
              'archiveSha256': sha(classic), 'archiveBytes': classic.stat().st_size,
              'tagAssignments': [], 'healthyApplicationPoint': False, 'publicOnlineAdmission': False}
    with (destination / 'private-image-proof.json').open('x') as output:
        os.chmod(output.name, 0o600)
        json.dump(result, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    for directory in [blobs, destination, destination.parent]:
        sync(directory)
    return result


class CountedReader:
    def __init__(self, source):
        self.source, self.count, self.digest = source, 0, hashlib.sha256()

    def read(self, size=-1):
        # gzip requests bounded chunks. Refuse accidental unbounded reads.
        require(0 <= size <= 8 * 1024 ** 2, 'IMAGE_MEASUREMENT_READ_UNBOUNDED')
        chunk = self.source.read(size)
        self.count += len(chunk)
        self.digest.update(chunk)
        return chunk



def measure(archive, archive_sha, index_id, platform_id, config_id,
            maximum_layer_bytes=1024 ** 3, maximum_image_bytes=2 * 1024 ** 3):
    """Verify expanded identities and measure staging needs without writing files."""
    archive, before, metadata, names, layers, diff_ids, wanted = read_plan(
        archive, archive_sha, index_id, platform_id, config_id,
        maximum_layer_bytes, maximum_image_bytes)
    observations = {}
    multiplicity = {}
    for layer in layers:
        key = immutable_id(layer['digest'])
        multiplicity[key] = multiplicity.get(key, 0) + 1
    logical_expanded = 0

    for member, stream in scan(archive):
        if member.name not in wanted:
            continue
        expected = wanted[member.name]
        require(member.isfile() and member.size == expected['size'], 'IMAGE_LAYER_SIZE_MISMATCH')
        value, count = hashlib.sha256(), 0
        with stream.extractfile(member) as source:
            counted = CountedReader(source)
            reader = gzip.GzipFile(fileobj=counted) if expected['mediaType'].endswith(('+gzip', '.gzip')) else counted
            try:
                while chunk := reader.read(1024 * 1024):
                    count += len(chunk)
                    logical_expanded += len(chunk) * multiplicity[member.name]
                    require(count <= maximum_layer_bytes and logical_expanded <= maximum_image_bytes,
                            'IMAGE_EXPANSION_LIMIT')
                    value.update(chunk)
            finally:
                if reader is not counted:
                    reader.close()
            require(counted.count == expected['size'] and counted.digest.hexdigest() == expected['digest'][7:],
                    'IMAGE_LAYER_HASH_INVALID')
        observations[member.name] = {'expandedBytes': count, 'diffId': 'sha256:' + value.hexdigest()}
    require(set(observations) == set(wanted), 'IMAGE_LAYER_MISSING')
    expanded, results = 0, []
    for layer, diff_id in zip(layers, diff_ids):
        immutable_id(diff_id)
        measured = observations[immutable_id(layer['digest'])]
        require(measured['diffId'] == diff_id, 'IMAGE_DIFF_ID_MISMATCH')
        expanded += measured['expandedBytes']
        require(expanded <= maximum_image_bytes, 'IMAGE_EXPANSION_LIMIT')
        results.append({'blobDigest': layer['digest'], 'blobBytes': layer['size'], **measured})
    after = archive.lstat()
    identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
    require(identity(before) == identity(after), 'IMAGE_SOURCE_MUTATED')
    return {'format': 'sabalan-private-image-measurement/v1', 'sourceArchiveSha256': archive_sha,
            'sourceIndex': index_id, 'platformManifest': platform_id, 'configImageId': config_id,
            'layers': results, 'selectedCompressedBytes': sum(v['size'] for v in wanted.values()),
            'expandedLayerBytes': expanded, 'expandedLayerIdentityVerified': True,
            'dockerImportVerified': False, 'healthyApplicationPoint': False, 'publicOnlineAdmission': False}


def materialize_to_stream(archive, output, archive_sha, index_id, platform_id, config_id,
                          maximum_layer_bytes=1024 ** 3, maximum_image_bytes=2 * 1024 ** 3,
                          preserve_source_encoding=False):
    """Emit a private classic archive; caller owns its sink and native closure.

    No Docker invocation, temporary layer copies, tags, cleanup or admission.
    A final manifest is emitted only after all selected layers are verified.
    """
    measured = measure(archive, archive_sha, index_id, platform_id, config_id,
                       maximum_layer_bytes, maximum_image_bytes)
    archive, before, metadata, names, layers, diff_ids, wanted = read_plan(
        archive, archive_sha, index_id, platform_id, config_id,
        maximum_layer_bytes, maximum_image_bytes)
    require(len(wanted) == len(layers), 'IMAGE_STREAM_REPEATED_LAYER_UNPROVEN')
    selected = {immutable_id(layer['digest']): (n, layer, measured['layers'][n])
                for n, layer in enumerate(layers)}

    class HashingWriter:
        def __init__(self):
            self.count, self.digest = 0, hashlib.sha256()

        def write(self, data):
            view = memoryview(data)
            while view:
                written = output.write(view)
                require(type(written) is int and 0 < written <= len(view), 'IMAGE_STREAM_SINK_SHORT_WRITE')
                self.digest.update(view[:written])
                self.count += written
                view = view[written:]
            return len(data)

        def flush(self):
            output.flush()

    writer, completed = HashingWriter(), set()
    with tarfile.open(fileobj=writer, mode='w|', format=tarfile.USTAR_FORMAT) as classic:
        def add(name, data):
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o600
            classic.addfile(info, io.BytesIO(data))

        config_name = config_id[7:] + '.json'
        add(config_name, metadata[names[config_id]])
        for member, stream in scan(archive):
            if member.name not in selected:
                continue
            number, layer, expected = selected[member.name]
            require(member.isfile() and member.size == layer['size'], 'IMAGE_LAYER_SIZE_MISMATCH')
            value, count = hashlib.sha256(), 0
            with stream.extractfile(member) as source:
                counted = CountedReader(source)
                if preserve_source_encoding:
                    # The measured diff ID is bound to these exact blob bytes.
                    # Docker's loader decompresses embedded layers itself.
                    info = tarfile.TarInfo('layer-' + str(number).zfill(4) + '.tar')
                    info.size, info.mode = layer['size'], 0o600
                    classic.addfile(info, counted)
                    require(not counted.read(1) and counted.count == layer['size']
                            and counted.digest.hexdigest() == layer['digest'][7:], 'IMAGE_LAYER_HASH_INVALID')
                    completed.add(member.name)
                    continue
                reader = gzip.GzipFile(fileobj=counted) if layer['mediaType'].endswith(('+gzip', '.gzip')) else counted

                class VerifiedReader:
                    def read(self, size):
                        nonlocal count
                        require(0 <= size <= 1024 * 1024, 'IMAGE_STREAM_READ_UNBOUNDED')
                        chunk = reader.read(size)
                        count += len(chunk)
                        require(count <= expected['expandedBytes'], 'IMAGE_EXPANSION_LIMIT')
                        value.update(chunk)
                        return chunk

                info = tarfile.TarInfo('layer-' + str(number).zfill(4) + '.tar')
                info.size, info.mode = expected['expandedBytes'], 0o600
                try:
                    classic.addfile(info, VerifiedReader())
                    require(not reader.read(1), 'IMAGE_EXPANSION_LIMIT')
                finally:
                    if reader is not counted:
                        reader.close()
                require(count == expected['expandedBytes'] and 'sha256:' + value.hexdigest() == diff_ids[number],
                        'IMAGE_DIFF_ID_MISMATCH')
                require(counted.count == layer['size'] and counted.digest.hexdigest() == layer['digest'][7:],
                        'IMAGE_LAYER_HASH_INVALID')
            completed.add(member.name)
        require(completed == set(wanted), 'IMAGE_LAYER_MISSING')
        after = archive.lstat()
        identity = lambda s: (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns, s.st_ctime_ns, s.st_nlink)
        require(identity(before) == identity(after), 'IMAGE_SOURCE_MUTATED')
        add('manifest.json', json.dumps([{'Config': config_name, 'RepoTags': None,
            'Layers': ['layer-' + str(n).zfill(4) + '.tar' for n in range(len(layers))]}],
            separators=(',', ':')).encode())
    writer.flush()
    return {'format': 'sabalan-private-image-stream-materialization/v1', 'sourceArchiveSha256': archive_sha,
            'sourceIndex': index_id, 'platformManifest': platform_id, 'configImageId': config_id,
            'rootfsDiffIds': diff_ids, 'expandedLayerBytes': measured['expandedLayerBytes'],
            'archiveSha256': writer.digest.hexdigest(), 'archiveBytes': writer.count,
            'layerEncoding': 'source' if preserve_source_encoding else 'expanded',
            'archiveReadbackVerified': False, 'dockerImportVerified': False,
            'tagAssignments': [], 'healthyApplicationPoint': False, 'publicOnlineAdmission': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['archive', 'destination', 'archive-sha256', 'index', 'platform', 'config']:
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    print(json.dumps(materialize(args.archive, args.destination, args.archive_sha256, args.index, args.platform, args.config)))
