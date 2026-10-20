"""Exact physical-base/WAL/coherent-cut arithmetic, with no admission authority.

The original controller must start the bounded receiver BEFORE base/cut capture.
These checks cannot manufacture native closure, remote verification or health.
"""
import re


def require(value, code):
    if not value:
        raise RuntimeError('ONLINE_CHECKPOINT_' + code)


def lsn(value):
    require(isinstance(value, str) and re.fullmatch(
        r'(0|[1-9A-F][0-9A-F]{0,7})/(0|[1-9A-F][0-9A-F]{0,7})', value), 'LSN_INVALID')
    high, low = value.split('/')
    return (int(high, 16) << 32) | int(low, 16)


def text_lsn(value):
    require(type(value) is int and 0 <= value < 2**64, 'LSN_INVALID')
    return f'{value >> 32:X}/{value & 0xffffffff:X}'


def segment_size(value):
    require(type(value) is int and 2**20 <= value <= 2**30
            and value & (value - 1) == 0, 'SEGMENT_INVALID')
    return value


def segment_names(timeline, start, end, size):
    segment_size(size)
    require(type(timeline) is int and 0 < timeline <= 0xffffffff, 'TIMELINE_INVALID')
    begin, finish = lsn(start), lsn(end)
    require(begin < finish and 1 <= (finish - 1) // size - begin // size + 1 <= 8,
            'BOUNDED_RANGE_REQUIRED')
    per_log = 2**32 // size
    return [f'{timeline:08X}{index // per_log:08X}{index % per_log:08X}'
            for index in range(begin // size, (finish - 1) // size + 1)]


def plan_receiver(profile, maximum_segments=8):
    require(type(maximum_segments) is int and 1 <= maximum_segments <= 8, 'BOUNDED_RANGE_REQUIRED')
    size = segment_size(profile['segmentBytes'])
    start = lsn(profile['currentLsn'])
    end = (start // size + maximum_segments) * size
    require(end < 2**64, 'LSN_OVERFLOW')
    result = {'startLsn': text_lsn(start), 'endLsn': text_lsn(end),
              'timeline': profile['timeline'], 'segmentBytes': size}
    segment_names(result['timeline'], result['startLsn'], result['endLsn'], size)
    return result


def validate_coverage(base, captured, receiver, configuration):
    """Bind raw canonical component fields; caller separately owns every child.

    The coherent worker deliberately records productionRecoveryPoint=False. Its
    raw value stays false; a new aggregate must independently qualify all parts.
    """
    require(base.get('format') == 'sabalan-private-physical-base/v1'
            and base.get('status') == 'NATIVE_VERIFIED_PRIVATE_ONLY', 'BASE_FORMAT')
    require(captured.get('format') == 'sabalan-coherent-component/v3'
            and captured.get('phase') == 'CAPTURED_AWAITING_NATIVE_CLOSURE'
            and captured.get('productionRecoveryPoint') is False, 'CUT_FORMAT')
    require(receiver.get('phase') == 'COMPLETE' and receiver.get('nativeReaped') is True
            and receiver.get('databaseQuiet') is True and receiver.get('nativeStatus') == 0,
            'WAL_CLOSED_COMPONENT_REQUIRED')
    source = receiver['source']
    for field in ('databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes'):
        require(source[field] == configuration[field], 'SOURCE_CHANGED')
    require(base['source']['systemIdentifier'] == source['systemIdentifier']
            and base['source']['timeline'] == source['timeline']
            and captured['database']['systemIdentifier'] == source['systemIdentifier']
            and captured['database']['database'] == source['databaseName']
            and captured['database']['databaseOid'] == source['databaseOid'], 'SOURCE_CHANGED')
    require(receiver['startLsn'] == configuration['startLsn']
            and receiver['endLsn'] == configuration['endLsn'], 'RANGE_CHANGED')
    size = segment_size(source['segmentBytes'])
    start, end = lsn(receiver['startLsn']), lsn(receiver['endLsn'])
    require(end % size == 0, 'ALIGNED_END_REQUIRED')
    ranges = base['walRanges']
    require(isinstance(ranges, list) and len(ranges) == 1, 'BASE_RANGE_INVALID')
    item = ranges[0]
    base_start, base_end = lsn(item['Start-LSN']), lsn(item['End-LSN'])
    point = captured['restorePoint']
    target, required_end = lsn(point['lsn']), lsn(point['requiredWalEndLsn'])
    require(item['Timeline'] == source['timeline'] and point['segmentBytes'] == size,
            'TIMELINE_CHANGED')
    require(start <= base_start < base_end <= target <= required_end <= end,
            'BASE_TARGET_NOT_COVERED')
    # A boundary LSN belongs to the segment preceding it in PostgreSQL's
    # pg_walfile_name(); use the actual server-produced name to verify that end.
    require(isinstance(point['walFile'], str) and re.fullmatch(r'[0-9A-F]{24}', point['walFile']),
            'POINT_SEGMENT_INVALID')
    name = point['walFile']
    require(int(name[:8], 16) == source['timeline'], 'TIMELINE_CHANGED')
    named_end = int(name[8:16], 16) * 2**32 + (int(name[16:], 16) + 1) * size
    require(named_end == required_end and lsn(point['flushLsn']) >= target,
            'POINT_NOT_FLUSHED')
    names = segment_names(source['timeline'], receiver['startLsn'], receiver['endLsn'], size)
    segments = receiver['segments']
    require(isinstance(segments, list) and [row.get('name') for row in segments] == names
            and all(row.get('bytes') == size and isinstance(row.get('sha256'), str)
                    and re.fullmatch(r'[a-f0-9]{64}', row['sha256']) for row in segments),
            'COMPLETE_SEGMENT_SET_REQUIRED')
    require(isinstance(captured.get('versionedCuts'), list) and len(captured['versionedCuts']) == 9
            and len({row.get('name') for row in captured['versionedCuts']}) == 9,
            'NINE_FILE_CUTS_REQUIRED')
    require(captured['sqliteSnapshot']['source'] is not None
            and captured['sqliteSnapshot']['bytes'] > 0, 'SQLITE_SNAPSHOT_REQUIRED')
    return {'format': 'sabalan-online-checkpoint-byte-coverage/v1',
            'database': {key: source[key] for key in ('databaseName', 'databaseOid', 'systemIdentifier')},
            'timeline': source['timeline'], 'segmentBytes': size,
            'startLsn': receiver['startLsn'], 'endLsn': receiver['endLsn'],
            'restorePointLsn': point['lsn'], 'segmentNames': names,
            'nativeClosureQualified': False, 'independentRestoreQualified': False,
            'productionAdmission': False}
