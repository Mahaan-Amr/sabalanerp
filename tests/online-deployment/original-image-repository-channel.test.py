"""Real finite duplex process; no Compose, SSH or runtime acceptance."""
import hashlib
import io
import json
import pathlib
import runpy
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FILE = ROOT / 'deploy/scripts/original-image-repository-channel.py'
m = runpy.run_path(str(FILE))
RAW = bytes(range(256)) * 4097 + b'\x00\x1a\r\n'
WANTED = dict(event='IMAGE_TRANSFER_REQUEST', format='sabalan-original-image-transfer/v1',
              operation='a'*32, role='backend', sequence=0, path='/private/owned/backend.sabrec',
              bytes=len(RAW), sha256=hashlib.sha256(RAW).hexdigest())


class ActualImageChannel(unittest.TestCase):
    def child(self, mode):
        code = "import io,json,runpy,sys; m=runpy.run_path(sys.argv[1]);w=json.loads(sys.argv[2]);raw=bytes(range(256))*4097+b'\\x00\\x1a\\r\\n';mode=sys.argv[3];" \
               "raw=raw[:-1] if mode=='truncated' else (b'x'+raw[1:] if mode=='corrupt' else raw);" \
               "m['write_frame'](sys.stdout.buffer,dict(event='IMAGE_RETRIEVAL_BEGIN',**m['retrieval_binding'](w)));sys.stdout.buffer.write(raw);sys.stdout.buffer.flush();" \
               "sys.exit(7) if mode!='success' else None;ack=m['read_frame'](sys.stdin.buffer);" \
               "assert ack==dict(event='IMAGE_RETRIEVAL_ACK',**m['retrieval_binding'](w))"
        return subprocess.Popen([sys.executable,'-I','-B','-c',code,str(FILE),json.dumps(WANTED),mode],
                                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)

    def test_same_original_binary_stream_and_ack_with_natural_eof(self):
        child = self.child('success')
        try:
            receipt = m['receive_retrieval'](child.stdout, child.stdin, WANTED, lambda:None)
            self.assertTrue(receipt['actualClientBytesHashed'])
            child.stdin.close()
            self.assertEqual(child.stdout.read(), b'')
            self.assertEqual(child.stderr.read(), b'')
            self.assertEqual(child.wait(timeout=15), 0)
        finally:
            for stream in [child.stdin,child.stdout,child.stderr]:stream.close()

    def test_corrupt_or_cut_child_never_gets_ack(self):
        for mode, error in [('corrupt','CIPHER_CHANGED'),('truncated','TRUNCATED')]:
            child = self.child(mode)
            try:
                with self.assertRaisesRegex(RuntimeError,error):m['receive_retrieval'](child.stdout,child.stdin,WANTED,lambda:None)
                child.stdin.close()
                self.assertEqual(child.stdout.read(),b'')
                self.assertEqual(child.stderr.read(),b'')
                self.assertEqual(child.wait(timeout=15),7)
            finally:
                for stream in [child.stdin,child.stdout,child.stderr]:stream.close()

    def test_wrong_operation_header_and_wrong_ack_refuse(self):
        binding = m['retrieval_binding'](WANTED)
        wrong = dict(binding,operation='b'*32)
        with self.assertRaisesRegex(RuntimeError,'HEADER_CHANGED'):
            m['receive_retrieval'](io.BytesIO(m['frame'](dict(event='IMAGE_RETRIEVAL_BEGIN',**wrong))),io.BytesIO(),WANTED,lambda:None)
        with self.assertRaisesRegex(RuntimeError,'ACK_CHANGED'):
            m['send_retrieval'](io.BytesIO(RAW),io.BytesIO(),io.BytesIO(m['frame'](dict(event='IMAGE_RETRIEVAL_ACK',**wrong))),WANTED,lambda:None)

    def test_custody_failure_stops_before_output(self):
        output=io.BytesIO()
        def lost():raise RuntimeError('OWNED_PARENT_LOST')
        with self.assertRaisesRegex(RuntimeError,'PARENT_LOST'):m['send_retrieval'](io.BytesIO(RAW),output,io.BytesIO(),WANTED,lost)
        self.assertEqual(output.getvalue(),b'')


if __name__=='__main__':unittest.main()
