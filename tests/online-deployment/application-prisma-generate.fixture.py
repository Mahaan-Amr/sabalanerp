"""Pure code generation in an original native guardian, in a private cwd."""
import importlib.util
import json
import os
from pathlib import Path
import re
import sys

os.umask(0o077)
root = Path(sys.argv[1])
assert re.fullmatch(r'/tmp/application-prisma-[a-f0-9]{32}', str(root)) and root.resolve(strict=True) == root
os.chdir(root)
assert not (root / '.env').exists()


def check(value, message):
    if not value:
        raise RuntimeError(message)


def write(file, data, mode=0o400):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(os.dup(fd), 'wb') as out:
            out.write(data); out.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


spec = importlib.util.spec_from_file_location('private_native_generator', root / 'application-native-prisma.fixture.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
shared = module.inventory(Path('/app/node_modules/.prisma/client'), check)
proof = module.assemble_host(root, write, encoded, check) if os.environ.get('PRISMA_PRIVATE_HOST_ARTIFACT') == '1' else module.generate(root, write, encoded, check)
check(module.inventory(Path('/app/node_modules/.prisma/client'), check) == shared, 'PRIVATE_PRISMA_SHARED_CLIENT_CHANGED')
print(json.dumps(dict(generated=True, proof=proof, sharedClientUnchanged=True, sharedClientInventory=shared)))
