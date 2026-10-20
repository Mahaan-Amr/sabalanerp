import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

/** Original fixed-command ownership for artifact tools. Signals record failure;
 * no timeout, buffer bound or reporting error kills/replaces a child. */
export function originalBackendBaseCommands(){
  const owners=[];let interrupted=false,closed=false;
  const signal=()=>{interrupted=true;};process.on('SIGINT',signal);process.on('SIGTERM',signal);
  return Object.freeze({
    run(executable,args,{input,maximum=4*1024**2,cwd,env}={}){
      assert.equal(closed,false);
      const child=spawn(executable,args,{cwd,env,stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],windowsHide:true});
      const owner={child,originalPid:child.pid??null,closed:false,stdoutBytes:0,stderrBytes:0,exceeded:false};owners.push(owner);
      const output=[],errors=[];let spawnError,streamError;
      for(const [stream,chunks,key]of [[child.stdout,output,'stdoutBytes'],[child.stderr,errors,'stderrBytes']]){
        stream.on('error',error=>{streamError=error.code??'CHILD_STREAM_ERROR';});
        stream.on('data',bytes=>{owner[key]+=bytes.length;if(owner[key]<=maximum)chunks.push(bytes);else owner.exceeded=true;});
      }
      child.once('error',error=>{spawnError=error.code??'CHILD_SPAWN_FAILED';});
      owner.completion=new Promise(resolve=>child.once('close',(code,signal)=>{
        owner.closed=true;owner.result={originalPid:owner.originalPid,code,signal,spawnError,streamError,
          naturalChildClosure:typeof code==='number'&&signal===null,outputBoundExceeded:owner.exceeded,
          stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8')};resolve(owner.result);
      }));
      if(input!==undefined){child.stdin.on('error',error=>{streamError=error.code??'CHILD_INPUT_ERROR';});child.stdin.end(input);}
      return owner.completion;
    },
    assertSuccessful(result){assert.equal(interrupted,false,'ORIGINAL_CONTROLLER_INTERRUPTED');assert.equal(result.code,0);assert.equal(result.signal,null);
      assert.equal(result.spawnError,undefined);assert.equal(result.streamError,undefined);assert.equal(result.outputBoundExceeded,false);},
    get interrupted(){return interrupted;},
    async close(){await Promise.all(owners.map(owner=>owner.completion));assert.ok(owners.every(owner=>owner.closed));
      closed=true;process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);
      return {allOriginalChildrenClosed:true,childCount:owners.length,interrupted};},
  });
}
