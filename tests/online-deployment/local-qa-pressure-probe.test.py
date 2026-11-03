"""No Docker/WSL runtime is started by these tests. Real Win32 API read only."""
import pathlib,runpy,unittest,json,copy,datetime,threading,subprocess,sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
M=runpy.run_path(str(ROOT/'deploy/scripts/local-qa-pressure.py'),run_name='probe_unit')
S=runpy.run_path(str(ROOT/'deploy/scripts/original-native-c3-master-supervisor.py'),run_name='supervisor_pressure_unit')

def frame():
 return {'format':'sabalan-local-qa-pressure/v1','platform':'win32','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'availableBytes':256*1024**2,'commitTotalBytes':8*1024**3,'commitLimitBytes':16*1024**3,'lowMemory':False,'vm':{'probeContainerId':'a'*64,'bootId':'11111111-1111-1111-1111-111111111111','fullAvg10':0,'someAvg10':0,'oomKills':0},'probe':{'durationMs':40,'children':[{'originalPid':100,'code':0,'stdoutEof':True,'stderrEof':True}]*2}}

class PressureTests(unittest.TestCase):
 def test_actual_win32_query_is_readonly_and_system_commit_is_consistent(self):
  v=M['windows_pressure']();self.assertIsInstance(v['lowMemory'],bool);self.assertGreater(v['commitLimitBytes'],0);self.assertLessEqual(v['commitTotalBytes'],v['commitLimitBytes']);self.assertGreaterEqual(v['availableBytes'],0)
 def test_supervisor_selected_policy_allows_healthy_sub2gib(self):S['validate_pressure_sample'](frame())
 def test_pressure_and_unknown_collector_closure_are_refused(self):
  for change in [lambda v:v.update(lowMemory=True),lambda v:v.update(commitTotalBytes=v['commitLimitBytes']),lambda v:v['vm'].update(fullAvg10=8),lambda v:v['probe'].update(durationMs=2501),lambda v:v['probe']['children'][0].update(stdoutEof=False)]:
   v=frame();change(v)
   with self.assertRaises(AssertionError):S['validate_pressure_sample'](v)
 def test_supervisor_records_failed_sample_and_never_schedules_work(self):
  v=frame();v['lowMemory']=True;r=S['stabilize_host_pressure'](lambda:v,lambda:0,lambda _:None);self.assertFalse(r['stable']);self.assertEqual(len(r['samples']),1)
 def test_old_supervisor_observations_keep_their_historical_floor(self):
  self.assertEqual(S['HOST_MEMORY_FLOOR'],1536*1024**2)
  with self.assertRaises(AssertionError):S['validate_host_memory']({'format':'sabalan-original-native-pressure-stabilization/v1'})
class ActualProbeClosureTests(unittest.TestCase):
 def test_setup_fault_creates_no_process(self):
  spawned=[]
  def bad_thread(**_):raise MemoryError('fixture setup')
  with self.assertRaises(MemoryError):M['retained_probe']([],popen=lambda *a,**k:spawned.append(a),thread_factory=bad_thread)
  self.assertEqual(spawned,[])
 def test_real_child_start_join_and_wait_faults_drain_both_readers_before_negative(self):
  for fault in ['start','join','wait']:
   children=[];triggered=[]
   class Reader(threading.Thread):
    def start(self):
     if fault=='start' and not triggered:triggered.append(True);raise MemoryError('fixture thread start')
     return super().start()
    def join(self,*a,**k):
     if fault=='join' and not triggered:triggered.append(True);raise KeyboardInterrupt()
     return super().join(*a,**k)
   def spawn(*a,**k):
    child=subprocess.Popen(*a,**k);children.append(child);wait=child.wait
    def interrupted_wait(*a,**k):
     if fault=='wait' and not triggered:triggered.append(True);raise KeyboardInterrupt()
     return wait(*a,**k)
    child.wait=interrupted_wait;return child
   with self.assertRaises(M['ProbeClosureFailure'])as failure:M['retained_probe']([sys.executable,'-I','-B','-c',"import sys;sys.stdout.write('x'*40000);sys.stderr.write('y'*40000)"],popen=spawn,thread_factory=Reader)
   row=failure.exception.receipt;self.assertEqual(len(children),1);self.assertEqual(row['originalPid'],children[0].pid);self.assertEqual(row['code'],0);self.assertTrue(row['stdoutEof']and row['stderrEof']);self.assertTrue(triggered);self.assertIsNotNone(children[0].poll())

class FrontendMemoryObservationTests(unittest.TestCase):
 def frame(self,running):
  globals_=M['observe_frontend_memory'].__globals__;previous_read=globals_['retained_probe'];previous_win=globals_['windows_pressure'];calls=[]
  services=['backend','frontend','postgres','redis','inquiry','backend-candidate','backend-retained','frontend-candidate','frontend-retained','clamav']
  ids={s:format(i+1,'064x')for i,s in enumerate(services)}
  rows=[{'Service':s,'ID':ids[s],'Project':'sabalanerp-local','State':'running'if s!='frontend'or running else'exited','Health':'healthy'if s!='frontend'or running else''}for s in services]
  def read(args):
   calls.append(args);name=args[1]
   if name=='compose':value=rows
   elif name=='container':value=[{'Id':ids['frontend'],'Image':'sha256:'+'f'*64,'Config':{'Labels':{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':'frontend'}},'State':{'Running':running,'Pid':23 if running else 0,'StartedAt':'2026-10-31T00:00:00Z','Health':{'Status':'healthy'},'OOMKilled':False},'HostConfig':{'Memory':8589934592,'MemorySwap':17179869184},'RestartCount':0}]
   else:
    self.assertEqual(name,'exec');self.assertEqual(args[3:5],['/usr/local/bin/node','-e'])
    # Execute the exact guest JavaScript against deterministic /proc/cgroup
    # reads, rather than duplicating its parsing implementation in Python.
    fixture=r"""const vm=require('node:vm');const data={'/proc/meminfo':'MemTotal: 8000000 kB\nMemAvailable: 2000000 kB\nAnonPages: 5000000 kB\nCached: 500000 kB\nBuffers: 100 kB\nShmem: 50 kB\nSReclaimable: 30 kB\nSwapTotal: 1000 kB\nSwapFree: 500 kB\nSwapCached: 10 kB\n','/sys/fs/cgroup/memory.stat':'anon 123456\nfile 45678\n','/sys/fs/cgroup/memory.events':'oom 0\noom_kill 0\n','/sys/fs/cgroup/memory.current':'200000','/sys/fs/cgroup/memory.max':'8589934592','/sys/fs/cgroup/memory.swap.current':'0','/sys/fs/cgroup/memory.swap.max':'8589934592','/proc/7/status':'Name:\tnext-server\nRssAnon:\t512 kB\nVmRSS:\t600 kB\nVmSwap:\t0 kB\n','/proc/7/stat':'7 (next-server) S 1 '+Array.from({length:20},(_,i)=>String(i)).join(' '),'/proc/sys/kernel/random/boot_id':'11111111-1111-1111-1111-111111111111','/proc/pressure/memory':'some avg10=0.00\nfull avg10=0.00\n','/proc/vmstat':'oom_kill 0\n'};vm.runInNewContext(process.argv[1],{require:()=>({readFileSync:p=>{if(!(p in data))throw Error(p);return data[p];},readdirSync:()=>['7','self']}),process:{pid:7},console});"""
    result=subprocess.run(['C:/Program Files/nodejs/node.exe','-e',fixture,args[5]],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,creationflags=subprocess.CREATE_NO_WINDOW)
    self.assertEqual(result.returncode,0,result.stderr.decode());self.assertEqual(result.stderr,b'');value=json.loads(result.stdout)
    self.assertEqual(value['vmBytes']['AnonPages'],5000000*1024);self.assertEqual(value['cgroup']['stat']['anon'],123456);self.assertEqual(value['processes'][0]['rssAnonBytes'],512*1024)
   return json.dumps(value).encode(),{'originalPid':1000+len(calls),'code':0,'stdoutEof':True,'stderrEof':True}
  globals_['retained_probe']=read;globals_['windows_pressure']=lambda:{'availableBytes':222222,'commitTotalBytes':333333,'commitLimitBytes':999999,'lowMemory':False}
  try:value=M['observe_frontend_memory']()
  finally:globals_['retained_probe']=previous_read;globals_['windows_pressure']=previous_win
  self.assertEqual([c[1]for c in calls],['compose','container','compose','exec']);self.assertEqual(len(value['originalChildren']),4);self.assertFalse(value['memoryFreedClaimed']);self.assertEqual(value['windowsBefore'],value['windowsAfter'])
  return value
 def test_running_frontend_actual_guest_parser_and_bracketed_scopes(self):
  value=self.frame(True);self.assertEqual(value['probeService'],'frontend');self.assertEqual(value['frontendCgroup']['stat']['anon'],123456);self.assertTrue(value['frontendCgroup']['includesMeasurementProbe'])
 def test_stopped_frontend_never_labels_backend_cgroup_as_frontend(self):
  value=self.frame(False);self.assertEqual(value['probeService'],'backend-candidate');self.assertIsNone(value['frontendCgroup']);self.assertFalse(value['frontend']['running']);self.assertEqual(value['frontend']['pid'],0)

if __name__=='__main__':unittest.main()
