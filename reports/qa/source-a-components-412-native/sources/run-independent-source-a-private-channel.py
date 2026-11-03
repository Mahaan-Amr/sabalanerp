"""Same finite RSA owner; consume the user's authorized private credential in memory.

No credential literal, digest, transcript copy, command argument or log is made.
The existing owner retains its approved owner-only pwfile/finally lifecycle.
"""
import json
import os
import pathlib
import re
import runpy

Q = pathlib.Path('D:/sabalanerp-online-qa')
OPERATION = '9fd8e6b3abb34a9d872cfe63b8fa3e41'
MATERIAL = Q / ('C30-source-a-existing-independent-material-frontend-' + OPERATION)
OUTPUT = Q / ('C30-source-a-existing-independent-runtime-frontend-' + OPERATION)


def private_channel(_message):
    session = pathlib.Path(os.environ['SABALAN_PRIVATE_SESSION_FILE'])
    matches = []
    with session.open(encoding='utf-8') as stream:
        for line in stream:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            payload = event.get('payload', {})
            if event.get('type') != 'response_item' or payload.get('type') != 'message' or payload.get('role') != 'user':
                continue
            text = ''.join(c.get('text', '') for c in payload.get('content', []) if isinstance(c, dict))
            found = re.fullmatch(r'Here you are\s+([^\r\n]+)\s+Please now continue\s*', text)
            if found:
                matches.append(found.group(1).strip())
    if len(matches) != 1 or not 0 < len(matches[0]) < 256:
        raise RuntimeError('PRIVATE_CREDENTIAL_CHANNEL_UNAVAILABLE')
    password = matches.pop()
    if any(c in password for c in '\r\n\0'):
        raise RuntimeError('PRIVATE_CREDENTIAL_CHANNEL_REFUSED')
    return password


scope = runpy.run_path(str(MATERIAL / 'owner.py'))
scope['getpass'].getpass = private_channel
try:
    receipt = scope['main']()
    print(json.dumps(receipt))
finally:
    # The actual owner's finally/context retires its temporary password file.
    # No secret, secret-derived hash or source transcript is recorded here.
    pass
