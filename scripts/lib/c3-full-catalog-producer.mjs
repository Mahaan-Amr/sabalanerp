/** Adapt only source/compiled inputs of the immutable catalog producer.
 * Existing dependency bytes and controller templates remain SHA-bound. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {completePlanReader,completePlanSha as sha,writeCompletePlanFile} from './original-complete-plan-files.mjs';
const template={file:path.resolve('D:/sabalanerp-online-qa/C17-full-catalog-budget-source-20261024/external-producer/prepare-full-catalog-source-current.mjs'),sha256:'d283b61b3c3fdc49a68252ad81db4a0e97f9171f3eac891a11d5d3e8b6b5b9de'};
const previous={file:path.resolve('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/reports/qa/full-catalog-source-04b7edb58905c23e2f0684f21f1efe16.json'),sha256:'f86a26b4064684cd072636351846c7ccde9fb47f10c0c18c50cd2632e8b67153'};
export function renderC3FullCatalogProducer(root,directory){
 root=path.resolve(root);directory=path.resolve(directory);assert.equal(root,path.resolve('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp'));
 const reader=completePlanReader(),old=JSON.parse(reader.read(previous)),dependencyRoot=path.resolve(old.sourceRoot),manifest={file:path.join(dependencyRoot,'source-manifest.json'),sha256:old.manifestSha256};
 assert.equal(manifest.sha256,'cd3bd1b7a8c240f7e168f444b723352dffff15f6694480f1fcb62a9a255809f7');const dependencies=JSON.parse(reader.read(manifest));let source=reader.read(template).toString();
 const replace=(before,after)=>{assert.equal(source.split(before).length,2,'C3_CATALOG_TEMPLATE_CHANGED');source=source.replace(before,after);};
 const url=relative=>pathToFileURL(path.join(root,relative)).href;
 replace("const repository='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';",'const repository='+JSON.stringify(root)+';');
 replace("const require=createRequire(path.join(repository,'frontend/package.json'));","const require=createRequire(path.join(repository,'backend/package.json'));");
 // The codegen receipt pins the original generator files' actual inode/EOL
 // identity. Validate that recorded provenance with the current verifier;
 // never pretend a different checkout is that original generator incarnation.
 replace('repositoryRoot:repository,extractionReceiptFile:receiptPath','repositoryRoot:'+JSON.stringify(path.resolve('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp'))+',extractionReceiptFile:receiptPath');
 replace("const schema=fs.readFileSync(path.join(repository,'backend/prisma/schema.prisma')),modelNames=", "const schema=fs.readFileSync(path.join(repository,'backend/prisma/schema.prisma'));assert.equal(sha(schema),generation.generation.sourceSchemaSha256,'CURRENT_CATALOG_GENERATION_SCHEMA_CHANGED');const modelNames=");
 replace('const preparation=import.meta.dirname,args=', 'const preparation='+JSON.stringify(directory)+',args=');
 for(const relative of ['scripts/lib/private-linux-prisma-receipt.mjs','scripts/lib/application-native-full-catalog-artifacts.mjs'])replace('file:///C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp/'+relative,url(relative));
 replace('assert.equal(compiled.commands.length,4);','assertCatalogCompilerOriginals(compiled);');
 source='import {assertCatalogCompilerOriginals} from '+JSON.stringify(url('scripts/lib/application-native-full-catalog-artifacts.mjs'))+';\n'+source;
 const marker='const preparation=';
 const definitions='const frozenDependencyRoot='+JSON.stringify(dependencyRoot)+';const frozenManifestFile='+JSON.stringify(manifest.file)+';const frozenManifestRaw=fs.readFileSync(frozenManifestFile);assert.equal(createHash("sha256").update(frozenManifestRaw).digest("hex"),'+JSON.stringify(manifest.sha256)+');const frozenDependencyFiles=JSON.parse(frozenManifestRaw).files;\n';
 assert.equal(source.split(marker).length,2);source=source.replace(marker,definitions+marker);
 replace("copy(path.join(repository,'node_modules',name),'node_modules/'+name)","copy(path.join(frozenDependencyRoot,'node_modules',name),'node_modules/'+name)");
 replace("copy(path.join(preparation,name),name)","copy(path.join(frozenDependencyRoot,name),name)");
 replace("const zod=path.dirname(domainRequire.resolve('zod/package.json'));","const zod=path.join(frozenDependencyRoot,'node_modules/zod');");
 replace("const decimal=path.dirname(graphRequire.resolve('decimal.js/package.json'));","const decimal=path.join(frozenDependencyRoot,'node_modules/decimal.js');");
 replace("assert.ok(before.isFile()&&before.nlink===1n);const bytes=fs.readFileSync(source),after=fs.lstatSync(source,{bigint:true});", "assert.ok(before.isFile()&&before.nlink===1n);const bytes=fs.readFileSync(source),after=fs.lstatSync(source,{bigint:true});const relativeDependency=path.relative(frozenDependencyRoot,source).split(path.sep).join('/');if(!relativeDependency.startsWith('../')&&!path.isAbsolute(relativeDependency)){const expected=frozenDependencyFiles[relativeDependency];assert.ok(expected,'UNPINNED_CATALOG_DEPENDENCY');assert.equal(bytes.length,expected.bytes);assert.equal(sha(bytes),expected.sha256,'CATALOG_DEPENDENCY_CHANGED');}");
 // All reused dependencies are checked before and after the producer child.
 for(const [name,row]of Object.entries(dependencies.files))if(name.startsWith('node_modules/')||['run-full-catalog-controller.py','playwright.full-catalog.config.ts'].includes(name))reader.read({file:path.join(dependencyRoot,...name.split('/')),sha256:row.sha256},128*1024**2);
 return {raw:Buffer.from(source),provenance:{template,previous,manifest,compilerRebuilt:false,imagesRebuilt:false},revalidate:()=>reader.revalidate()};
}
export function packageC3FullCatalogProducer(root,directory){
 assert.equal(fs.existsSync(directory),false);fs.mkdirSync(directory,{mode:0o700});const rendered=renderC3FullCatalogProducer(root,directory),file=writeCompletePlanFile(directory,'prepare-c3-catalog.mjs',rendered.raw);rendered.revalidate();
 return {...file,...rendered,sha256:sha(rendered.raw)};
}
