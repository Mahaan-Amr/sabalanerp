/** Test-only host entrypoint. Never imports a test client into runtime code.
 * The exact private config and one-off target require separate review. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runNativeStageFixture} from './protectedCandidateNativeStageFixture';
import {consumeNativeStageIntent} from './protectedCandidateNativeStageIntent';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const base=path.resolve('C:/Users/mahan/AppData/Local/Temp/sabalan-native-fixture-64453e941051405d9fe9979b19a7caf4');
 if(process.platform!=='win32'||process.argv.length!==5||path.resolve(process.argv[2])!==path.join(base,'native-stage-config.json')||process.argv[3]!=='f4abe56272a64bcea0ee2c1d94e68990'||process.argv[4]!=='2f6370305a5b0013d743ed8b9efe685868dd08480aaf5d57d7493d81bf2b64eb')throw Error('NATIVE_TEST_CONFIG_UNKNOWN');
 if(Object.keys(process.env).some(key=>/^(?:PG|PRISMA_|NODE_OPTIONS$)/i.test(key)))throw Error('NATIVE_TEST_ENV_UNKNOWN');
 const read=(name:string)=>{const p=path.join(base,name),s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||fs.realpathSync(p)!==p)throw Error('NATIVE_TEST_CONFIG_UNKNOWN');return fs.readFileSync(p);};
 const config=JSON.parse(read('native-stage-config.json').toString('utf8'));
 const owner=JSON.parse(read('test-owner-7cf.json').toString('utf8'));
 const nativeRoot='/dev/shm/sabalan-native-fixture-64453e941051405d9fe9979b19a7caf4/bef1-ed402e265f7c4ff78a7b2efa012a9b7b';
 if(config.fixtureSource!==nativeRoot+'/fixture'||config.projectionSource!==nativeRoot+'/output/migration-projection-'+owner.deploymentId+'.json'||!/^[a-f0-9]{64}$/.test(config.candidateId))throw Error('NATIVE_TEST_CONFIG_UNKNOWN');
 const manifestBytes=read('artifact-bef1-3106748a8f69432288ff89652ad8dda3/artifact-manifest.json');
 if(sha(manifestBytes)!=='eb5c0ffe48791b93d38d3ab7ab5a79e56ad8b203037049aaebed096c205dd9bf')throw Error('NATIVE_TEST_ARTIFACT_UNKNOWN');
 const manifest=JSON.parse(manifestBytes.toString('utf8'));
 if(manifest.sourceCommit!=='bef1cab9d7e04a930e57e05f67be0feb02055244'||manifest.image!=='sha256:0ad0761aa799e1d3325a474cfbabf9cd9200631717472b71c9e235720212b520'||!process.env.SABALAN_NATIVE_TEST_DATABASE_URL)throw Error('NATIVE_TEST_CONFIG_UNKNOWN');
 const databaseName=consumeNativeStageIntent(base,process.argv[3],process.argv[4],'7667464637415309346');
 const result=await runNativeStageFixture({databaseUrl:process.env.SABALAN_NATIVE_TEST_DATABASE_URL,databaseName,candidateId:config.candidateId,
  candidateImage:manifest.image,targetCommit:manifest.sourceCommit,sourceHash:'fe6814d977f21569cc238cf5c86871911ab8ab7fb6fdb3140bdd0c51b22a762e',
  manifest:manifest.files,projectionSource:config.projectionSource,projectionCopy:path.join(base,'bef1-projection-copy.json'),
  projectionSha256:'be62d14311828c7cd57fcfce0ee5621aa5f45270406eb9cb21468922b23e65ad',fixtureSource:config.fixtureSource,
  artifactCheckout:path.join(base,'artifact-bef1-3106748a8f69432288ff89652ad8dda3'),expectedSystemIdentifier:'7667464637415309346',owner});
 const output=Buffer.from(JSON.stringify({format:'sabalan-native-stage-cli-result/v1',...result,productionAdmission:false})+'\n');
 const fd=fs.openSync(path.join(base,'native-stage-cli-result.json'),'wx',0o600);try{fs.writeFileSync(fd,output);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 process.stdout.write(JSON.stringify({state:result.state,receipt:'native-stage-cli-result.json'})+'\n');
 if(result.state!=='OBSERVED_RETAINED')process.exitCode=1;
}
main().catch(()=>{process.stderr.write('NATIVE_TEST_UNKNOWN\n');process.exitCode=1;});
