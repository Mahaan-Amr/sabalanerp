"""Bounded read-only TAR accounting for private ext4/overlay2 image imports.
No extraction, Docker invocation, admission, cleanup or filesystem mutation.
"""
import hashlib
import heapq


def require(value, code):
    if not value:
        raise RuntimeError(code)


def rounded(value, unit):
    return ((value + unit - 1) // unit) * unit


def extent_metadata(data_bytes, unit):
    # Four extents fit in the inode. A deliberately reduced on-disk fanout
    # bounds extent blocks even when every data block is fragmented.
    entries, blocks = (data_bytes + unit - 1) // unit, 0
    while entries > 4:
        entries = (entries + 127) // 128
        blocks += entries
    return blocks * unit


def number(field):
    if field[0] == 0x80:
        return int.from_bytes(field[1:], 'big')
    require(not field[0] & 0x80, 'FILESYSTEM_TAR_NUMBER_UNSUPPORTED')
    field = field.strip(b'\0 ')
    require(not field or all(v in b'01234567' for v in field), 'FILESYSTEM_TAR_NUMBER_INVALID')
    return int(field or b'0', 8)


def tar_path(value):
    value = value.rstrip(b'\0')
    require(b'\0' not in value, 'FILESYSTEM_TAR_PATH_UNSUPPORTED')
    while value.startswith(b'./'):
        value = value[2:]
    value = value.lstrip(b'/').rstrip(b'/')
    parts = [p for p in value.split(b'/') if p != b'.']
    require((len(value) <= 4096 and all(p and p != b'..' and len(p) <= 255 for p in parts))
            or value == b'', 'FILESYSTEM_TAR_PATH_UNSUPPORTED')
    return b'/'.join(parts) if value else b''


def pax_records(data):
    records, cursor = {}, 0
    while cursor < len(data):
        space = data.find(b' ', cursor, cursor + 10)
        require(space > cursor and data[cursor:space].isdigit(), 'FILESYSTEM_PAX_INVALID')
        size = int(data[cursor:space])
        require(size > space - cursor + 2 and cursor + size <= len(data)
                and data[cursor + size - 1:cursor + size] == b'\n', 'FILESYSTEM_PAX_INVALID')
        key, separator, value = data[space + 1:cursor + size - 1].partition(b'=')
        require(separator and key and len(records) < 4096, 'FILESYSTEM_PAX_INVALID')
        require(value, 'FILESYSTEM_EMPTY_EXTENSION_UNPROVEN')
        require(not key.startswith((b'GNU.sparse', b'SCHILY.realsize')), 'FILESYSTEM_SPARSE_UNPROVEN')
        records[key] = value
        cursor += size
    return records


class Accounting:
    def __init__(self, unit=4096):
        require(unit == 4096, 'FILESYSTEM_ALLOCATION_UNIT_UNPROVEN')
        self.unit, self.entries, self.path_bytes = unit, 0, 0
        self.known_sizes, self.hardlinks, self.layers = {}, [], []
        self.names, self.symlinks = set(), set()
        self.max_xattr_bytes, self.max_xattr_inodes = 0, 0

    def remember_path(self, path):
        if path not in self.names:
            self.path_bytes += len(path)
            require(len(self.names) < 250000 and self.path_bytes <= 32 * 1024 ** 2,
                    'FILESYSTEM_PATH_INVENTORY_LIMIT')
            self.names.add(path)

    def remember(self, path, size):
        self.remember_path(path)
        self.known_sizes[path] = max(size, self.known_sizes.get(path, 0))

    def inspect_layer(self, source):
        unit, digest, count = self.unit, hashlib.sha256(), 0
        stats = {'entryCount': 0, 'dataAllocatedBytes': 0, 'extentMetadataBytes': 0,
                 'entryMetadataBytes': 0, 'xattrBytes': 0, 'tarSplitBytes': 0, 'regularPayloadBytes': 0,
                 'inodeUpperBound': 32, 'fixedLayerMetadataBytes': 1024 ** 2}
        parents, explicit_dirs, pending, long_name, long_link = set(), set(), {}, None, None
        metadata_bytes, parent_bytes, metadata_records = 0, 0, 0
        extension_family = None

        def read(size):
            nonlocal count
            require(0 <= size <= 1024 ** 2, 'FILESYSTEM_READ_UNBOUNDED')
            value = source.read(size)
            count += len(value)
            require(count <= 1024 ** 3, 'FILESYSTEM_LAYER_EXPANSION_LIMIT')
            digest.update(value)
            return value

        def exact(size, retain=False):
            result = bytearray()
            while size:
                chunk = read(min(size, 1024 ** 2))
                require(chunk, 'FILESYSTEM_TAR_TRUNCATED')
                size -= len(chunk)
                if retain:
                    result.extend(chunk)
            return bytes(result)

        while True:
            header = exact(512, True)
            if header == bytes(512):
                require(exact(512, True) == bytes(512), 'FILESYSTEM_TAR_END_UNPROVEN')
                while chunk := read(1024 ** 2):
                    require(not any(chunk), 'FILESYSTEM_TAR_TRAILING_DATA')
                require(not pending and long_name is None and long_link is None,
                        'FILESYSTEM_UNCONSUMED_METADATA')
                break
            require(sum(header[:148]) + 8 * 32 + sum(header[156:]) == number(header[148:156]),
                    'FILESYSTEM_TAR_CHECKSUM_INVALID')
            size, kind = number(header[124:136]), header[156:157]
            require(size <= 1024 ** 3, 'FILESYSTEM_TAR_MEMBER_LIMIT')
            if kind in [b'x', b'L', b'K']:
                family = 'pax' if kind == b'x' else 'gnu'
                require(extension_family in [None, family], 'FILESYSTEM_MIXED_EXTENSIONS_UNPROVEN')
                extension_family = family
                metadata_records += 1
                require(metadata_records <= 4096, 'FILESYSTEM_METADATA_RECORD_LIMIT')
                require(size <= 1024 ** 2 and metadata_bytes + size <= 1024 ** 2,
                        'FILESYSTEM_METADATA_LIMIT')
                data = exact(size, True)
                exact((-size) % 512)
                metadata_bytes += size
                if kind == b'x':
                    # The pinned Moby tar reader replaces consecutive local
                    # PAX maps. Merging would retain overridden path/size keys.
                    pending = pax_records(data)
                    require(len(pending) <= 4096, 'FILESYSTEM_PAX_RECORD_LIMIT')
                elif kind == b'L':
                    long_name = data.rstrip(b'\0')
                    require(long_name, 'FILESYSTEM_EMPTY_EXTENSION_UNPROVEN')
                else:
                    long_link = data.rstrip(b'\0')
                    require(long_link, 'FILESYSTEM_EMPTY_EXTENSION_UNPROVEN')
                continue
            require(kind in [b'\0', b'0', b'1', b'2', b'3', b'4', b'5', b'6', b'7'],
                    'FILESYSTEM_TAR_TYPE_UNPROVEN')
            name = header[:100].split(b'\0', 1)[0]
            prefix = header[345:500].split(b'\0', 1)[0] if header[257:263] == b'ustar\0' else b''
            name = prefix + b'/' + name if prefix else name
            path = tar_path(pending.get(b'path', long_name if long_name is not None else name))
            link = pending.get(b'linkpath', long_link if long_link is not None else header[157:257].split(b'\0', 1)[0])
            if b'size' in pending:
                require(pending[b'size'].isdigit(), 'FILESYSTEM_PAX_SIZE_INVALID')
                size = int(pending[b'size'])
            require(size <= 1024 ** 3 and (path or kind == b'5'), 'FILESYSTEM_MEMBER_UNPROVEN')
            self.entries += 1
            require(self.entries <= 250000, 'FILESYSTEM_ENTRY_LIMIT')
            stats['entryCount'] += 1
            stats['inodeUpperBound'] += 1
            # Directory/inode metadata and tar-split records are charged per
            # entry. Long names and PAX payloads get explicit additional space.
            stats['entryMetadataBytes'] += max(2 * unit, rounded(1024 + 6 * (len(path) + len(link)) + 1024, unit) + unit)
            parts = path.split(b'/') if path else []
            for n in range(1, len(parts)):
                parent = b'/'.join(parts[:n])
                if parent not in parents:
                    parent_bytes += len(parent)
                    parents.add(parent)
            require(len(parents) <= 250000 and parent_bytes <= 32 * 1024 ** 2,
                    'FILESYSTEM_PARENT_INVENTORY_LIMIT')
            if kind in [b'\0', b'0', b'7']:
                stats['regularPayloadBytes'] += size
                allocated = rounded(size, unit)
                stats['dataAllocatedBytes'] += allocated
                stats['extentMetadataBytes'] += extent_metadata(allocated, unit)
                self.remember(path, size)
            else:
                require(size == 0, 'FILESYSTEM_NONREGULAR_DATA_UNPROVEN')
                if kind == b'5':
                    explicit_dirs.add(path)
                    stats['dataAllocatedBytes'] += unit
                    self.remember(path, 0)
                elif kind == b'2':
                    require(len(link) <= 4096, 'FILESYSTEM_SYMLINK_LIMIT')
                    stats['dataAllocatedBytes'] += rounded(len(link), unit)
                    self.remember(path, len(link))
                    self.symlinks.add(path)
                elif kind == b'1':
                    target = tar_path(link)
                    self.remember_path(path)
                    self.remember_path(target)
                    require(len(self.hardlinks) < 250000, 'FILESYSTEM_HARDLINK_LIMIT')
                    self.hardlinks.append((path, target, stats))
                else:
                    self.remember(path, 0)
            member_xattr_bytes, member_xattr_inodes = 0, 0
            for key, value in pending.items():
                if key.startswith((b'SCHILY.xattr.', b'LIBARCHIVE.xattr.', b'SCHILY.acl.')):
                    charge = 2 * unit + rounded(len(key) + len(value), unit)
                    stats['xattrBytes'] += charge
                    stats['inodeUpperBound'] += 1
                    member_xattr_bytes += charge
                    member_xattr_inodes += 1
            self.max_xattr_bytes = max(self.max_xattr_bytes, member_xattr_bytes)
            self.max_xattr_inodes = max(self.max_xattr_inodes, member_xattr_inodes)
            exact(size)
            exact((-size) % 512)
            pending, long_name, long_link, metadata_bytes, metadata_records = {}, None, None, 0, 0
            extension_family = None
        implicit = len(parents - explicit_dirs)
        stats['implicitDirectoryCount'] = implicit
        stats['dataAllocatedBytes'] += implicit * unit
        stats['entryMetadataBytes'] += implicit * 2 * unit
        stats['inodeUpperBound'] += implicit
        stats['rawMetadataBytes'] = count - stats['regularPayloadBytes']
        # tar-split retains raw headers, extension headers, block padding and
        # trailing bytes. Base64/record storage is bounded separately from data.
        stats['tarSplitBytes'] = 2 * stats['rawMetadataBytes']
        stats.update(expandedBytes=count, diffId='sha256:' + digest.hexdigest())
        self.layers.append(stats)
        return stats

    def finish(self):
        reverse = {}
        possible_symlink_prefixes = self.symlinks | {path for path, _, _ in self.hardlinks}
        largest_file = max(self.known_sizes.values(), default=0)
        for _, target, stats in self.hardlinks:
            parts = target.split(b'/')
            if any(b'/'.join(parts[:n]) in possible_symlink_prefixes for n in range(1, len(parts) + 1)):
                # Resolution through symlinks/aliases can choose another image
                # file. Never undercharge it using the link text's byte length.
                self.known_sizes[target] = largest_file
                stats['hardlinkGlobalSizeFallbackCount'] = stats.get('hardlinkGlobalSizeFallbackCount', 0) + 1
        for path, target, _ in self.hardlinks:
            reverse.setdefault(target, []).append(path)
        # Descending propagation gives each alias its largest possible target
        # before finalizing it, independent of physical blob ordering.
        queue = [(-size, path) for path, size in self.known_sizes.items()]
        heapq.heapify(queue)
        resolved = {}
        while queue:
            negative, path = heapq.heappop(queue)
            if path in resolved:
                continue
            size = -negative
            resolved[path] = size
            for alias in reverse.get(path, []):
                if alias not in resolved:
                    heapq.heappush(queue, (-size, alias))
        for path, target, stats in self.hardlinks:
            require(target in resolved, 'FILESYSTEM_HARDLINK_TARGET_UNPROVEN')
            allocated = rounded(resolved[target], self.unit)
            stats['dataAllocatedBytes'] += allocated
            stats['extentMetadataBytes'] += extent_metadata(allocated, self.unit)
            stats['xattrBytes'] += self.max_xattr_bytes
            stats['inodeUpperBound'] += self.max_xattr_inodes
        for stats in self.layers:
            stats['allocationUpperBoundBytes'] = sum(stats[k] for k in ['dataAllocatedBytes',
                'extentMetadataBytes', 'entryMetadataBytes', 'xattrBytes', 'fixedLayerMetadataBytes']) + rounded(stats['tarSplitBytes'], self.unit)
        return {'format': 'sabalan-private-ext4-image-capacity/v1', 'allocationUnit': self.unit,
                'layers': self.layers, 'entryCount': self.entries,
                'allocationUpperBoundBytes': sum(s['allocationUpperBoundBytes'] for s in self.layers),
                'inodeUpperBound': sum(s['inodeUpperBound'] for s in self.layers),
                'healthyApplicationPoint': False, 'publicOnlineAdmission': False}


def requirements(proof, staging_bytes, scratch_allocated_bytes, staging_inodes,
                 reserve_bytes=1024 ** 3, headroom_bytes=128 * 1024 ** 2,
                 reserve_inodes=65536):
    require(proof['format'] == 'sabalan-private-ext4-image-capacity/v1'
            and proof['allocationUnit'] == 4096, 'FILESYSTEM_CAPACITY_PROOF_UNSUPPORTED')
    require(all(type(v) is int and v >= 0 for v in [staging_bytes, scratch_allocated_bytes,
                staging_inodes, reserve_bytes, headroom_bytes, reserve_inodes]), 'FILESYSTEM_CAPACITY_INPUT_INVALID')
    allocation = proof['allocationUpperBoundBytes']
    return {'requiredBeforeBytes': max(staging_bytes, staging_bytes + allocation - scratch_allocated_bytes)
                + reserve_bytes + headroom_bytes,
            'requiredAfterRetirementBytes': allocation + reserve_bytes + headroom_bytes,
            'requiredInodes': proof['inodeUpperBound'] + staging_inodes + reserve_inodes}


def admit(available_bytes, available_inodes, needed, after_retirement=False):
    require(available_bytes >= needed['requiredAfterRetirementBytes' if after_retirement else 'requiredBeforeBytes'],
            'FILESYSTEM_IMPORT_BYTES_INSUFFICIENT')
    require(available_inodes >= needed['requiredInodes'], 'FILESYSTEM_IMPORT_INODES_INSUFFICIENT')
