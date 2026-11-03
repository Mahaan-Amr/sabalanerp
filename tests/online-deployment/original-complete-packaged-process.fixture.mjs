/** Real ChildProcesses/EOF; Docker kernel boundary is explicitly modeled. */
import * as native from'node:child_process';import{fileURLToPath}from'node:url';
export const{ChildProcess,spawnSync,execFileSync,exec,execFile,fork}=native;
export function spawn(executable,args,options){if(executable==='docker')return native.spawn(process.execPath,['--no-warnings',fileURLToPath(new URL('./original-complete-packaged-docker.fixture.mjs',import.meta.url)),...args],options);return native.spawn(executable,args,options);}
export default{...native,spawn};
