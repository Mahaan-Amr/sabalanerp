"""Qualify an explicitly requested diagnostic Next retirement, never natural zero."""


def qualify_requested_stop(request, initial, final, wrapper_status):
    assert type(request) is dict and type(initial) is dict and type(final) is dict
    assert request['format'] == 'sabalan-private-inquiry-requested-stop/v1'
    assert request['signal'] == 'SIGTERM' and request['expectedNativeStatus'] == 143
    assert request['naturalExitZeroExpected'] is False
    assert initial['phase'] == 'ACTIVE' and request['guardian'] == initial['guardian']
    assert type(request['activeClaimSha256']) is str and len(request['activeClaimSha256']) == 64
    assert wrapper_status == 128 and final['phase'] == 'QUIESCENT'
    assert all(final[key] is True for key in ['nativeReaped', 'sqliteNativeClosed', 'stoppedBySignal'])
    assert final['guardian'] == request['guardian']
    assert final['activeClaimSha256'] == request['activeClaimSha256']
    assert final['nativeStatus'] == 143
    return {'retiredByRequestedSigterm': True, 'nativeStatus': 143, 'naturalExitZero': False}
