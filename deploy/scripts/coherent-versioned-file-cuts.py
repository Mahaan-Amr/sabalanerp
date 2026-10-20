"""Metadata-only versioned-cut handoff inside an already owned SQL freeze.

No object/lineage copying, restore admission, serving authority or point health.
The independent reader must validate full history outside the write pause.
"""
import hashlib
import importlib.util
import os
from pathlib import Path
import re
import stat

spec = importlib.util.spec_from_file_location('coherent_sealed_reader', Path(__file__).with_name('recovery-versioned-files.py'))
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)


def require(value, code):
    if not value:
        raise RuntimeError('COHERENT_VERSIONED_' + code)


class VersionedFileCuts:
    def __init__(self, sources, capture_id, gate_fd):
        require(isinstance(capture_id, str) and reader.SHA.fullmatch(capture_id), 'CAPTURE_INVALID')
        require(isinstance(sources, list) and 1 <= len(sources) <= 32, 'SOURCES_INVALID')
        self.capture_id, self.gate_fd = capture_id, gate_fd
        self.gate = os.fstat(gate_fd)
        self.sources, self.directories, self.selected = [], {}, None
        self.assert_gate()
        names, paths, identities = set(), [], set()
        for source in sources:
            require(reader.exact(source, ['name', 'path', 'device', 'inode', 'storeRoot'])
                    and isinstance(source['name'], str) and re.fullmatch(r'[a-z][a-z0-9-]{0,63}', source['name'])
                    and source['name'] not in names, 'SOURCE_INVALID')
            names.add(source['name'])
            for key in ['device', 'inode']:
                require(isinstance(source[key], str) and re.fullmatch(r'[0-9]{1,30}', source[key]), 'SOURCE_INVALID')
            for key in ['path', 'storeRoot']:
                path = source[key]
                require(isinstance(path, str) and len(os.fsencode(path)) <= 4096, 'SOURCE_INVALID')
                identity = reader.directory(path)
                require(identity not in identities, 'SOURCE_ALIAS')
                require(not any(path == old or path.startswith(old + '/') or old.startswith(path + '/') for old in paths), 'SOURCE_OVERLAP')
                identities.add(identity); paths.append(path); self.directories[path] = identity
            require(self.directories[source['path']] == (int(source['device']), int(source['inode'])), 'SOURCE_CHANGED')
            for part in ['objects', 'versions', 'seals']:
                path = os.path.join(source['storeRoot'], part)
                self.directories[path] = reader.directory(path)
            self.sources.append(dict(source))
        self.assert_unsealed()

    def assert_unsealed(self):
        self.assert_unchanged()
        require(self.selected is None, 'HANDOFF_INVALID')
        for source in self.sources:
            seal = Path(source['storeRoot']) / 'seals' / (self.capture_id + '.json')
            try:
                seal.lstat()
            except FileNotFoundError:
                pass
            else:
                require(False, 'PREEXISTING_CUT')

    def assert_gate(self):
        current = os.fstat(self.gate_fd)
        require(stat.S_ISREG(current.st_mode) and current.st_nlink == 1 and current.st_uid == os.geteuid()
                and not current.st_mode & 0o022 and (current.st_dev, current.st_ino) == (self.gate.st_dev, self.gate.st_ino), 'GATE_UNPROVEN')
        info = Path('/proc/self/fdinfo/' + str(self.gate_fd)).read_text()
        match = re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+([0-9a-f]+):([0-9a-f]+):([0-9]+)\s+0\s+EOF\s*$', info, re.M)
        require(match and (int(match[1], 16), int(match[2], 16), int(match[3]))
                == (os.major(current.st_dev), os.minor(current.st_dev), current.st_ino), 'GATE_UNPROVEN')

    def assert_unchanged(self):
        self.assert_gate()
        require(all(reader.directory(path) == expected for path, expected in self.directories.items()), 'SOURCE_CHANGED')
        if self.selected is not None:
            for path, expected in self.selected:
                require(reader.stable(os.lstat(path)) == expected, 'SEAL_CHANGED')

    def accept(self, cuts):
        self.assert_unchanged()
        require(self.selected is None and isinstance(cuts, list) and len(cuts) == len(self.sources), 'HANDOFF_INVALID')
        selected, result = [], []
        for source, cut in zip(self.sources, cuts):
            require(reader.exact(cut, ['name', 'captureId', 'storeRoot', 'sha256'])
                    and all(cut[key] == expected for key, expected in [('name', source['name']), ('captureId', self.capture_id), ('storeRoot', source['storeRoot'])])
                    and isinstance(cut['sha256'], str) and reader.SHA.fullmatch(cut['sha256']), 'HANDOFF_INVALID')
            path = Path(source['storeRoot']) / 'seals' / (self.capture_id + '.json')
            before = reader.stable(path.lstat())
            metadata = reader.read_sealed_cut_metadata(source['storeRoot'], self.capture_id, cut['sha256'])
            require(metadata['gate'] == dict(device=str(self.gate.st_dev), inode=str(self.gate.st_ino), ownerUid=os.geteuid()), 'GATE_CHANGED')
            require(metadata['source'] == {key: source[key] for key in ['path', 'device', 'inode']}, 'SOURCE_CHANGED')
            seen, previous = set(), None
            for head in metadata['heads']:
                require(reader.exact(head, ['key', 'sha256']) and isinstance(head['sha256'], str)
                        and reader.SHA.fullmatch(head['sha256']), 'HEAD_INVALID')
                key = reader.key(head['key']); order = key.encode('utf-16-be')
                require(key not in seen and (previous is None or order > previous), 'HEAD_INVALID')
                seen.add(key); previous = order
            require(reader.stable(path.lstat()) == before, 'SEAL_CHANGED')
            selected.append((path, before)); result.append(dict(cut))
        self.selected = selected
        self.assert_unchanged()
        return dict(versionedCuts=result, versionedCutsSha256=hashlib.sha256(reader.encoded(result)).hexdigest())
