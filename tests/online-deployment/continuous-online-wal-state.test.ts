import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertClosedContinuousWalRecord,assertNoUnclosedContinuousWalOwners} from '../../backend/src/services/continuousOnlineWalState';
function completed(){const originalOwner={pid:123,startTicks:'987',bootId:'11111111-1111-1111-1111-111111111111',pidNamespace:'pid:[12]'};return {format:'sabalan-original-continuous-wal-state/v1',phase:'COMPLETE',captureId:'a'.repeat(64),originalOwner,windowsCreated:1,closedWindows:1,finalIntervalCompletion:true,
 terminal:{format:'sabalan-original-terminal-wal-coverage/v1',phase:'COMPLETE',captureId:'a'.repeat(64),originalOwner,ownedChildrenDomain:'continuous-wal-producer',allOriginalChildrenClosed:true,finalIntervalCompletion:true,publicationSha256:'b'.repeat(64),terminalEpochSha256:'c'.repeat(64),windows:[{windowSha256:'d'.repeat(64),requestSha256:'e'.repeat(64),certificateSha256:'f'.repeat(64)}]}};}
test('OPENING ACTIVE UNKNOWN and unreadable records never become completed through expiry or absent owner',()=>{
 for(const phase of ['OPENING','ACTIVE','UNKNOWN'])assert.throws(()=>assertClosedContinuousWalRecord({...completed(),phase,leaseExpired:true,ownerGone:true}));
 for(const value of [null,{},'COMPLETE'])assert.throws(()=>assertClosedContinuousWalRecord(value));
});
test('terminal completion is scoped to original continuous producer and every original closed window',()=>{
 assert.doesNotThrow(()=>assertClosedContinuousWalRecord(completed()));
 for(const mutate of [(v:any)=>v.terminal.ownedChildrenDomain='application',(v:any)=>v.closedWindows=0,(v:any)=>v.terminal.captureId='9'.repeat(64),(v:any)=>v.terminal.allOriginalChildrenClosed=false,(v:any)=>delete v.terminal.windows[0].certificateSha256]){const value=completed();mutate(value);assert.throws(()=>assertClosedContinuousWalRecord(value));}
});
test('actual durable OPENING and UNKNOWN files refuse recovery before mutation; aliases refuse',{skip:process.platform!=='linux'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'wal-state-'));fs.chmodSync(root,0o700);const work=path.join(root,'online','work'),directory=path.join(work,'a'.repeat(64));fs.mkdirSync(directory,{recursive:true,mode:0o700});const file=path.join(directory,'continuous-wal-state.json');
 try{for(const phase of ['OPENING','UNKNOWN']){fs.writeFileSync(file,JSON.stringify({...completed(),phase}),{mode:0o400});assert.throws(()=>assertNoUnclosedContinuousWalOwners(root));fs.unlinkSync(file);}
  fs.writeFileSync(file,JSON.stringify(completed()),{mode:0o400});assert.doesNotThrow(()=>assertNoUnclosedContinuousWalOwners(root));fs.unlinkSync(file);fs.symlinkSync('/dev/null',file);assert.throws(()=>assertNoUnclosedContinuousWalOwners(root));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
