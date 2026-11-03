import test from 'node:test';import assert from 'node:assert/strict';
import{bindOriginalCompleteImage}from'../../scripts/lib/original-complete-image-selection.mjs';
const d=c=>'sha256:'+c.repeat(64),graph={index:d('a'),platform:d('b'),config:d('c'),rootfsDiffIds:[d('d')],archiveSha256:'e'.repeat(64),archiveBytes:1234},sourceCommit='f'.repeat(40);
const container={Id:'1'.repeat(64),Image:graph.index,ImageManifestDescriptor:{digest:graph.platform,mediaType:'application/vnd.oci.image.manifest.v1+json',size:512,platform:{architecture:'amd64',os:'linux'}},State:{Running:true,StartedAt:'2026-10-27T01:00:00.000Z'}};
test('containerd observes INDEX/platform while canonical health binds CONFIG',()=>{
 const result=bindOriginalCompleteImage({graph,container,sourceCommit,store:'containerd'});assert.equal(result.image,graph.config);assert.equal(result.executionImage,graph.index);assert.notEqual(result.image,result.executionImage);
 assert.throws(()=>bindOriginalCompleteImage({graph,container:{...container,Image:graph.config},sourceCommit,store:'containerd'}),/INDEX_MISMATCH/);
 assert.throws(()=>bindOriginalCompleteImage({graph,container:{...container,ImageManifestDescriptor:{digest:d('9')}},sourceCommit,store:'containerd'}),/DESCRIPTOR_MISMATCH/);
 const classic=bindOriginalCompleteImage({graph,container:{...container,Image:graph.config,ImageManifestDescriptor:undefined},sourceCommit,store:'classic'});assert.equal(classic.executionImage,graph.config);
 assert.throws(()=>bindOriginalCompleteImage({graph,container,sourceCommit,store:'classic'}),/CONFIG_MISMATCH/);
});
