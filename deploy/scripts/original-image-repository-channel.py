"""Full ciphertext retrieval on the same original authenticated channel.

This codec has no SSH, key, filesystem mutation or completion authority. Exact
requests come from the image owner; neither server claims nor stored JSON can
stand in for the client's complete byte stream and ACK.
"""
import hashlib
import json

CHUNK = 262144
BOUND = 65536


class RepositoryNegative(RuntimeError):
    def __init__(self,value):
        super().__init__('IMAGE_REPOSITORY_REMOTE_NEGATIVE')
        self.repository_negative=value


def reject_negative(event):
    if isinstance(event,dict) and event.get('event')=='IMAGE_REPOSITORY_NEGATIVE':
        raise RepositoryNegative(event)


def known_remote_row_closed(row):
    if not isinstance(row,dict) or 'observationFault' not in row:return False
    if type(row.get('pid')) is not int or row['pid']<=0 or type(row.get('code')) is not int or row['code'] not in [0,1]:return False
    if not all(row.get(key) is True for key in ['pipesClosed','stdoutEof','stderrEof']):return False
    if row.get('observationFault') is None:return True
    proof=row.get('exceptionalDrainProof')
    return proof==dict(format='sabalan-same-original-verifier-drain/v1',pid=row['pid'],code=row['code'],stdoutEof=True,stderrEof=True,actualWaitObserved=True,maximumReadBytes=65536,retainedOutputBytes=0,signalSent=False,replacementChildStarted=False)


def require(value, code):
    if not value:
        raise RuntimeError(code)


def frame(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def read_frame(source):
    raw = source.readline(BOUND + 1)
    require(0 < len(raw) <= BOUND and raw.endswith(b'\n'), 'IMAGE_CHANNEL_FRAME_BOUND')
    return json.loads(raw)


def write_frame(sink, value):
    raw = frame(value)
    require(len(raw) <= BOUND and sink.write(raw) == len(raw), 'IMAGE_CHANNEL_SHORT_WRITE')
    sink.flush()


def retrieval_binding(wanted):
    require(set(wanted) == {'event','format','operation','role','sequence','path','bytes','sha256'}, 'IMAGE_RETRIEVAL_REQUEST_FIELDS')
    require(wanted['format'] == 'sabalan-original-image-transfer/v1' and wanted['event'] == 'IMAGE_TRANSFER_REQUEST', 'IMAGE_RETRIEVAL_REQUEST_FORMAT')
    require(type(wanted['sequence']) is int and wanted['sequence'] in range(3)
            and wanted['role'] == ('backend','inquiry','frontend')[wanted['sequence']], 'IMAGE_RETRIEVAL_ROLE_ORDER')
    require(type(wanted['bytes']) is int and 0 < wanted['bytes'] <= 2**31, 'IMAGE_RETRIEVAL_COUNT')
    import re
    require(re.fullmatch('[a-f0-9]{32}', wanted['operation']) is not None
            and re.fullmatch('[a-f0-9]{64}', wanted['sha256']) is not None, 'IMAGE_RETRIEVAL_IDENTITY')
    return dict(operation=wanted['operation'], role=wanted['role'], sequence=wanted['sequence'],
                bytes=wanted['bytes'], sha256=wanted['sha256'], requestSha256=hashlib.sha256(frame(wanted)).hexdigest())


def receive_retrieval(source, sink, wanted, assert_current):
    """Hash every byte; no plaintext or redundant local ciphertext file."""
    binding = retrieval_binding(wanted)
    assert_current()
    event=read_frame(source);reject_negative(event)
    require(event == dict(event='IMAGE_RETRIEVAL_BEGIN', **binding), 'IMAGE_RETRIEVAL_HEADER_CHANGED')
    remaining = binding['bytes']
    digest = hashlib.sha256()
    while remaining:
        assert_current()
        raw = source.read(min(CHUNK, remaining))
        require(raw and len(raw) <= remaining, 'IMAGE_RETRIEVAL_TRUNCATED')
        digest.update(raw)
        remaining -= len(raw)
    require(digest.hexdigest() == binding['sha256'], 'IMAGE_RETRIEVAL_CIPHER_CHANGED')
    assert_current()
    receipt = dict(event='IMAGE_RETRIEVAL_ACK', **binding)
    write_frame(sink, receipt)
    return dict(**binding, actualClientBytesHashed=True, plaintextReturned=False)


def send_retrieval(source, output, control_input, wanted, assert_current):
    binding = retrieval_binding(wanted)
    assert_current()
    write_frame(output, dict(event='IMAGE_RETRIEVAL_BEGIN', **binding))
    remaining = binding['bytes']
    digest = hashlib.sha256()
    while remaining:
        assert_current()
        raw = source.read(min(CHUNK, remaining))
        require(raw and len(raw) <= remaining, 'IMAGE_RETRIEVAL_STORED_TRUNCATED')
        require(output.write(raw) == len(raw), 'IMAGE_RETRIEVAL_SHORT_WRITE')
        digest.update(raw)
        remaining -= len(raw)
    output.flush()
    require(digest.hexdigest() == binding['sha256'], 'IMAGE_RETRIEVAL_STORED_CHANGED')
    assert_current()
    require(read_frame(control_input) == dict(event='IMAGE_RETRIEVAL_ACK', **binding), 'IMAGE_RETRIEVAL_ACK_CHANGED')
    return dict(**binding, actualClientAcknowledgement=True)
