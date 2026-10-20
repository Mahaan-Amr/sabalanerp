"""Small real verifier/file tests, not release or native application admission."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

source=Path(__file__).resolve().parents[2]/'deploy/scripts/online-inquiry-inner-controller.py'
spec=importlib.util.spec_from_file_location('original_inquiry_inner',source)
module=importlib.util.module_from_spec(spec)
if sys.platform=='linux':spec.loader.exec_module(module)

@unittest.skipUnless(sys.platform=='linux','Linux file ownership and actual fixed Node verifier required')
class OriginalInquiryInnerTests(unittest.TestCase):
    def test_source_bytes_are_private_original_regular_files_and_aliases_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'source';file.write_bytes(b'actual source');file.chmod(0o400)
            self.assertEqual(module.read(file),b'actual source')
            alias=Path(directory)/'alias';alias.symlink_to(file)
            with self.assertRaisesRegex(RuntimeError,'ORIGINAL_INQUIRY_UNPROVEN'):module.read(alias)
            other=Path(directory)/'hardlink';os.link(file,other)
            with self.assertRaisesRegex(RuntimeError,'ORIGINAL_INQUIRY_UNPROVEN'):module.read(file)

    def test_actual_node_verifier_checks_signature_before_advancing_original_sequence(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);key=root/'public.pem';scope=root/'scope.json';scope.write_bytes(b'{"scope":"test input only"}');scope.chmod(0o400)
            mint="const c=require('crypto'),f=require('fs'),k=c.generateKeyPairSync('ed25519');f.writeFileSync(process.argv[1],k.publicKey.export({type:'spki',format:'pem'}));let d=JSON.parse(process.argv[2]);process.stdout.write(JSON.stringify({decision:d,signature:c.sign(null,Buffer.concat([Buffer.from('sabalan-online-original-control/v1\\n'),Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(d).sort().map(k=>[k,d[k]]))))]),k.privateKey).toString('base64')}));"
            decision=dict(format='sabalan-online-original-control/v1',session='a'*64,scopeSha256='b'*64,sequence=1,command='START',input={})
            minted=subprocess.run(['/usr/local/bin/node','-e',mint,str(key),json.dumps(decision)],capture_output=True,check=True);key.chmod(0o400)
            value=json.loads(minted.stdout);owner=object.__new__(module.InquiryOwner)
            owner.sequence=0;owner.session='a'*64;owner.sha='b'*64;owner.file=str(scope);owner.scope_raw=scope.read_bytes();owner.public_raw=key.read_bytes();owner.children=[]
            class Input:
                def __init__(self,raw):
                    import io
                    self.buffer=io.BytesIO(raw)
            previous,previous_public=module.sys.stdin,module.PUBLIC;module.PUBLIC=str(key)
            try:
                module.sys.stdin=Input(module.encode(value)+b'\n');self.assertEqual(owner.receive(),decision);self.assertEqual(owner.sequence,1)
                self.assertEqual(len(owner.children),1);self.assertEqual(owner.children[0].returncode,0)
                module.sys.stdin=Input(module.encode(value)+b'\n')
                with self.assertRaisesRegex(RuntimeError,'ORIGINAL_INQUIRY_UNPROVEN'):owner.receive()
                self.assertEqual(len(owner.children),1)
                value['decision']['sequence']=2;module.sys.stdin=Input(module.encode(value)+b'\n')
                with self.assertRaisesRegex(RuntimeError,'ORIGINAL_INQUIRY_UNPROVEN'):owner.receive()
                self.assertEqual(owner.sequence,1);self.assertEqual(owner.children[-1].returncode,1)
                self.assertTrue(all(child.poll() is not None for child in owner.children))
            finally:module.sys.stdin=previous;module.PUBLIC=previous_public

if __name__=='__main__':unittest.main()
