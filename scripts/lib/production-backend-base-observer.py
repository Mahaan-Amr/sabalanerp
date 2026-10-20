"""Bounded original readonly-observer custody; no selector or timeout kill."""
import os
import signal
import subprocess
import time


class OriginalReadonlyObservers:
    def __init__(self):
        self.owners=[];self.signals=[];self.previous={}
        for name in ['SIGINT','SIGTERM','SIGHUP']:
            number=getattr(signal,name,None)
            if number is not None:
                self.previous[number]=signal.getsignal(number)
                signal.signal(number,self._signal)

    def _signal(self,number,frame):
        # Record interruption, but retain every original child/pipeline first.
        if number not in self.signals:self.signals.append(number)

    def run(self,argv,maximum=2*1024**2):
        if self.signals:raise RuntimeError('BACKEND_BASE_READONLY_CONTROLLER_INTERRUPTED')
        owner={'actor':None,'closed':False,'failure':None,'exceeded':False,'stdoutBytes':0,'stderrBytes':0}
        self.owners.append(owner)  # Registry slot exists before actual child birth.
        actor=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        owner['actor']=actor
        output,errors=bytearray(),bytearray()
        streams=[{'stream':actor.stdout,'target':output,'key':'stdoutBytes','ready':False,'done':False},
                 {'stream':actor.stderr,'target':errors,'key':'stderrBytes','ready':False,'done':False}]
        # Nonblocking round-robin avoids a selector registration/read failure
        # abandoning a child. Any observation error is sticky, but we continue
        # draining the SAME original pipes until EOF and actual natural exit.
        while not all(row['done'] for row in streams):
            progressed=False
            for row in streams:
                if row['done']:continue
                try:
                    if not row['ready']:
                        os.set_blocking(row['stream'].fileno(),False);row['ready']=True
                    chunk=os.read(row['stream'].fileno(),65536)
                    if not chunk:
                        row['done']=True;row['stream'].close();progressed=True;continue
                    progressed=True;owner[row['key']]+=len(chunk)
                    if len(row['target'])+len(chunk)<=maximum:row['target'].extend(chunk)
                    else:owner['exceeded']=True
                except (BlockingIOError,InterruptedError):pass
                except BaseException as error:
                    if owner['failure'] is None:owner['failure']=type(error).__name__
                    # A recoverable read/setup error is retried; a genuinely
                    # unknown pipe remains owned instead of manufacturing EOF.
            if not progressed:
                try:time.sleep(0.005)
                except BaseException as error:
                    if owner['failure'] is None:owner['failure']=type(error).__name__
        while True:
            try:status=actor.wait();break
            except BaseException as error:
                if owner['failure'] is None:owner['failure']=type(error).__name__
        owner['closed']=True;owner['actualStatus']=status
        if status!=0 or owner['failure'] or owner['exceeded'] or self.signals:
            raise RuntimeError('BACKEND_BASE_READONLY_OBSERVER_FAILED')
        return bytes(output)

    def assert_closed(self):
        if not all(owner['actor'] is not None and owner['closed'] and owner['actor'].returncode is not None for owner in self.owners):
            raise RuntimeError('BACKEND_BASE_READONLY_OBSERVER_CLOSURE_UNPROVEN')

    def restore_signals(self):
        self.assert_closed()
        for number,previous in self.previous.items():signal.signal(number,previous)
