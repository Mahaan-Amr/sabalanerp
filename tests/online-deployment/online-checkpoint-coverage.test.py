import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('coverage', Path(__file__).parents[2] / 'deploy/scripts/online-checkpoint-coverage.py')
coverage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(coverage)


def components():
    source = dict(databaseName='example', databaseOid='42', systemIdentifier='123456', timeline=1, segmentBytes=16777216)
    configuration = dict(source, startLsn='0/1000028', endLsn='0/9000000')
    receiver = dict(phase='COMPLETE', nativeReaped=True, databaseQuiet=True, nativeStatus=0,
                    source=source, startLsn=configuration['startLsn'], endLsn=configuration['endLsn'])
    receiver['segments'] = [dict(name=name, bytes=source['segmentBytes'], sha256='a' * 64)
                            for name in coverage.segment_names(1, receiver['startLsn'], receiver['endLsn'], source['segmentBytes'])]
    base = dict(format='sabalan-private-physical-base/v1', status='NATIVE_VERIFIED_PRIVATE_ONLY',
                source=dict(systemIdentifier='123456', timeline=1),
                walRanges=[{'Timeline': 1, 'Start-LSN': '0/2000028', 'End-LSN': '0/3000028'}])
    captured = dict(format='sabalan-coherent-component/v3', phase='CAPTURED_AWAITING_NATIVE_CLOSURE', productionRecoveryPoint=False,
                    database=dict(systemIdentifier='123456', database='example', databaseOid='42'),
                    restorePoint=dict(lsn='0/4000028', requiredWalEndLsn='0/5000000', walFile='000000010000000000000004',
                                      segmentBytes=16777216, flushLsn='0/4000028'),
                    versionedCuts=[dict(name=f'root-{i}') for i in range(9)], sqliteSnapshot=dict(source={'path': '/private/inquiry.db'}, bytes=4096))
    return base, captured, receiver, configuration


class CoverageTests(unittest.TestCase):
    def test_plan_starts_at_current_lsn_and_never_extends_eight_segments(self):
        result = coverage.plan_receiver(dict(currentLsn='0/1000028', timeline=1, segmentBytes=16777216))
        self.assertEqual(result['startLsn'], '0/1000028')
        self.assertEqual(result['endLsn'], '0/9000000')
        self.assertEqual(len(coverage.segment_names(1, result['startLsn'], result['endLsn'], result['segmentBytes'])), 8)
        for count in (0, 9, True, '8'):
            with self.assertRaises(RuntimeError):
                coverage.plan_receiver(dict(currentLsn='0/1000028', timeline=1, segmentBytes=16777216), count)

    def test_exact_coverage_is_data_only(self):
        result = coverage.validate_coverage(*components())
        for key in ('productionAdmission', 'nativeClosureQualified', 'independentRestoreQualified'):
            self.assertIs(result[key], False)

    def test_target_at_server_segment_boundary_is_covered(self):
        values = components()
        values[1]['restorePoint'].update(lsn='0/5000000', flushLsn='0/5000000')
        self.assertEqual(coverage.validate_coverage(*values)['restorePointLsn'], '0/5000000')

    def test_missing_or_corrupted_segment_is_refused(self):
        for mutate in (lambda r: r['segments'].pop(), lambda r: r['segments'].reverse(),
                       lambda r: r['segments'][0].update(bytes=1), lambda r: r['segments'][0].update(sha256='invalid')):
            values = components()
            mutate(values[2])
            with self.assertRaisesRegex(RuntimeError, 'COMPLETE_SEGMENT_SET_REQUIRED'):
                coverage.validate_coverage(*values)

    def test_wrong_cluster_database_and_timeline_are_refused(self):
        for target, field, value in ((0, 'systemIdentifier', '999'), (0, 'timeline', 2),
                                     (1, 'databaseOid', '999'), (1, 'database', 'different')):
            values = components()
            values[target]['source' if target == 0 else 'database'][field] = value
            with self.assertRaisesRegex(RuntimeError, 'SOURCE_CHANGED'):
                coverage.validate_coverage(*values)

    def test_base_after_target_or_outside_receiver_range_is_refused(self):
        for change in ({'Start-LSN': '0/1'}, {'End-LSN': '0/6000028'}, {'End-LSN': '0/2000028'}):
            values = components()
            values[0]['walRanges'][0].update(change)
            with self.assertRaisesRegex(RuntimeError, 'BASE_TARGET_NOT_COVERED'):
                coverage.validate_coverage(*values)

    def test_unclosed_capture_and_unflushed_target_are_refused(self):
        for change in ({'nativeReaped': False}, {'databaseQuiet': False}, {'nativeStatus': 1}, {'phase': 'ACTIVE'}):
            values = components()
            values[2].update(change)
            with self.assertRaisesRegex(RuntimeError, 'WAL_CLOSED_COMPONENT_REQUIRED'):
                coverage.validate_coverage(*values)
        values = components()
        values[1]['restorePoint']['flushLsn'] = '0/4000027'
        with self.assertRaisesRegex(RuntimeError, 'POINT_NOT_FLUSHED'):
            coverage.validate_coverage(*values)

    def test_cross_log_and_overflow_bounds(self):
        self.assertEqual(coverage.segment_names(1, '0/FF000000', '1/1000000', 16777216),
                         ['0000000100000000000000FF', '000000010000000100000000'])
        with self.assertRaises(RuntimeError):
            coverage.plan_receiver(dict(currentLsn='FFFFFFFF/FFFFFFFF', timeline=1, segmentBytes=16777216))


if __name__ == '__main__':
    unittest.main()
