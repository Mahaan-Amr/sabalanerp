"""Test-owned exercise of the exact producer and native consumer helpers.
Never references the fixed operational package or lease. Preserve test roots.
"""
import hashlib,importlib.util,json,os,tempfile,uuid
from pathlib import Path
LIB=Path(__file__).resolve().parents[2]/"scripts"/"lib"
def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
producer=module("package_producer",LIB/"reconciliation-phase1-package-review.py")
consumer=module("package_consumer",LIB/"reconciliation-phase1-native-launcher.py")
root=Path(tempfile.gettempdir())/("sabalan-phase1-package-fixture-"+uuid.uuid4().hex);root.mkdir()
def digest(raw):return hashlib.sha256(raw).hexdigest()
# No secrets or real operation data are used.
blobs=[b"fixture-review",b"fixture-index",b"fixture-manifest",b"fixture-anchor"]
package,complete=producer.publish_package(root,*blobs,None)
consumer.verify_package(package,digest(complete))
# A change to a reviewed component must stop the actual consumer verifier.
(package/"phase1-reviewed-manifest.json").write_bytes(b"fixture-tampered")
try:consumer.verify_package(package,digest(complete))
except RuntimeError as e:
 if str(e)!="PACKAGE_FILE_MISMATCH":raise
else:raise AssertionError("TAMPER_ACCEPTED")
# A separate, never-completed synthetic package is rejected before execution.
partial=root/("phase1-package-"+uuid.uuid4().hex);partial.mkdir()
try:consumer.verify_package(partial,"0"*64)
except FileNotFoundError:pass
else:raise AssertionError("PARTIAL_ACCEPTED")
print(json.dumps({"fixtureOnly":True,"root":str(root),"sameProducerConsumer":True,"tamperRejected":True,"missingCompleteRejected":True,"directoryDurability":"UNKNOWN"}))
