import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {spawnSync}from'node:child_process';
import {historicalRuntimeRelativePath,assertRestoredQaHistoricalRuntimeGraph,withRestoredQaHistoricalRuntimeGraph,inspectFixedHistoricalRuntimeGraph} from '../restoredQaHistoricalRuntimeGraph';

test('fixed historical graph path syntax rejects traversal and foreign separators',()=>{
 assert.equal(historicalRuntimeRelativePath('app/dist/application.js'),'app/dist/application.js');
 for(const value of ['/app/dist/application.js','app/../dist','app//dist','app\\dist','app/./dist',''])assert.throws(()=>historicalRuntimeRelativePath(value));
});
test('a serialized old image receipt, copied token or executable path cannot enroll a graph',async()=>{
 for(const fake of [{},{kind:'OLD_89DD',applicationRoot:'/app',sourceImage:'sha256:'+'a'.repeat(64)},JSON.parse('{}')]){
  assert.throws(()=>assertRestoredQaHistoricalRuntimeGraph(fake as never,{}as never,{deploymentId:'deployment-id',releaseId:'release-id'}));
  let called=false;await assert.rejects(withRestoredQaHistoricalRuntimeGraph({}as never,{deploymentId:'deployment-id',releaseId:'release-id'},async()=>{called=true;}));assert.equal(called,false);
 }
});
test('fixed child graph data reader cannot accept a caller executable path',()=>{
 assert.throws(()=>inspectFixedHistoricalRuntimeGraph('/foreign/application.js'));
});
test('actual child data-only graph import cannot initialize the current pool or recovery engine before old graph loading',()=>{
 const file=path.resolve(__dirname,'../restoredQaHistoricalRuntimeFiles.ts');
 const code=`require('tsx/cjs');require(${JSON.stringify(file)});if(Object.keys(require.cache).some(p=>/[\\\\/]lib[\\\\/]prisma\\.[jt]s$|[\\\\/]systemRecoveryEngine\\.[jt]s$/.test(p)))throw Error('CURRENT_POOL_LOADED');`;
 const result=spawnSync(process.execPath,['-e',code],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');
});
