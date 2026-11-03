"""Finite binary counterpart of NativeHost.run; retains the actual original.
The application source owner supplies only its fixed phase argv, never a PID.
"""
import hashlib,os,select,subprocess,threading
def collect(host,argv,output,maximum,stdin=subprocess.DEVNULL):
 host.lock_guard();faults={};overflow=False;hashes={};counts={};eof={}
 def fault(error):
  name=error if isinstance(error,str)else type(error).__name__
  if name in faults:faults[name]=min(2**53-1,faults[name]+1)
  elif len(faults)<32:faults[name]=1
  else:faults['FAULT_LABEL_OVERFLOW']=1
  if not isinstance(error,str):threading.Event().wait(.05)
 def finish(work):
  while True:
   try:return work()
   except BaseException as error:fault(error)
 child=subprocess.Popen(argv,stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LC_ALL':'C','TZ':'UTC','DOCKER_HOST':'unix:///var/run/docker.sock','GIT_OPTIONAL_LOCKS':'0','GIT_TERMINAL_PROMPT':'0','GIT_CONFIG_NOSYSTEM':'1','GIT_CONFIG_GLOBAL':'/dev/null'})
 # SAME two pipe objects and child remain held even when any setup/read/write
 # faults. select needs no fallible reader-thread or selector registration.
 pipes={child.stdout:'stdout',child.stderr:'stderr'};err=bytearray();live=dict(pipes)
 for name in pipes.values():hashes[name]=hashlib.sha256();counts[name]=0;eof[name]=False
 while live:
  try:ready=select.select(list(live),[],[],.5)[0]
  except BaseException as error:fault(error);continue
  for pipe in ready:
   name=live[pipe]
   try:raw=os.read(pipe.fileno(),65536)
   except BaseException as error:fault(error);continue
   if not raw:eof[name]=True;del live[pipe];continue
   hashes[name].update(raw);counts[name]+=len(raw)
   if name=='stdout':
    if counts[name]>maximum:fault('STDOUT_BOUND_EXCEEDED');overflow=True
    elif not faults:
     try:
      written=output.write(raw)
      if written!=len(raw):fault('SHORT_STDOUT_WRITE')
     except BaseException as error:fault(error)
   elif counts[name]<=65536:err.extend(raw)
   else:fault('STDERR_BOUND_EXCEEDED');overflow=True
 code=finish(child.wait)
 for pipe in pipes:finish(pipe.close)
 # This is a transport pipe, not a durable receipt file. Once the actual child
 # wait and both EOF are proven, a broken transport stays negative; endlessly
 # flushing an irrecoverably closed SSH socket would retain FD9 forever.
 try:output.flush()
 except BaseException as error:fault(error)
 row={'argv':argv,'pid':child.pid,'code':code,'pipesClosed':all(eof.values()),'stdoutEof':eof['stdout'],'stderrEof':eof['stderr'],'stdoutBytes':counts['stdout'],'stderrBytes':counts['stderr'],'stdoutSha256':hashes['stdout'].hexdigest(),'stderrSha256':hashes['stderr'].hexdigest(),'observationFault':sorted(faults)or None,'faultCounts':faults,'outputBoundExceeded':overflow}
 host.children.append(row);host.lock_guard()
 assert code==0 and row['pipesClosed']and not faults and not host.interrupted,'ORIGINAL_BINARY_NATIVE_FAILED'
 return row,bytes(err)
