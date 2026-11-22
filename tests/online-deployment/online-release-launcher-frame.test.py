"""Exercise the actual launcher reader against original kernel pipes, no deploy."""
import ast
import json
import os
from pathlib import Path
import threading
import unittest

SOURCE=Path(__file__).resolve().parents[2]/'deploy/scripts/online-release-launcher.py'

class OriginalLauncherFrames(unittest.TestCase):
    def setUp(self):
        tree=ast.parse(SOURCE.read_text(encoding='utf-8'))
        selected=[node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name in ('require','frame')]
        self.context=dict(os=os,json=json,frame_buffers={})
        exec(compile(ast.Module(body=selected,type_ignores=[]),str(SOURCE),'exec'),self.context)
        self.read,self.write=os.pipe()

    def tearDown(self):
        os.close(self.read)
        if self.write is not None:os.close(self.write)

    def test_multiple_original_frames_are_not_consumed_as_one(self):
        os.write(self.write,b'{"sequence":1}\n{"sequence":2}\n')
        self.assertEqual(self.context['frame'](self.read),dict(sequence=1))
        self.assertEqual(self.context['frame'](self.read),dict(sequence=2))

    def test_real_large_utf8_payload_is_streamed_without_per_byte_reads(self):
        expected=dict(value='فایل'*65536)
        raw=json.dumps(expected,ensure_ascii=False).encode()+b'\n'
        def send():
            view=memoryview(raw)
            while view:
                count=os.write(self.write,view[:4093]);view=view[count:]
        writer=threading.Thread(target=send);writer.start()
        self.assertEqual(self.context['frame'](self.read,1048576),expected)
        writer.join();self.assertFalse(writer.is_alive())

    def test_truncated_eof_and_size_boundary_are_failures(self):
        os.write(self.write,b'{"sequence":1}');os.close(self.write);self.write=None
        with self.assertRaises(RuntimeError):self.context['frame'](self.read)
        # A separate actual pipe verifies the immutable byte cap.
        read,write=os.pipe()
        try:
            os.write(write,b'12345678')
            with self.assertRaises(RuntimeError):self.context['frame'](read,8)
        finally:os.close(read);os.close(write)

if __name__=='__main__':unittest.main()
