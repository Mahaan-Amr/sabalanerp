"""Original Inquiry RO readback; load_scope proves mount identity and no RW
alias. This reader cannot publish, start, adopt, seed, migrate or retire anything.
"""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys


def require(value):
    if not value: raise RuntimeError('ORIGINAL_INQUIRY_RO_READBACK_UNPROVEN')


def main():
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    raw = sys.stdin.buffer.read(65537); require(0 < len(raw) <= 65536); p = json.loads(raw)
    require(set(p) == {'operation','grant','trustSha256'} and re.fullmatch(r'[a-f0-9]{32}',p['operation']))
    root = Path('/app/recovery-coordination/complete-inquiry-'+p['operation']); require(root.resolve(strict=True) == root)
    config_raw = (root/'owner-config.json').read_bytes(); config = json.loads(config_raw)
    file = root/'helpers/online-runtime-scope.py'; require(hashlib.sha256(file.read_bytes()).hexdigest() == config['helperPins'][file.name])
    spec = importlib.util.spec_from_file_location('original_inquiry_ro_scope',file); module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    loaded = module.load_scope(config['scopeEnvironment']); grant = p['grant']
    require(loaded['sha256'] == grant['sha256'] and loaded['scope']['runtimeId']+'.json' == grant['name'])
    require(Path(loaded['file']).read_bytes() == base64.b64decode(grant['rawBase64'],validate=True))
    key = Path('/run/sabalan-online/qualification-controller-public-key.pem'); require(key.resolve(strict=True) == key)
    s = key.lstat(); require(s.st_uid == 0 and s.st_nlink == 1 and s.st_mode&0o777 == 0o444 and 0 < s.st_size <= 4096)
    require(hashlib.sha256(key.read_bytes()).hexdigest() == p['trustSha256'])
    print(json.dumps(dict(published=True,sha256=grant['sha256'],mountId=loaded['mountId'],mountNamespace=loaded['mountNamespace'],productionAdmission=False)),flush=True)


if __name__ == '__main__': main()
