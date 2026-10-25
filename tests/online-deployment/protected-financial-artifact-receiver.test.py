"""Actual receiver function with explicit Linux metadata/directory-fsync model on Windows; real temporary file bytes/readback, no service actions."""
import ast,base64,hashlib,os,pathlib,stat,tempfile,types,unittest
SOURCE=pathlib.Path(__file__).parents[2]/'deploy/scripts/online-release-launcher.py'
TREE=ast.parse(SOURCE.read_text());NODE=next(x for x in TREE.body if isinstance(x,ast.FunctionDef) and x.name=='receive_qualification_files')
class ReceiverTests(unittest.TestCase):
 def run_receiver(self,rows,frames,financial=False):
  root=pathlib.Path(tempfile.mkdtemp());self.addCleanup(lambda:__import__('shutil').rmtree(root,ignore_errors=True));target=root/'evidence';events=[];actual_lstat=pathlib.Path.lstat
  def modeled_lstat(p,*a,**kw):
   s=actual_lstat(p,*a,**kw);v={n:getattr(s,n) for n in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_nlink')};v.update(st_uid=0,st_mode=(stat.S_IFDIR|0o700) if stat.S_ISDIR(s.st_mode) else (stat.S_IFREG|0o400));return types.SimpleNamespace(**v)
  fake=types.SimpleNamespace(**{n:getattr(os,n) for n in dir(os)});fake.O_NOFOLLOW=getattr(os,'O_NOFOLLOW',0);fake.O_DIRECTORY=getattr(os,'O_DIRECTORY',0);original_open=os.open
  def open_(file,flags,*a):
   if pathlib.Path(file).is_dir():events.append('directory-open');return 999999
   events.append('file-open');return original_open(file,flags,*a)
  fake.open=open_;fake.fsync=lambda fd:events.append('fsync') if fd==999999 else os.fsync(fd);fake.close=lambda fd:None if fd==999999 else os.close(fd)
  def require(v):
   if not v:raise RuntimeError('refused')
  queue=list(frames)
  def frame(fd,maximum):
   self.assertEqual(fd,0);self.assertEqual(maximum,524288)
   if not queue:raise EOFError('actual anonymous channel ended')
   return queue.pop(0)
  def write(fd,data):
   n=0
   while n<len(data):n+=os.write(fd,data[n:])
  import json,re
  env=dict(os=fake,pathlib=pathlib,stat=stat,hashlib=hashlib,base64=base64,re=re,require=require,frame=frame,write=write)
  exec(compile(ast.Module(body=[NODE],type_ignores=[]),str(SOURCE),'exec'),env)
  pathlib.Path.lstat=modeled_lstat
  try:result=env['receive_qualification_files']({'files':rows},target,financial)
  finally:pathlib.Path.lstat=actual_lstat
  return result,queue,events
 def row(self,data):return {'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
 def parts(self,name,data):return [dict(format='sabalan-original-qualification-chunk/v1',sequence=1,file=name,offset=i,rawBase64=base64.b64encode(data[i:i+262144]).decode()) for i in range(0,len(data),262144)]
 def test_real_multichunk_write_and_hash_readback(self):
  data=b'x'*600001;out,left,events=self.run_receiver({'manifest.json':self.row(data)},self.parts('manifest.json',data));self.assertEqual((out/'manifest.json').read_bytes(),data);self.assertFalse(left);self.assertIn('directory-open',events)
 def test_empty_stderr_and_no_extra_frame_consumed(self):
  sentinel={'future':'control'};out,left,_=self.run_receiver({'protected-financial-workerstderr.json':self.row(b'')},[sentinel]);self.assertEqual((out/'protected-financial-workerstderr.json').read_bytes(),b'');self.assertEqual(left,[sentinel])
 def test_wrong_offset_file_hash_and_truncated_original_refuse(self):
  for change in ('offset','file','hash','eof'):
   data=b'abc';row=self.row(data);parts=self.parts('manifest.json',data)
   if change=='offset':parts[0]['offset']=1
   elif change=='file':parts[0]['file']='other.json'
   elif change=='hash':row['sha256']='0'*64
   else:parts=[]
   with self.subTest(change=change),self.assertRaises((RuntimeError,EOFError)):self.run_receiver({'manifest.json':row},parts)
 def test_oversize_compiled_and_alias_refuse_before_chunk(self):
  for name,row in [('../alias',self.row(b'x')),('protected-financial-currentcompiled.json',dict(bytes=33554433,sha256='0'*64)),('protected-financial-certificate.json',dict(bytes=65537,sha256='0'*64))]:
   with self.subTest(name=name),self.assertRaises(RuntimeError):self.run_receiver({name:row},[])
 def test_financial_requires_exact_thirteen_descriptors(self):
  with self.assertRaises(RuntimeError):self.run_receiver({'manifest.json':self.row(b'x')},[],True)
if __name__=='__main__':unittest.main()
