import hashlib
import importlib.util
import io
from pathlib import Path
import tarfile
import unittest

source = Path(__file__).resolve().parents[2] / 'deploy/scripts/private-image-filesystem-capacity.py'
spec = importlib.util.spec_from_file_location('capacity', source)
capacity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capacity)


def layer(entries, format=tarfile.USTAR_FORMAT):
    out = io.BytesIO()
    with tarfile.open(fileobj=out, mode='w', format=format) as stream:
        for name, body, kind, link, pax in entries:
            info = tarfile.TarInfo(name)
            info.type, info.linkname, info.pax_headers = kind, link, pax
            info.size = len(body)
            stream.addfile(info, io.BytesIO(body))
    return out.getvalue()


class FilesystemCapacity(unittest.TestCase):
    def test_empty_pax_and_gnu_overrides_fail_closed_for_deep_paths_and_links(self):
        cases = [(tarfile.XHDTYPE, b'8 path=\n', tarfile.DIRTYPE),
                 (tarfile.XHDTYPE, b'13 linkpath=\n', tarfile.LNKTYPE),
                 (tarfile.GNUTYPE_LONGNAME, b'\0', tarfile.DIRTYPE),
                 (tarfile.GNUTYPE_LONGLINK, b'\0', tarfile.LNKTYPE)]
        for kind, payload, body_kind in cases:
            header = tarfile.TarInfo('metadata')
            header.type, header.size = kind, len(payload)
            raw = header.tobuf(format=tarfile.GNU_FORMAT) + payload + bytes((-len(payload)) % 512)
            raw += layer([('a/b/c/d/e/file', b'', body_kind, 'a/b/c/target', {})])
            with self.subTest(kind=kind, payload=payload), self.assertRaisesRegex(
                    RuntimeError, 'FILESYSTEM_EMPTY_EXTENSION_UNPROVEN'):
                capacity.Accounting().inspect_layer(io.BytesIO(raw))

    def test_mixed_extension_families_are_rejected_in_either_order(self):
        def extension(kind, payload):
            header = tarfile.TarInfo('metadata')
            header.type, header.size = kind, len(payload)
            return header.tobuf(format=tarfile.GNU_FORMAT) + payload + bytes((-len(payload)) % 512)
        pax = extension(tarfile.XHDTYPE, b'14 path=short\n')
        for kind in [tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK]:
            gnu = extension(kind, b'a/b/c/d/e/file\0')
            for headers in [pax + gnu, gnu + pax]:
                with self.subTest(kind=kind, headers=headers[:1]), self.assertRaisesRegex(
                        RuntimeError, 'FILESYSTEM_MIXED_EXTENSIONS_UNPROVEN'):
                    capacity.Accounting().inspect_layer(io.BytesIO(headers + layer([
                        ('file', b'x', tarfile.REGTYPE, '', {})])))

    def test_consecutive_pax_maps_replace_instead_of_merging_paths(self):
        def extension(payload):
            header = tarfile.TarInfo('metadata')
            header.type, header.size = tarfile.XHDTYPE, len(payload)
            return header.tobuf(format=tarfile.USTAR_FORMAT) + payload + bytes((-len(payload)) % 512)
        raw = extension(b'14 path=short\n') + extension(b'11 mtime=0\n') + layer([
            ('a/b/c/d/e/file', b'x', tarfile.REGTYPE, '', {})])
        accounting = capacity.Accounting()
        row = accounting.inspect_layer(io.BytesIO(raw))
        self.assertEqual(row['implicitDirectoryCount'], 5)
        self.assertIn(b'a/b/c/d/e/file', accounting.known_sizes)
        self.assertNotIn(b'short', accounting.known_sizes)

    def test_many_tiny_files_cannot_hide_behind_the_tar_length(self):
        raw = layer([(f'dir/f-{n}', b'x', tarfile.REGTYPE, '', {}) for n in range(4096)])
        accounting = capacity.Accounting()
        row = accounting.inspect_layer(io.BytesIO(raw))
        proof = accounting.finish()
        self.assertEqual(row['diffId'], 'sha256:' + hashlib.sha256(raw).hexdigest())
        self.assertEqual(proof['entryCount'], 4096)
        self.assertGreater(proof['allocationUpperBoundBytes'], len(raw) * 5)
        self.assertGreaterEqual(proof['inodeUpperBound'], 4097)
        needed = capacity.requirements(proof, 1024, 0, 16)
        old_budget = len(raw) + 1024 ** 3 + 128 * 1024 ** 2 + 1024
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_IMPORT_BYTES_INSUFFICIENT'):
            capacity.admit(old_budget, 1000000, needed)
        capacity.admit(needed['requiredBeforeBytes'], needed['requiredInodes'], needed)
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_IMPORT_INODES_INSUFFICIENT'):
            capacity.admit(needed['requiredBeforeBytes'], needed['requiredInodes'] - 1, needed)

    def test_implicit_directories_symlinks_and_xattrs_get_explicit_space(self):
        raw = layer([('a/b/file', b'x', tarfile.REGTYPE, '', {'SCHILY.xattr.user.probe': 'v' * 9000}),
                     ('alias', b'', tarfile.SYMTYPE, 'a/b/file', {})], tarfile.PAX_FORMAT)
        accounting = capacity.Accounting()
        row = accounting.inspect_layer(io.BytesIO(raw))
        proof = accounting.finish()
        self.assertEqual(row['implicitDirectoryCount'], 2)
        self.assertGreaterEqual(row['xattrBytes'], 5 * 4096)
        self.assertGreater(proof['allocationUpperBoundBytes'], 1024 ** 2)
        self.assertFalse(proof['healthyApplicationPoint'])
        self.assertFalse(proof['publicOnlineAdmission'])

    def test_long_paths_work_in_gnu_and_pax_formats_without_unbounded_metadata(self):
        name = '/'.join(['long-directory'] * 15) + '/file'
        for format in [tarfile.GNU_FORMAT, tarfile.PAX_FORMAT]:
            with self.subTest(format=format):
                raw = layer([(name, b'body', tarfile.REGTYPE, '', {})], format)
                accounting = capacity.Accounting()
                row = accounting.inspect_layer(io.BytesIO(raw))
                self.assertEqual(row['expandedBytes'], len(raw))
                self.assertEqual(row['entryCount'], 1)
                self.assertGreater(accounting.finish()['allocationUpperBoundBytes'], 1024 ** 2)

    def test_hardlink_copy_up_is_charged_independently_of_physical_layer_order(self):
        accounting = capacity.Accounting()
        accounting.inspect_layer(io.BytesIO(layer([('middle', b'x', tarfile.REGTYPE, '', {}),
                                                   ('alias', b'', tarfile.LNKTYPE, 'middle', {})])))
        accounting.inspect_layer(io.BytesIO(layer([('middle', b'', tarfile.LNKTYPE, 'large', {}),
                                                   ('large', b'x' * 17000, tarfile.REGTYPE, '', {})])))
        proof = accounting.finish()
        self.assertGreaterEqual(proof['layers'][0]['dataAllocatedBytes'], 4096 + 20480)
        self.assertGreaterEqual(proof['layers'][1]['dataAllocatedBytes'], 40960)
        self.assertGreater(proof['layers'][1]['extentMetadataBytes'], 0)

    def test_dangling_links_and_unsupported_sparse_metadata_fail_closed(self):
        accounting = capacity.Accounting()
        accounting.inspect_layer(io.BytesIO(layer([('alias', b'', tarfile.LNKTYPE, 'missing', {})])))
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_HARDLINK_TARGET_UNPROVEN'):
            accounting.finish()
        raw = layer([('file', b'x', tarfile.REGTYPE, '', {'GNU.sparse.major': '1'})], tarfile.PAX_FORMAT)
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_SPARSE_UNPROVEN'):
            capacity.Accounting().inspect_layer(io.BytesIO(raw))

    def test_oversized_metadata_is_rejected_before_reading_its_payload(self):
        header = tarfile.TarInfo('metadata')
        header.type, header.size = tarfile.XHDTYPE, 1024 ** 2 + 1
        raw = header.tobuf(format=tarfile.USTAR_FORMAT)
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_METADATA_LIMIT'):
            capacity.Accounting().inspect_layer(io.BytesIO(raw))

    def test_bad_checksum_traversal_and_nonzero_trailing_bytes_are_refused(self):
        raw = layer([('file', b'x', tarfile.REGTYPE, '', {})])
        bad = bytearray(raw)
        bad[0] ^= 1
        for data, code in [(bytes(bad), 'FILESYSTEM_TAR_CHECKSUM_INVALID'),
                           (layer([('../outside', b'x', tarfile.REGTYPE, '', {})]), 'FILESYSTEM_TAR_PATH_UNSUPPORTED'),
                           (raw + b'x', 'FILESYSTEM_TAR_TRAILING_DATA')]:
            with self.subTest(code=code), self.assertRaisesRegex(RuntimeError, code):
                capacity.Accounting().inspect_layer(io.BytesIO(data))

    def test_repeated_short_extension_headers_and_padding_are_fully_charged(self):
        for kind, payload in [(tarfile.XHDTYPE, b'11 mtime=0\n'),
                              (tarfile.GNUTYPE_LONGNAME, b'file\0')]:
            with self.subTest(kind=kind):
                header = tarfile.TarInfo('metadata')
                header.type, header.size = kind, len(payload)
                extension = header.tobuf(format=tarfile.GNU_FORMAT) + payload + bytes((-len(payload)) % 512)
                body = layer([('file', b'x', tarfile.REGTYPE, '', {})])
                raw = extension * 100 + body
                accounting = capacity.Accounting()
                row = accounting.inspect_layer(io.BytesIO(raw))
                accounting.finish()
                self.assertEqual(row['regularPayloadBytes'], 1)
                self.assertEqual(row['rawMetadataBytes'], len(raw) - 1)
                self.assertEqual(row['tarSplitBytes'], 2 * (len(raw) - 1))
                self.assertGreaterEqual(row['tarSplitBytes'], 2 * len(extension) * 100)

    def test_zero_trailing_padding_increases_the_bound_instead_of_disappearing(self):
        raw = layer([('file', b'x', tarfile.REGTYPE, '', {})])
        base, padded = capacity.Accounting(), capacity.Accounting()
        base.inspect_layer(io.BytesIO(raw))
        extra = bytes(1024 * 1024)
        padded.inspect_layer(io.BytesIO(raw + extra))
        before, after = base.finish(), padded.finish()
        self.assertGreaterEqual(after['allocationUpperBoundBytes'] - before['allocationUpperBoundBytes'],
                                2 * len(extra))

    def test_symlink_resolution_and_target_xattr_copy_up_cannot_use_link_text_size(self):
        raw = layer([('large', b'x' * 17000, tarfile.REGTYPE, '', {'SCHILY.xattr.user.probe': 'v' * 9000}),
                     ('symlink', b'', tarfile.SYMTYPE, 'large', {}),
                     ('alias', b'', tarfile.LNKTYPE, 'symlink', {})], tarfile.PAX_FORMAT)
        accounting = capacity.Accounting()
        accounting.inspect_layer(io.BytesIO(raw))
        proof = accounting.finish()
        row = proof['layers'][0]
        self.assertEqual(row['hardlinkGlobalSizeFallbackCount'], 1)
        self.assertGreaterEqual(row['dataAllocatedBytes'], 20480 * 2 + 4096)
        self.assertGreaterEqual(row['xattrBytes'], 5 * 4096 * 2)
        self.assertGreaterEqual(row['inodeUpperBound'], 32 + 3 + 2)

    def test_unproven_allocation_unit_and_low_post_retirement_space_are_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_ALLOCATION_UNIT_UNPROVEN'):
            capacity.Accounting(8192)
        accounting = capacity.Accounting()
        accounting.inspect_layer(io.BytesIO(layer([('file', b'x', tarfile.REGTYPE, '', {})])))
        proof = accounting.finish()
        needed = capacity.requirements(proof, 4096, 4096, 16)
        with self.assertRaisesRegex(RuntimeError, 'FILESYSTEM_IMPORT_BYTES_INSUFFICIENT'):
            capacity.admit(needed['requiredAfterRetirementBytes'] - 1, needed['requiredInodes'], needed, True)


if __name__ == '__main__':
    unittest.main()
