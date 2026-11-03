/** Root's actual failure branch; finite real drain, modeled runtime ports. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';
import {originalBackendBaseCommands} from '../../scripts/lib/production-backend-base-process.mjs';
const source=fs.readFileSync(path.resolve('scripts/lib/original-candidate-rollback-owner.mjs'),'utf8'),start=source.indexOf('  async continueWithOriginalMaster('),end=source.indexOf('\n  async bindOriginalLocalCompletion',start),method=source.slice(start,end).trim().replace(/,$/,'').replace("await import('./original-online-qualification-master.mjs')",'masterApi').replace("await import('./original-existing-compose-complete.mjs')",'retirementApi');
for(const mode of ['known','retirement-changed','drain-failed','restore-failed'])test('same Root image negative '+mode+' never copies SQLite or restarts browsers',async()=>{
 const trace=[],owner={},terminal={},local={},independent={},retirement={sameFull:true},negative={local,independent,image:{retirement,ownerResult:{file:'negative'},retrievalQualified:false}},sqlite=Object.freeze({sha256:'preserved-current-attempt'});let drainClosure;
 const context={assert,Object,phase:'CANDIDATE_VERIFIED',masterStarted:false,unknown:false,relaxed:false,recovering:false,devScope:null,devPending:null,devRestored:false,completeBound:true,completeSnapshot:{},completeScope:{},owner,baseline:{sqlite},qualifiedConfiguration:[],compose:['same-compose'],slots:['backend-candidate','backend-retained'],
  guard:()=>trace.push('same-lease'),quiet:async()=>trace.push('quiet'),inquiryQuiet:async()=>trace.push('inquiry-quiet'),inspectAll:async()=>({}),candidateBeforeUpConfiguration:()=>[],save:(name,value)=>{assert.equal(value.databaseCopied??false,false);trace.push(name);return{file:name};},
  masterApi:{isOriginalMasterKnownPreparationNegative:()=>false,isOriginalMasterKnownRetainedNegative:()=>false,runOriginalOnlineQualificationMaster:async()=>terminal,isOriginalMasterKnownImageNegative:(value,root)=>value===terminal&&root===owner,readOriginalMasterKnownImageNegative:()=>negative},
  retirementApi:{readOriginalCompleteRetirementFor:(full,root,completedLocal)=>{assert.equal(full,independent);assert.equal(root,owner);assert.equal(completedLocal,local);return mode==='retirement-changed'?{sameFull:false}:retirement;}},
  pressure:{sample:async()=>trace.push('fresh-before-master-pressure'),assertAdmission(){},enterRecovery:async()=>{const commands=originalBackendBaseCommands();try{const row=await commands.run(process.execPath,['-e',"process.stdout.write('original-drained')"]);commands.assertSuccessful(row);assert.ok(row.stdoutEof&&row.stderrEof);}finally{drainClosure=await commands.close();}assert.equal(drainClosure.allOriginalChildrenClosed,true);trace.push('actual-original-EOF');if(mode==='drain-failed')throw Error('STICKY_DRAIN_FAILURE');}},
  revalidate:async()=>{assert.equal(context.recovering,true);assert.equal(context.completeBound,false);assert.equal(context.baseline.sqlite,sqlite);trace.push('baseline-revalidated');},
  restoreInquiry:async()=>{trace.push('inquiry-configuration-restore');if(mode==='restore-failed')throw Error('UNKNOWN_RESTORATION');},
  docker:async args=>{assert.deepEqual([...args],['same-compose','up','--no-deps','--no-build','--pull','never','-d','--wait','backend-candidate','backend-retained']);trace.push('backend-restore');},
  verifyBaseline:async()=>trace.push('baseline-verified'),hold:async()=>{context.phase='HELD';trace.push('held');},
 };
 owner.assertCompleteCurrent=async()=>{assert.ok(trace.includes('actual-original-EOF'));trace.push('complete-current');};
 const run=vm.runInNewContext('({'+method+'}).continueWithOriginalMaster',context);await run({});
 assert.equal(context.baseline.sqlite,sqlite);assert.equal(context.masterStarted,true);
 if(mode==='known'){assert.equal(context.phase,'RESTORED_AFTER_FAILED_UP');assert.ok(trace.indexOf('actual-original-EOF')<trace.indexOf('post-image-restoration-intent.json'));assert.ok(trace.indexOf('baseline-verified')<trace.indexOf('post-image-restored.json'));}
 else{assert.equal(context.phase,'HELD');assert.ok(!trace.includes('backend-restore'));assert.ok(!trace.includes('post-image-restored.json'));}
});
