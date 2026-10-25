import ast,copy,json,pathlib,signal,threading,time,types,unittest
SOURCE=pathlib.Path(__file__).resolve().parents[2]/'deploy/scripts/legacy-backend-signal.py'
def extracted():
 tree=ast.parse(SOURCE.read_bytes()); names={'api_remaining','owned_normal_stop','OwnedDaemonRequest','retain_unknown_stop'}
 selected=[x for x in tree.body if isinstance(x,(ast.FunctionDef,ast.ClassDef)) and x.name in names]
 constants=[x for x in tree.body if isinstance(x,ast.Assign) and any(isinstance(y,ast.Name) and y.id=='DAEMON_BUILD' for y in x.targets)]
 env={'time':time,'threading':threading,'json':json,'urllib':__import__('urllib.parse'),'re':__import__('re'),'interrupted':False,'capture_deadline_ns':lambda:time.monotonic_ns()+10_000_000_000,'require':lambda value,code='REFUSED':None if value else (_ for _ in ()).throw(RuntimeError(code))}
 exec(compile(ast.Module(body=constants+selected,type_ignores=[]),'source-owned-protocol','exec'),env);return env
class Protocol(unittest.TestCase):
 def run_case(self,*,bad_version=False,missing=False,restarted=False,late=False,start_interrupt=False):
  env=extracted();trace=[];node_done=threading.Event();stop_started=threading.Event()
  snapshot={'container':{'containerId':'a'*64,'image':'sha256:x'},'node':{'pid':42}}
  class Host:
   def assert_original(self):trace.append('owner')
   def inspect(self,cid):return {'RestartCount':3 if restarted and node_done.is_set() else 2}
   def snapshot(self,image):return copy.deepcopy(snapshot)
   def protected_boundary(self,*args):trace.append('boundary')
  class Response:
   status=200
   def __init__(self,kind):self.kind=kind;self.status=204 if kind=='stop' else 200
   def read(self,n):
    if self.kind=='stop':
     assert node_done.wait(2),'same stop not retained/closed';trace.append('stop-closed');return b''
    raise AssertionError('unexpected read')
   def readline(self,n):
    assert stop_started.wait(2)
    if missing:node_done.set();return b''
    trace.append('actual-kill15-event');return json.dumps({'Type':'container','Action':'kill','Actor':{'ID':'a'*64,'Attributes':{'signal':'15'}},'timeNano':time.time_ns()}).encode()+b'\n'
  class Request:
   def __init__(self,host,method,path,*,unbounded_stop=False,sent=None):
    self.kind='version' if path=='/version' else 'wait' if '/wait?' in path else 'events' if '/events?' in path else 'stop'
    self.socket=types.SimpleNamespace(settimeout=lambda n:None);self.response=Response(self.kind);self.potentialDispatch=False;self.underlyingComplete=False;self.clientTerminal=False;self.clientFault=False;trace.append(self.kind+'-allocated');self.sent=sent;self.unbounded_stop=unbounded_stop;self.path=path
   def open(self):
    self.potentialDispatch=True;trace.append(self.kind+'-registered');sent=self.sent;path=self.path;unbounded_stop=self.unbounded_stop
    if self.kind=='stop':assert path.endswith('stop?signal=SIGTERM&t=-1') and unbounded_stop;stop_started.set();sent.set()
   def bounded_json(self,n):
    if self.kind=='version':return {**env['DAEMON_BUILD'],**({'GitCommit':'unknown'} if bad_version else {})}
    assert node_done.is_set();trace.append('exit-result');return {'StatusCode':0}
   def close(self):trace.append(self.kind+'-socket-closed')
  def deliver(*args):trace.append('node-SIGTERM');node_done.set()
  env.update(OwnedDaemonRequest=Request,proc_identity=lambda pid:copy.deepcopy(snapshot['node']),select=types.SimpleNamespace(select=lambda *a:([],[],[])),signal=types.SimpleNamespace(SIGTERM=signal.SIGTERM,pidfd_send_signal=deliver),verify_exited=lambda *a:trace.append('verified-original-exit'))
  if start_interrupt:
   class StartedThenInterrupted:
    def __init__(self,**kwargs):self.original=threading.Thread(**kwargs)
    def start(self):
     self.original.start();node_done.set();raise RuntimeError('explicit start-return interruption')
    def is_alive(self):return self.original.is_alive()
    def join(self,*args):trace.append('same-original-join');self.original.join(*args)
   env['threading']=types.SimpleNamespace(Thread=StartedThenInterrupted,Event=threading.Event)
  report={}
  if late:env['capture_deadline_ns']=lambda:0 if node_done.is_set() else time.monotonic_ns()+10_000_000_000
  try:env['owned_normal_stop'](Host(),snapshot,17,{},'session',report)
  except RuntimeError:return trace,report,False
  return trace,report,True
 def test_registered_then_manual_ack_then_node_then_both_closures(self):
  t,r,ok=self.run_case();self.assertTrue(ok);self.assertLess(t.index('wait-registered'),t.index('stop-registered'));self.assertLess(t.index('actual-kill15-event'),t.index('node-SIGTERM'));self.assertIn('stop-closed',t);self.assertTrue(r['normalStopOriginal']['closed'])
 def test_missing_actual_event_never_signals_and_retains_same_stop(self):
  t,r,ok=self.run_case(missing=True);self.assertFalse(ok);self.assertNotIn('node-SIGTERM',t);self.assertIn('stop-closed',t);self.assertTrue(r['shutdownObservationFault'])
 def test_unreviewed_daemon_refused_before_stop_or_signal(self):
  t,r,ok=self.run_case(bad_version=True);self.assertFalse(ok);self.assertNotIn('stop-registered',t);self.assertNotIn('node-SIGTERM',t)
 def test_restarted_incarnation_cannot_pass(self):self.assertFalse(self.run_case(restarted=True)[2])
 def test_later_204_after_capture_deadline_remains_negative(self):
  t,r,ok=self.run_case(late=True);self.assertFalse(ok);self.assertTrue(r['normalStopOriginal']['underlyingComplete']);self.assertTrue(r['shutdownObservationFault'])
 def test_start_spawns_then_raises_retains_same_original_and_stays_negative(self):
  t,r,ok=self.run_case(start_interrupt=True);self.assertFalse(ok);self.assertNotIn('node-SIGTERM',t);self.assertTrue(r['normalStopOriginal']['underlyingComplete']);self.assertTrue(r['shutdownObservationFault'])
 def test_existing_invariants_no_force_or_restart_policy_mutation(self):
  source=SOURCE.read_text();self.assertNotIn("host.docker(['wait'",source);self.assertIn("stop?signal=SIGTERM&t=-1",source);self.assertNotIn('SIGKILL',source);self.assertIn("'LEGACY_SIGNAL_ORIGINAL_INCARNATION_CHANGED'",source)
 def test_existing_verifier_unchanged(self):
  def fn(p,name):return next(x for x in ast.parse(p.read_bytes()).body if isinstance(x,ast.FunctionDef) and x.name==name)
  self.assertEqual(__import__('hashlib').sha256(ast.dump(fn(SOURCE,'verify_exited')).encode()).hexdigest(), 'd6ef932de12dd36c47dbb235d414daae5b01f860003cc942d5507e0485a5bc5b')
if __name__=='__main__':unittest.main()
