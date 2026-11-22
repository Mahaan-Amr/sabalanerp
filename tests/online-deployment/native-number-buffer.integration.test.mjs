import assert from 'node:assert/strict';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import test from 'node:test';

const root=path.resolve(import.meta.dirname,'../..');
const require=createRequire(new URL('../../frontend/package.json',import.meta.url));
const {chromium}=require('@playwright/test'),{buildSync}=require('esbuild');
const bundle=buildSync({absWorkingDir:path.join(root,'frontend'),bundle:true,write:false,platform:'browser',format:'iife',
  define:{'process.env':'{}','process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_BROWSER_BUILD_ID':'"erp_native_number_20261020"'},
  stdin:{resolveDir:path.join(root,'frontend'),loader:'tsx',contents:`
    import React,{useState,useLayoutEffect}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{ErpInput}from'./src/components/erp';import{browserBuildHandoff}from'./src/lib/browserBuildHandoff';
    const lease={userId:'owner',sessionId:'session',generation:1};
    window.nativeNumber={changes:[],inputs:0,immediate:[],preserve:()=>browserBuildHandoff.preserve(lease,()=>{})};
    function Editor(){const[model,setModel]=useState('');window.nativeNumber.model=model;
      useLayoutEffect(()=>browserBuildHandoff.register({userId:'owner',workflow:'native-number-parent',draftId:'number',schemaVersion:1,baseRevision:0,capturePayloadJson:()=>JSON.stringify({model})}),[model]);
      return <ErpInput aria-label="Native numeric draft" type="number" value={model}
        onInput={event=>{window.nativeNumber.inputs++;if(event.currentTarget.validity.badInput)window.nativeNumber.immediate.push(window.nativeNumber.preserve());}}
        onChange={event=>{window.nativeNumber.changes.push(event.currentTarget.value);setModel(event.currentTarget.value);}}/>;}
    flushSync(()=>createRoot(document.getElementById('root')).render(<Editor/>));
  `}}).outputFiles[0].text;

test('actual React canonical numeric input keeps invalid native text and blocks parent preservation before render',{timeout:90000},async()=>{
  const raw=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],{encoding:'utf8'});
  const rows=raw.trim().split(/\r?\n/).filter(Boolean).flatMap(line=>JSON.parse(line));
  for(const service of ['backend','frontend','postgres','inquiry'])assert.ok(rows.some(row=>row.Project==='sabalanerp-local'&&row.Service===service&&row.State==='running'&&row.Health==='healthy'));
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const context=await browser.newContext(),page=await context.newPage();
    const pageErrors=[];page.on('pageerror',error=>pageErrors.push(error.message));
    await page.route('http://localhost:3101/__native_number_qa',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><div id="root"></div>'}));
    await page.goto('http://localhost:3101/__native_number_qa');await page.addScriptTag({content:bundle});
    assert.deepEqual(pageErrors,[], 'React fixture must mount without browser errors');
    assert.equal(await page.locator('input').count(),1,await page.locator('body').innerHTML());
    const input=page.getByRole('spinbutton',{name:'Native numeric draft'});
    await input.pressSequentially('1e');
    const invalid=await page.evaluate(async()=>({badInput:document.querySelector('input').validity.badInput,
      value:document.querySelector('input').value,model:window.nativeNumber.model,changes:window.nativeNumber.changes,
      inputs:window.nativeNumber.inputs,immediate:await Promise.all(window.nativeNumber.immediate),result:await window.nativeNumber.preserve()}));
    assert.equal(invalid.badInput,true);assert.equal(invalid.value,'');assert.equal(invalid.model,'');
    assert.deepEqual(invalid.changes,['1','']);assert.equal(invalid.inputs,2);assert.ok(invalid.immediate.length>0);
    assert.ok(invalid.immediate.every(result=>result.status==='BLOCKED'&&result.archives.length===0));
    assert.equal(invalid.result.status,'BLOCKED');assert.equal(invalid.result.archives.length,0);
    await input.fill('12');
    const valid=await page.evaluate(async()=>({badInput:document.querySelector('input').validity.badInput,
      model:window.nativeNumber.model,result:await window.nativeNumber.preserve()}));
    assert.equal(valid.badInput,false);assert.equal(valid.model,'12');assert.equal(valid.result.status,'PRESERVED');
    await context.close();
  }finally{await browser.close();}
});
