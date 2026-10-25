"""Real socketpair faults, injected PURE hold sentinel; never production I/O."""
import ast,contextlib,http.client,json,pathlib,socket,threading,time,types,unittest
SOURCE=pathlib.Path(__file__).resolve().parents[2]/'deploy/scripts/legacy-backend-signal.py'
class HeldForTest(BaseException):pass
class Faults(unittest.TestCase):
 def case(self,partial):
  client,server=socket.socketpair();server.settimeout(2);closed=[];delivered=[];receiver_done=threading.Event();thread_faults=[]
  class Transport:
   def settimeout(self,x):client.settimeout(x)
   def connect(self,path):assert path=='/var/run/docker.sock'
   def sendall(self,raw):
    if partial:client.sendall(raw[:40]);raise ConnectionResetError('explicit injected partial send')
    client.sendall(raw)
   def makefile(self,*a,**kw):return client.makefile(*a,**kw)
   def close(self):closed.append(True);client.close()
  def daemon():
   try:
    delivered.append(server.recv(8192))
    if not partial:server.sendall(b'HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nx')
   except BaseException as error:thread_faults.append(type(error).__name__)
   finally:server.close();receiver_done.set()
  thread=threading.Thread(target=daemon);thread.start()
  tree=ast.parse(SOURCE.read_bytes());owned=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='OwnedDaemonRequest');outer=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='owned_normal_stop');normal=next(n for n in outer.body if isinstance(n,ast.FunctionDef) and n.name=='normal_stop')
  def require(v,c='REFUSED'):
   if not v:raise RuntimeError(c)
  stop={'closed':False,'status':None,'fault':False,'underlyingCompletionUnknown':False};held=[]
  def hold(request,report):held.append(request);raise HeldForTest()
  env={'socket':types.SimpleNamespace(socket=lambda *a:Transport(),AF_UNIX=getattr(socket,"AF_UNIX",-99),SOCK_STREAM=socket.SOCK_STREAM),'http':types.SimpleNamespace(client=http.client),'api_remaining':lambda:2,'require':require,'host':types.SimpleNamespace(assert_original=lambda:None),'cid':'a'*64,'stop_sent':threading.Event(),'stop':stop,'report':{},'retain_unknown_stop':hold}
  exec(compile(ast.Module(body=[owned,normal],type_ignores=[]),'actual-source-fault','exec'),env)
  try:
   with self.assertRaises(HeldForTest):env['normal_stop']()
   self.assertTrue(receiver_done.wait(2));self.assertTrue(delivered and delivered[0]);self.assertEqual(thread_faults,[]);self.assertTrue(stop['underlyingCompletionUnknown']);self.assertFalse(stop['closed']);self.assertTrue(stop['fault']);self.assertIs(held[0],stop['request']);self.assertTrue(held[0].potentialDispatch);self.assertFalse(held[0].underlyingComplete);self.assertTrue(held[0].clientTerminal);self.assertEqual(closed,[])
   with self.assertRaisesRegex(RuntimeError,'COMPLETION_UNKNOWN'):held[0].close()
  finally:
   # Harness-only cleanup of sockets, never source-owned close()/resolver.
   client.close();thread.join(3);self.assertFalse(thread.is_alive());server.close();self.assertEqual(thread_faults,[])
 def test_real_partial_send_fault_retains_exact_request_without_completion(self):self.case(True)
 def test_real_response_headers_then_incomplete_body_eof_retains_owner(self):self.case(False)
 def test_no_public_hold_resolver_or_timeout_and_dispatch_before_send(self):
  t=SOURCE.read_text();self.assertLess(t.index('self.potentialDispatch = True'),t.index('self.socket.sendall'));self.assertIn('while True:\n        try:\n            held.wait()',t);self.assertNotIn('held.set(',t)
if __name__=='__main__':unittest.main()
