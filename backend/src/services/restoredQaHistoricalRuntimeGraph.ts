/** Opaque historical application graph bound to the actual working callback. */
import path from 'node:path';
import {assertRestoredQaWorkingMaterial,type RestoredQaWorkingMaterial} from './restoredQaWorkingMaterial';
import {historicalRuntimeDirectory,historicalRuntimeFullTree,materializeFixedHistoricalRuntimeGraph} from './restoredQaHistoricalRuntimeFiles';
export {historicalRuntimeRelativePath,inspectFixedHistoricalRuntimeGraph} from './restoredQaHistoricalRuntimeFiles';
type Owner=Readonly<{deploymentId:string;releaseId:string}>;
function need(v:unknown):asserts v{if(!v)throw Error('RESTORED_QA_HISTORICAL_RUNTIME_GRAPH_UNPROVEN');}
const materialSha='8f9fb4f08af5027181232596b6f82fcb5c88b5d34556e629653ef5f3e7d5dc1d';
const baseSha='37f58e13131ada8a8afdd99a202c6592f3dfbf3dbd4b9dddcd9ef2abf16df3d1';
const oldImage='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';
const oldSource='7af34849e2aff4a23a32adb7387bf99283c3864e';
declare const brand:unique symbol;
export type RestoredQaHistoricalRuntimeGraph=Readonly<{[brand]:true}>;
type State={material:RestoredQaWorkingMaterial;owner:Owner;root:string;active:boolean;files:Map<string,string>;rootIdentity:string};
const states=new WeakMap<RestoredQaHistoricalRuntimeGraph,State>();
const used=new WeakSet<RestoredQaWorkingMaterial>();
export function assertRestoredQaHistoricalRuntimeGraph(graph:RestoredQaHistoricalRuntimeGraph,material:RestoredQaWorkingMaterial,owner:Owner){
 const s=states.get(graph);need(s?.active&&s.material===material&&s.owner.deploymentId===owner.deploymentId&&s.owner.releaseId===owner.releaseId);const view=assertRestoredQaWorkingMaterial(material,owner);need(view.root===s.root);
 const output=path.join(s.root,'.restored-qa-runtimes','old89dd','application');need(historicalRuntimeDirectory(output)===s.rootIdentity&&JSON.stringify([...historicalRuntimeFullTree(output)])===JSON.stringify([...s.files]));
 return Object.freeze({kind:'OLD_89DD' as const,sourceImage:oldImage,sourceCommit:oldSource,materialReceiptSha256:materialSha,baseInventorySha256:baseSha});
}
export async function withRestoredQaHistoricalRuntimeGraph<T>(material:RestoredQaWorkingMaterial,owner:Owner,work:(graph:RestoredQaHistoricalRuntimeGraph)=>Promise<T>){
 const view=assertRestoredQaWorkingMaterial(material,owner);need(process.platform==='linux'&&process.getuid?.()===0&&!used.has(material));used.add(material);
 const verified=materializeFixedHistoricalRuntimeGraph(view.root);const output=path.join(view.root,'.restored-qa-runtimes','old89dd','application');need(verified.materialReceiptSha256===materialSha);const graph=Object.freeze({})as RestoredQaHistoricalRuntimeGraph;
 const state:State={material,owner:Object.freeze({...owner}),root:view.root,active:true,files:historicalRuntimeFullTree(output),rootIdentity:historicalRuntimeDirectory(output)};states.set(graph,state);
 try{assertRestoredQaHistoricalRuntimeGraph(graph,material,owner);return await work(graph);}finally{state.active=false;states.delete(graph);}
}
