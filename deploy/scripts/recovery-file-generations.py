#!/usr/bin/env python3
"""Private file generations, operated under the controller's actual write gate.

Objects are independent copies, never hardlinks to mutable application files.
This component does not certify SQL/SQLite coherence, privacy finalization,
remote verification or application recovery. There is deliberately no CLI that
accepts a PASS flag, discards interrupted captures, prunes, or opens traffic.
"""
import hashlib
import json
import os
import re
import stat
import uuid

MAX_HISTORY_COUNT = 10000
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_INTENT_BYTES = 262144
MAX_HISTORY_BYTES = 512 * 1024 * 1024


def fail(code):
    raise RuntimeError(code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, ensure_ascii=True,
                       separators=(",", ":")) + "\n").encode("ascii")


def identity(value):
    return (value.st_dev, value.st_ino)


def stable(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_uid, value.st_gid)


def mount_id(fd):
    with open("/proc/self/fdinfo/" + str(fd), encoding="ascii") as source:
        match = re.search(r"^mnt_id:\s+(\d+)\s*$", source.read(), re.M)
    if not match:
        fail("FILE_GENERATION_MOUNT_ID_UNPROVEN")
    return match[1]


def sync_directory(directory):
    fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_ancestry(directory):
    while True:
        value = os.lstat(directory)
        if (not stat.S_ISDIR(value.st_mode) or os.path.realpath(directory) != directory
                or (value.st_mode & 0o022 and not value.st_mode & stat.S_ISVTX)):
            fail("FILE_GENERATION_ANCESTRY_UNSAFE")
        sync_directory(directory)
        parent = os.path.dirname(directory)
        if parent == directory:
            return
        directory = parent


def private_directory(directory, create=False):
    if not os.path.isabs(directory) or os.path.normpath(directory) != directory:
        fail("FILE_GENERATION_DIRECTORY_INVALID")
    if create:
        os.mkdir(directory, 0o700)
        sync_directory(os.path.dirname(directory))
    value = os.lstat(directory)
    if (os.path.realpath(directory) != directory or not stat.S_ISDIR(value.st_mode)
            or value.st_uid != os.geteuid() or value.st_mode & 0o077):
        fail("FILE_GENERATION_DIRECTORY_UNSAFE")
    return value


def read_file(directory, name, maximum):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                 dir_fd=directory)
    try:
        before = os.fstat(fd)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                or before.st_mode & 0o222 or before.st_size > maximum):
            fail("FILE_GENERATION_RECORD_UNSAFE")
        chunks, length = [], 0
        while True:
            chunk = os.read(fd, min(262144, maximum + 1 - length))
            if not chunk:
                break
            chunks.append(chunk)
            length += len(chunk)
            if length > maximum:
                fail("FILE_GENERATION_RECORD_TOO_LARGE")
        if stable(before) != stable(os.fstat(fd)):
            fail("FILE_GENERATION_RECORD_CHANGED")
        # A valid record may have lost its publisher before fsync. Adopt actual
        # cached bytes durably, never infer persistence from readable JSON.
        os.fsync(fd)
        return b"".join(chunks)
    finally:
        os.close(fd)


def publish_record(directory, name, value, maximum=MAX_MANIFEST_BYTES):
    data = encoded(value)
    if len(data) > maximum:
        fail("FILE_GENERATION_RECORD_TOO_LARGE")
    fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                 0o400, dir_fd=directory)
    try:
        with os.fdopen(fd, "wb", closefd=False) as output:
            output.write(data)
            output.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    os.fsync(directory)
    return hashlib.sha256(data).hexdigest()


