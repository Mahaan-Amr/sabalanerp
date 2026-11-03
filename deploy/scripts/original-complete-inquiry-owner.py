"""Original private Inquiry probe owner inside the existing Inquiry carrier.

Fixed operation-local files and anonymous pipes only. No seed, migration,
adoption, caller command, signal-by-PID, main SQLite write or public listener.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import select
import sys
import time
import urllib.request


def require(value):
    if not value:
        raise RuntimeError('ORIGINAL_COMPLETE_INQUIRY_UNPROVEN')


def load_probe():
    file = Path(__file__).resolve(strict=True).with_name('restored-inquiry-probe.py')
    spec = importlib.util.spec_from_file_location('complete_original_probe', file)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


def encoded(raw):
    require(0 < len(raw) <= 1024**2)
    return dict(bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest(), rawBase64=base64.b64encode(raw).decode())


class OriginalInquiryCancellation(BaseException):
    pass


class OriginalInquirySignals:
    """Sticky cancellation, never forwarded to an unproven descendant PID."""
    def __init__(self):
        self.cancelled, self.draining = False, False
        self.previous = {sig: signal.getsignal(sig) for sig in [signal.SIGINT, signal.SIGTERM]}
        for sig in self.previous: signal.signal(sig, self.cancel)

    def cancel(self, *_):
        self.cancelled = True

    def check(self):
        if self.cancelled: raise OriginalInquiryCancellation()

    def read_frame(self, stream):
        # Never throw asynchronously across Popen returning/handle assignment.
        # A cancellable pipe read polls only at an owned protocol boundary.
        raw = bytearray()
        while len(raw) <= 4096:
            self.check()
            if not select.select([stream.fileno()], [], [], .1)[0]: continue
            part = os.read(stream.fileno(), 1)
            require(part)
            raw.extend(part)
            if part == b'\n': return bytes(raw)
        require(False)

    def close_after_originals(self):
        for sig, handler in self.previous.items(): signal.signal(sig, handler)


class OriginalInquiryReader:
    def __init__(self, probe):
        self.probe, self.borrow, self.records, self.retired = probe, None, None, None
        self.phase = 'RUNNING'

    def dispatch(self, command):
        require(isinstance(command, str) and command in ['BORROW', 'RELEASE', 'READY', 'STOP', 'RECORDS', 'RETIRE', 'RETIREMENT', 'BINDING', 'FINISH'])
        p = self.probe
        if command == 'BORROW':
            require(self.phase == 'RUNNING' and self.borrow is None)
            self.borrow = p.reader(); self.borrow.__enter__()
            return dict(borrowed=True)
        if command == 'RELEASE':
            require(self.phase == 'RUNNING' and self.borrow is not None)
            self.borrow.__exit__(None, None, None); self.borrow = None
            require(p.readers == 0)
            return dict(readers=0)
        if command == 'READY':
            require(self.phase == 'RUNNING' and self.borrow is not None and p.actor.poll() is None)
            try:
                value = p.observe_ready()
                with urllib.request.urlopen(value['endpoint']+'/admin/login', timeout=2) as response:
                    raw = response.read(1024**2+1); require(response.status == 200 and 0 < len(raw) <= 1024**2)
                value['loginResponse'] = dict(status=200, **encoded(raw))
                return value
            except urllib.error.HTTPError:
                raise  # An actual negative application response is not pending.
            except (FileNotFoundError, ConnectionError, TimeoutError, urllib.error.URLError, p.NotReady):
                require(p.actor.poll() is None)
                return dict(ready=False)
        if command == 'STOP':
            require(self.phase == 'RUNNING' and self.borrow is None and p.readers == 0)
            if not hasattr(p, 'active_raw'):
                p.observe_active_for_retirement()
            value = p.stop(); require(p.actor.poll() == 128 and p.log.closed)
            self.phase = 'CLOSED'
            return value
        if command == 'RECORDS':
            require(self.phase == 'CLOSED' and self.borrow is None)
            value = dict(activeNative=encoded(p.active_raw), finalNative=encoded(p.native_file.read_bytes()),
                         requestedStop=encoded((p.root/'requested-stop.json').read_bytes()), work=encoded(p.work_file.read_bytes()),
                         workClaim=encoded(p.work_file.with_name('claim.json').read_bytes()), workScope=encoded(p.work_file.with_name('scope.json').read_bytes()))
            if self.records is not None: require(self.records == value)
            self.records = value
            return value
        if command == 'RETIRE':
            require(self.phase == 'CLOSED' and self.records is not None and self.borrow is None)
            require(self.dispatch('RECORDS') == self.records)
            p.retire(); self.retired = encoded(p.retired_file.read_bytes()); self.phase = 'RETIRED'
            return dict(retired=True)
        if command == 'RETIREMENT':
            require(self.phase == 'RETIRED' and self.retired == encoded(p.retired_file.read_bytes()))
            return self.retired
        if command == 'BINDING':
            require(self.phase in ['RUNNING', 'CLOSED', 'RETIRED'])
            return dict(scope=p.loaded, inputSqlite=p.input_receipt, originalDatabase=p.original_before)
        require(self.phase == 'RETIRED' and self.borrow is None and p.actor.poll() == 128 and p.log.closed and p.readers == 0)
        self.phase = 'FINISHED'
        return dict(originalPopenPid=p.actor.pid, wrapperStatus=p.actor.returncode, nativeStatus=143,
                    productionAdmission=False)


def main():
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize and len(sys.argv) == 3)
    operation, expected = sys.argv[1:]
    require(re.fullmatch(r'[a-f0-9]{32}', operation) and re.fullmatch(r'[a-f0-9]{64}', expected))
    root = Path('/app/recovery-coordination/complete-inquiry-'+operation)
    require(root.resolve(strict=True) == root and Path(__file__).resolve(strict=True).parent == root/'helpers')
    module = load_probe(); raw = (root/'owner-config.json').read_bytes(); require(hashlib.sha256(raw).hexdigest() == expected)
    config = json.loads(raw)
    require(set(config) == {'operation', 'restoredSha256', 'originalDatabase', 'scopeEnvironment', 'selection', 'helperPins'})
    require(config['operation'] == operation)
    for name, digest in config['helperPins'].items():
        require(Path(name).name == name and module.stable_file(root/'helpers'/name)['sha256'] == digest)
    require(module.sqlite_snapshot('/data/inquiry.db') == config['originalDatabase'])
    probe = None
    signals = OriginalInquirySignals()
    try:
        probe = module.RestoredInquiryProbe.prepare(root, operation, root/'restored-input.db', config['restoredSha256'], '/data/inquiry.db')
        # Same image-owned canonical verifier, on this further PRIVATE copy.
        # Its baseline/helper files were pinned before UP; no bootstrap fallback.
        readers_module = module.module(Path(__file__).with_name('original-restored-resource-observer.py'), 'complete_inquiry_verifier_readers')
        verifier = readers_module.OriginalReaders()
        try:
            out = verifier.run(['/usr/local/bin/node', '-e', "require('/app/verify-inquiry-database.cjs').verifyInquiryDatabase(process.argv[1]);", str(probe.database)], maximum=4096)
        finally:
            verifier_closure = verifier.close()
        require(out == b'' and not verifier_closure['failed'] and not verifier_closure['cancelled'])
        require(module.sqlite_snapshot('/data/inquiry.db') == config['originalDatabase'])
        signals.check()
        probe.start(config['scopeEnvironment'], 3289, root/'helpers/inquiry-requested-stop.py', config['selection'])
        owner = OriginalInquiryReader(probe)
        require(not signals.cancelled)
        print(json.dumps(dict(event='ORIGINAL_STARTED', originalPopenPid=probe.actor.pid, productionAdmission=False)), flush=True)
        sequence = 0
        while owner.phase != 'FINISHED':
            raw = signals.read_frame(sys.stdin.buffer)
            require(0 < len(raw) <= 4096 and raw.endswith(b'\n'))
            frame = json.loads(raw); require(set(frame) == {'sequence', 'command'} and frame['sequence'] == sequence+1)
            require(not signals.cancelled)
            sequence += 1; result = owner.dispatch(frame['command'])
            output = json.dumps(dict(sequence=sequence, command=frame['command'], result=result), separators=(',', ':'))
            require(len(output.encode()) <= 8*1024**2)
            print(output, flush=True)
        require(module.sqlite_snapshot('/data/inquiry.db') == config['originalDatabase'])
    except BaseException:
        signals.draining = True
        # A negative owner retains its SAME original. When ACTIVE/quiescent is
        # provable, request canonical retirement without claiming readiness.
        if probe is not None and probe.actor is not None:
            if probe.actor.poll() is None:
                try:
                    if probe.readers: raise RuntimeError('ORIGINAL_BORROW_STILL_OPEN')
                    if not hasattr(probe, 'active_raw'): probe.observe_active_for_retirement()
                    probe.stop()
                except BaseException:
                    while probe.actor.poll() is None: time.sleep(.1)
            while True:
                try: probe.actor.wait(); break
                except BaseException: time.sleep(.05)
            if probe.log is not None and not probe.log.closed: probe.log.close()
        # Never retire failed evidence or erase private input/journal files.
        print('ORIGINAL_COMPLETE_INQUIRY_NEGATIVE', file=sys.stderr, flush=True)
        raise SystemExit(1)
    finally:
        signals.close_after_originals()


if __name__ == '__main__':
    main()
