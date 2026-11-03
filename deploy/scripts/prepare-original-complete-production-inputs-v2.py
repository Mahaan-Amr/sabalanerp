"""Render the unchanged canonical two-host preflight against the exact current
admission successor. Source/local private files only; no service action."""
import pathlib,hashlib,sys,runpy
ROOT=pathlib.Path(__file__).resolve().parents[2]
TEMPLATE=pathlib.Path('C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp/.scratch/prepare-native-source-a.py')
TEMPLATE_SHA='5af93df1704f3ff55667d929dfc2bce4fb1450ff64f713dd511f5b50b0b9eb5c'
def render_preparation_source(baseline_file):
 raw=TEMPLATE.read_bytes();assert hashlib.sha256(raw).hexdigest()==TEMPLATE_SHA;source=raw.decode();admission=ROOT/'deploy/scripts/original-complete-production-admission-v2.py'
 assert source.count("R8=Q/'C30-source-a-fixed-existing-gzip-stream-source-r8-third-restart-20261025'")==1
 name='419-complete-production-source-'+pathlib.Path(baseline_file).stem;assert not(pathlib.Path('D:/sabalanerp-online-qa')/name).exists()
 source=source.replace("R8=Q/'C30-source-a-fixed-existing-gzip-stream-source-r8-third-restart-20261025'",'R8=Q/'+repr(name))
 source=source.replace('ROOT=pathlib.Path(__file__).resolve().parent.parent','ROOT=pathlib.Path('+repr(str(ROOT))+')')
 assert source.count("admission=(ROOT/'scripts/lib/source-a-current-admission.py').read_bytes()")==1
 source=source.replace("admission=(ROOT/'scripts/lib/source-a-current-admission.py').read_bytes()",'admission=pathlib.Path('+repr(str(admission))+').read_bytes()')
 # The admission's source-directory lookup is fixed to this frozen checkout;
 # its hash-pinned diagnostic input is a historical backend-only observation.
 # A copied admission retains that literal root instead of __file__ ancestry.
 source=source.replace('for name,row in review[\'files\'].items():',"admission=admission.replace(b\"pathlib.Path(__file__).resolve().parents[2]\",b\"pathlib.Path(\"+repr(str(ROOT)).encode()+b\")\")\n for name,row in review['files'].items():")
 compile(source,'fixed-canonical-two-host-preflight-constructor','exec');return source

def prepare(baseline_file,baseline_sha):
 source=render_preparation_source(baseline_file);sys.argv=['fixed_complete_production_preparation',baseline_file,baseline_sha];exec(compile(source,'fixed-canonical-two-host-preflight-constructor','exec'),{'__name__':'__main__','__file__':str(TEMPLATE)})
if __name__=='__main__':assert len(sys.argv)==3;prepare(*sys.argv[1:])