class _FileGenerationReader:
    selected_sha = None

    def __init__(self, root):
        self.root = root
        self.root_identity = identity(private_directory(root))
        self.objects_identity = identity(private_directory(os.path.join(root, "objects")))
        self.captures_identity = identity(private_directory(os.path.join(root, "captures")))
        sync_ancestry(root)
        self.assert_owner()

    def assert_owner(self):
        if identity(private_directory(self.root)) != self.root_identity:
            fail("FILE_GENERATION_STORE_CHANGED")
        for name, expected in (("objects", self.objects_identity),
                               ("captures", self.captures_identity)):
            if identity(private_directory(os.path.join(self.root, name))) != expected:
                fail("FILE_GENERATION_STORE_CHANGED")

    def _history(self, selected_sha=None, *, for_capture=False):
        self.assert_owner()
        if self.selected_sha is not None and (for_capture or selected_sha != self.selected_sha):
            fail("FILE_GENERATION_SELECTION_CHANGED")
        directory = os.path.join(self.root, "captures")
        names = sorted(os.listdir(directory))
        if len(names) > MAX_HISTORY_COUNT or (for_capture and len(names) >= MAX_HISTORY_COUNT):
            fail("FILE_GENERATION_HISTORY_CAPACITY")
        last, selected, total_bytes = None, None, 0
        previous = None
        for number, name in enumerate(names, 1):
            if not re.fullmatch(str(number).zfill(12) + r"-[a-f0-9]{64}", name):
                fail("FILE_GENERATION_HISTORY_INVALID")
            target = os.path.join(directory, name)
            private_directory(target)
            fd = os.open(target, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if sorted(os.listdir(fd)) != ["intent.json", "manifest.json"]:
                    fail("FILE_GENERATION_CAPTURE_UNFINISHED")
                raw = read_file(fd, "manifest.json", MAX_MANIFEST_BYTES)
                manifest = json.loads(raw)
                intent_raw = read_file(fd, "intent.json", MAX_INTENT_BYTES)
                intent = json.loads(intent_raw)
                if (encoded(manifest) != raw or encoded(intent) != intent_raw
                        or manifest.get("format") != "sabalan-file-generation/v1"
                        or manifest.get("generation") != number
                        or manifest.get("captureId") != name[13:]
                        or manifest.get("previousSha256") != previous
                        or manifest.get("intentSha256") != hashlib.sha256(intent_raw).hexdigest()
                        or intent != {"format": "sabalan-file-generation-intent/v1",
                                      "generation": number, "captureId": name[13:],
                                      "previousSha256": previous,
                                      "sources": manifest.get("sources")}):
                    fail("FILE_GENERATION_HISTORY_INVALID")
                self._validate_entries(manifest)
                old_keys = {(entry["source"], entry["path"]) for entry in last["entries"]} if last else set()
                current_keys = {(entry["source"], entry["path"]) for entry in manifest["entries"]}
                if manifest["deleted"] != [{"source": source, "path": relative}
                                           for source, relative in sorted(old_keys - current_keys)]:
                    fail("FILE_GENERATION_DELETION_LINEAGE_INVALID")
                previous = hashlib.sha256(raw).hexdigest()
                total_bytes += len(raw)
                if total_bytes > MAX_HISTORY_BYTES:
                    fail("FILE_GENERATION_HISTORY_CAPACITY")
                os.fsync(fd)
                if previous == selected_sha:
                    if selected is not None:
                        fail("FILE_GENERATION_HISTORY_INVALID")
                    selected = manifest
                last = manifest
                # Later captures may be in progress. A reader pins one complete
                # immutable prefix, never adopts or waits for a future suffix.
                if self.selected_sha is not None and previous == self.selected_sha:
                    break
            finally:
                os.close(fd)
        sync_directory(directory)
        self.assert_owner()
        return {"count": len(names), "last": last, "lastSha256": previous,
                "selected": selected, "bytes": total_bytes}

    @staticmethod
    def _validate_entries(manifest):
        if set(manifest) != {"format", "generation", "captureId", "previousSha256", "intentSha256",
                             "sources", "entries", "deleted"}:
            fail("FILE_GENERATION_MANIFEST_INVALID")
        sources = manifest.get("sources")
        entries = manifest.get("entries")
        if (not isinstance(sources, list) or not sources or len(sources) > 32
                or not isinstance(entries, list) or len(entries) > 1000000):
            fail("FILE_GENERATION_MANIFEST_INVALID")
        for source in sources:
            if (not isinstance(source, dict) or set(source) != {"name", "path", "device", "inode"}
                    or not isinstance(source["path"], str) or not os.path.isabs(source["path"])
                    or os.path.normpath(source["path"]) != source["path"]
                    or any(not isinstance(source[key], str) or not re.fullmatch(r"[1-9][0-9]{0,24}", source[key])
                           for key in ("device", "inode"))):
                fail("FILE_GENERATION_MANIFEST_INVALID")
        names = [source["name"] for source in sources]
        if (any(not isinstance(name, str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", name)
                for name in names) or len(set(names)) != len(names)):
            fail("FILE_GENERATION_MANIFEST_INVALID")
        keys = []
        for entry in entries:
            if (not isinstance(entry, dict) or set(entry) != {"source", "path", "bytes", "sha256"}
                    or entry["source"] not in names or not isinstance(entry["path"], str)
                    or not entry["path"] or any(part in ("", ".", "..")
                                               for part in entry["path"].split("/"))
                    or "\x00" in entry["path"] or not isinstance(entry["bytes"], int)
                    or isinstance(entry["bytes"], bool) or entry["bytes"] < 0
                    or not isinstance(entry["sha256"], str)
                    or not re.fullmatch(r"[a-f0-9]{64}", entry["sha256"])):
                fail("FILE_GENERATION_MANIFEST_INVALID")
            keys.append((entry["source"], entry["path"]))
        if sorted(set(keys)) != keys:
            fail("FILE_GENERATION_MANIFEST_INVALID")
        key_set = set(keys)
        for source, relative in keys:
            parts = relative.split("/")
            if any((source, "/".join(parts[:index])) in key_set
                   for index in range(1, len(parts))):
                fail("FILE_GENERATION_PATH_CONFLICT")

    def _object(self, objects_fd, entry, output_fd=None):
        fd = os.open(entry["sha256"], os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                     dir_fd=objects_fd)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                    or before.st_mode & 0o222 or before.st_size != entry["bytes"]):
                fail("FILE_GENERATION_OBJECT_UNSAFE")
            digest, size = hashlib.sha256(), 0
            while True:
                chunk = os.read(fd, 262144)
                if not chunk:
                    break
                size += len(chunk)
                if size > entry["bytes"]:
                    fail("FILE_GENERATION_OBJECT_CHANGED")
                digest.update(chunk)
                if output_fd is not None:
                    view = memoryview(chunk)
                    while view:
                        written = os.write(output_fd, view)
                        if written <= 0:
                            fail("FILE_GENERATION_WRITE_INCOMPLETE")
                        view = view[written:]
            if (digest.hexdigest() != entry["sha256"] or size != entry["bytes"]
                    or stable(before) != stable(os.fstat(fd))):
                fail("FILE_GENERATION_OBJECT_CHANGED")
        finally:
            os.close(fd)

    def verify(self, sha256):
        history = self._history(sha256)
        manifest = history["selected"]
        if manifest is None:
            fail("FILE_GENERATION_MANIFEST_NOT_FOUND")
        fd = os.open(os.path.join(self.root, "objects"), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for entry in manifest["entries"]:
                self.assert_owner()
                self._object(fd, entry)
        finally:
            os.close(fd)
        return manifest

    def restore(self, sha256, target):
        manifest = self.verify(sha256)
        # Always a new private stage. Never merge into or roll back live data.
        if (not os.path.isabs(target) or os.path.normpath(target) != target
                or os.path.realpath(os.path.dirname(target)) != os.path.dirname(target)):
            fail("FILE_GENERATION_RESTORE_TARGET_INVALID")
        for protected in [self.root] + [source["path"] for source in manifest["sources"]]:
            if os.path.commonpath([target, protected]) in (target, protected):
                fail("FILE_GENERATION_RESTORE_TARGET_INVALID")
        private_directory(target, create=True)
        objects = os.open(os.path.join(self.root, "objects"), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            for entry in manifest["entries"]:
                self.assert_owner()
                destination = os.path.join(target, entry["source"], *entry["path"].split("/"))
                parent = os.path.dirname(destination)
                os.makedirs(parent, mode=0o700, exist_ok=True)
                fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
                try:
                    self._object(objects, entry, fd)
                    os.fsync(fd)
                finally:
                    os.close(fd)
                # Persist every newly created ancestor, including empty sources.
                current = parent
                while current != target:
                    sync_directory(current)
                    current = os.path.dirname(current)
            for source in manifest["sources"]:
                directory = os.path.join(target, source["name"])
                os.makedirs(directory, mode=0o700, exist_ok=True)
                sync_directory(directory)
            sync_directory(target)
            self.assert_owner()
            return {"manifestSha256": sha256, "files": len(manifest["entries"]),
                    "bytes": sum(entry["bytes"] for entry in manifest["entries"])}
        finally:
            os.close(objects)


class SealedFileGeneration(_FileGenerationReader):
    """Materialize one hash-pinned immutable prefix outside the write pause.

    No source file is opened, no gate is acquired/inherited and no capture,
    prune, traffic or recovery-point publication operation is exposed. The
    controller still owns native completion, privacy/dependency retention and
    coherent PostgreSQL/SQLite selection; this reader grants none of those.
    """
    def __init__(self, root, sha256):
        if not isinstance(sha256, str) or not re.fullmatch(r"[a-f0-9]{64}", sha256):
            fail("FILE_GENERATION_SELECTION_INVALID")
        self.selected_sha = sha256
        super().__init__(root)

    def verify(self, sha256=None):
        if sha256 is not None and sha256 != self.selected_sha:
            fail("FILE_GENERATION_SELECTION_CHANGED")
        return super().verify(self.selected_sha)

    def restore(self, target):
        return super().restore(self.selected_sha, target)


class FileGenerations(_FileGenerationReader):
    def __init__(self, root, gate_fd, gate_device, gate_inode):
        self.root, self.gate_fd = root, gate_fd
        self.gate_identity = (int(gate_device), int(gate_inode))
        self.root_identity = identity(private_directory(root))
        self.assert_gate()
        sync_ancestry(root)
        for name in ("objects", "captures"):
            target = os.path.join(root, name)
            try:
                private_directory(target, create=True)
            except FileExistsError:
                private_directory(target)
        self.objects_identity = identity(os.lstat(os.path.join(root, "objects")))
        self.captures_identity = identity(os.lstat(os.path.join(root, "captures")))

    def assert_gate(self):
        value = os.fstat(self.gate_fd)
        named = os.readlink("/proc/self/fd/" + str(self.gate_fd))
        parent = os.lstat(os.path.dirname(named))
        if (identity(value) != self.gate_identity or not stat.S_ISREG(value.st_mode)
                or value.st_nlink != 1 or value.st_size != 0
                or value.st_uid != os.geteuid() or value.st_mode & 0o022
                or os.path.basename(named) != "deployment-write-admission.lock"
                or os.path.realpath(named) != named or identity(os.lstat(named)) != identity(value)
                or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid()
                or parent.st_mode & 0o022):
            fail("FILE_GENERATION_GATE_CHANGED")
        with open("/proc/self/fdinfo/" + str(self.gate_fd), encoding="ascii") as source:
            details = source.read()
        if not re.search(r"^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+"
                         r"[0-9a-f]+:[0-9a-f]+:" + str(value.st_ino)
                         + r"\s+0\s+EOF\s*$", details, re.M):
            fail("FILE_GENERATION_EXCLUSIVE_GATE_REQUIRED")

    def assert_owner(self):
        self.assert_gate()
        if identity(private_directory(self.root)) != self.root_identity:
            fail("FILE_GENERATION_STORE_CHANGED")
        for name, expected in (("objects", self.objects_identity),
                               ("captures", self.captures_identity)):
            if identity(private_directory(os.path.join(self.root, name))) != expected:
                fail("FILE_GENERATION_STORE_CHANGED")

    def _copy(self, source_fd, name, objects_fd, source, relative):
        opened = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                         dir_fd=source_fd)
        temporary = ".pending-" + uuid.uuid4().hex
        staged = None
        try:
            before = os.fstat(opened)
            if not stat.S_ISREG(before.st_mode) or mount_id(opened) != mount_id(source_fd):
                fail("FILE_GENERATION_SOURCE_NOT_REGULAR")
            staged = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                             0o600, dir_fd=objects_fd)
            digest, size = hashlib.sha256(), 0
            while True:
                self.assert_gate()
                chunk = os.read(opened, 262144)
                if not chunk:
                    break
                size += len(chunk)
                if size > before.st_size:
                    fail("FILE_GENERATION_SOURCE_CHANGED")
                digest.update(chunk)
                view = memoryview(chunk)
                while view:
                    written = os.write(staged, view)
                    if written <= 0:
                        fail("FILE_GENERATION_WRITE_INCOMPLETE")
                    view = view[written:]
            if (size != before.st_size or stable(before) != stable(os.fstat(opened))
                    or stable(before) != stable(os.stat(name, dir_fd=source_fd, follow_symlinks=False))):
                fail("FILE_GENERATION_SOURCE_CHANGED")
            os.fchmod(staged, 0o400)
            os.fsync(staged)
            os.close(staged)
            staged = None
            entry = {"source": source, "path": relative,
                     "bytes": size, "sha256": digest.hexdigest()}
            try:
                os.link(temporary, entry["sha256"], src_dir_fd=objects_fd,
                        dst_dir_fd=objects_fd, follow_symlinks=False)
                os.fsync(objects_fd)
            except FileExistsError:
                self._object(objects_fd, entry)
            os.unlink(temporary, dir_fd=objects_fd)
            os.fsync(objects_fd)
            return entry
        finally:
            os.close(opened)
            if staged is not None:
                os.close(staged)
            # An interrupted private object remains diagnosable. No cleanup of
            # unknown entries, no incomplete manifest, and no next capture.

    def capture(self, sources, capture_id):
        self.assert_owner()
        if not re.fullmatch(r"[a-f0-9]{64}", capture_id):
            fail("FILE_GENERATION_CAPTURE_ID_INVALID")
        history = self._history(for_capture=True)
        if history["count"] >= MAX_HISTORY_COUNT:
            fail("FILE_GENERATION_HISTORY_CAPACITY")
        number, previous = history["count"] + 1, history["lastSha256"]
        # Source identity is provided by the frozen controller inventory, not
        # discovered from user-controlled request paths or a directory walk.
        if not isinstance(sources, list) or not sources or len(sources) > 32:
            fail("FILE_GENERATION_SOURCE_INVALID")
        roots, declared = [], []
        for item in sorted(sources, key=lambda value: value["name"]):
            if (set(item) != {"name", "path", "device", "inode"}
                    or not re.fullmatch(r"[a-z][a-z0-9-]{0,63}", item["name"])
                    or not os.path.isabs(item["path"]) or os.path.realpath(item["path"]) != item["path"]
                    or os.path.normpath(item["path"]) != item["path"]):
                fail("FILE_GENERATION_SOURCE_INVALID")
            value = os.lstat(item["path"])
            if (not stat.S_ISDIR(value.st_mode) or value.st_mode & 0o022
                    or identity(value) != (int(item["device"]), int(item["inode"]))):
                fail("FILE_GENERATION_SOURCE_CHANGED")
            for other in [self.root] + roots:
                common = os.path.commonpath([other, item["path"]])
                if common in (other, item["path"]):
                    fail("FILE_GENERATION_SOURCE_OVERLAP")
            roots.append(item["path"])
            declared.append(dict(item))
        if len({item["name"] for item in declared}) != len(declared):
            fail("FILE_GENERATION_SOURCE_INVALID")
        intent = {"format": "sabalan-file-generation-intent/v1", "generation": number,
                  "captureId": capture_id, "previousSha256": previous, "sources": declared}
        if len(encoded(intent)) > MAX_INTENT_BYTES:
            fail("FILE_GENERATION_RECORD_TOO_LARGE")
        name = str(number).zfill(12) + "-" + capture_id
        directory = os.path.join(self.root, "captures", name)
        private_directory(directory, create=True)
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        objects = os.open(os.path.join(self.root, "objects"), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            intent_sha = publish_record(fd, "intent.json", intent, MAX_INTENT_BYTES)
            entries = []

            def walk(directory_fd, source, prefix, device, expected_mount):
                before = os.fstat(directory_fd)
                if before.st_dev != device or before.st_mode & 0o022 or mount_id(directory_fd) != expected_mount:
                    fail("FILE_GENERATION_SOURCE_DIRECTORY_UNSAFE")
                for child in sorted(os.listdir(directory_fd)):
                    self.assert_owner()
                    if child.startswith(".sabalan-file-"):
                        fail("FILE_GENERATION_UNFINISHED_WRITER")
                    value = os.stat(child, dir_fd=directory_fd, follow_symlinks=False)
                    relative = prefix + child
                    if stat.S_ISDIR(value.st_mode):
                        nested = os.open(child, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=directory_fd)
                        try:
                            if identity(os.fstat(nested)) != identity(value):
                                fail("FILE_GENERATION_SOURCE_CHANGED")
                            walk(nested, source, relative + "/", device, expected_mount)
                        finally:
                            os.close(nested)
                    elif stat.S_ISREG(value.st_mode) and value.st_dev == device:
                        entries.append(self._copy(directory_fd, child, objects, source, relative))
                    else:
                        fail("FILE_GENERATION_SOURCE_NOT_REGULAR")
                if stable(before) != stable(os.fstat(directory_fd)):
                    fail("FILE_GENERATION_SOURCE_CHANGED")

            for item in declared:
                source_fd = os.open(item["path"], os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                try:
                    if identity(os.fstat(source_fd)) != (int(item["device"]), int(item["inode"])):
                        fail("FILE_GENERATION_SOURCE_CHANGED")
                    walk(source_fd, item["name"], "", int(item["device"]), mount_id(source_fd))
                    if identity(os.lstat(item["path"])) != identity(os.fstat(source_fd)):
                        fail("FILE_GENERATION_SOURCE_CHANGED")
                finally:
                    os.close(source_fd)
            entries.sort(key=lambda entry: (entry["source"], entry["path"]))
            old_keys = {(entry["source"], entry["path"]) for entry in history["last"]["entries"]} if history["last"] else set()
            current_keys = {(entry["source"], entry["path"]) for entry in entries}
            manifest = {"format": "sabalan-file-generation/v1", "generation": number,
                        "captureId": capture_id, "previousSha256": previous,
                        "intentSha256": intent_sha, "sources": declared, "entries": entries,
                        "deleted": [{"source": source, "path": relative}
                                    for source, relative in sorted(old_keys - current_keys)]}
            self._validate_entries(manifest)
            if history["bytes"] + len(encoded(manifest)) > MAX_HISTORY_BYTES:
                fail("FILE_GENERATION_HISTORY_CAPACITY")
            self.assert_owner()
            sha = publish_record(fd, "manifest.json", manifest)
            return {"manifest": manifest, "sha256": sha}
        finally:
            os.close(objects)
            os.close(fd)
