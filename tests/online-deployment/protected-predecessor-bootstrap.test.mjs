import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {preparePredecessorBootstrap} from './protected-predecessor-bootstrap.mjs';

test('predecessor source is bound to the candidate Git inventory without a database',()=>{
 const result=preparePredecessorBootstrap(path.resolve('.'));
 assert.equal(result.steps.length,439);assert.equal(result.authority,false);
 assert.ok(result.steps.every((step,i)=>/^[a-f0-9]{64}$/.test(step.sha256)&&step.sql.length>0&&(i===0||result.steps[i-1].name<step.name)));
 assert.equal(result.steps.some(step=>step.name==='20261014140000_online_deployment_control'),false);
});
