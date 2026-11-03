import json
import pathlib
import subprocess
p = pathlib.Path(__file__).resolve().parent
actual = json.loads(subprocess.check_output(['gh', 'issue', 'view', '409', '--repo', 'Mahaan-Amr/sabalanerp', '--json', 'body'], encoding='utf-8'))['body']
expected = (p / 'published/01-namespace-owner.md').read_text(encoding='utf-8')
print(json.dumps({'actualLength': len(actual), 'expectedLength': len(expected), 'actualCRLF': actual.count('\r\n'), 'sameAfterLineEndingNormalization': actual.replace('\r\n', '\n') == expected, 'sameAfterFinalWhitespaceNormalization': actual.replace('\r\n', '\n').rstrip() == expected.rstrip()}))
