"""Bounded source matrix only. No runtime, Docker, SQL, SSH or build command."""
import ast,hashlib,json,pathlib,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[3];OUT=pathlib.Path(__file__).parent
NODE='C:/Program Files/nodejs/node.exe';PYTHON='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'
base=json.loads((ROOT/'reports/qa/issue-417-complete-20261025/RECEIPT.json').read_bytes())['tests']['command'].split()[3:]
extra=['serial-physical-owner.test.mjs','serial-physical-child.test.mjs','serial-bounded-runner.test.mjs','serial-host-lease.test.mjs',
 'serial-physical-completion.test.mjs','independent-physical-replay.test.mjs','independent-wal-window.test.mjs','independent-online-components.test.cjs',
 'independent-full-restore-controller.test.mjs','original-client-wal-cycles.test.mjs','original-client-terminal-barrier.test.mjs',
 'independent-components-evidence.test.mjs','same-compose-physical.test.mjs','same-compose-physical-dispatch.test.mjs',
 'physical-application-worker.test.mjs','physical-origin-revocation.test.mjs','same-compose-applications.test.mjs']
node_files=base+['tests/online-deployment/'+name for name in extra]
assert all((ROOT/file).is_file()for file in node_files)
commands=[('node-source-final.tap',[NODE,'--max-old-space-size=512','--test','--test-concurrency=2',*node_files]),
 ('typescript-tests-final.tap',[NODE,'--max-old-space-size=512',str(ROOT/'backend/node_modules/tsx/dist/cli.mjs'),'--test','tests/online-deployment/same-compose-physical-evidence.test.ts','tests/online-deployment/online-qualification-evidence.test.ts'])]
for name in ['protected-complete-local-scope.test.py','independent-prepoint-wal-binding.test.py','independent-wal-window.test.py','independent-online-layout.test.py','original-master-response-port.test.py','application-native-migration-custody.test.py']:
 commands.append((name+'.txt',[PYTHON,'-I','-B','tests/online-deployment/'+name]))
results=[]
for log,command in commands:
 result=subprocess.run(command,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (OUT/log).write_bytes(result.stdout);results.append(dict(command=command,log=log,exitCode=result.returncode,sha256=hashlib.sha256(result.stdout).hexdigest()))
 print(json.dumps(dict(log=log,exitCode=result.returncode)),flush=True)
changed=subprocess.check_output(['git','-C',str(ROOT),'diff','--name-only','f883044e271b19e7e7672b0e85189720da9260f0','HEAD']).decode().splitlines()
for file in changed:
 if file.endswith('.py'):ast.parse((ROOT/file).read_text(encoding='utf-8'))
 if file.endswith(('.mjs','.cjs')):subprocess.run([NODE,'--check',file],cwd=ROOT,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
(OUT/'TESTS.json').write_text(json.dumps(dict(format='sabalan-source12-test-matrix/v1',results=results,syntaxChecked=True,nativeQualification=False),indent=2)+'\n',encoding='utf-8')
assert all(row['exitCode']==0 for row in results),'SOURCE_MATRIX_FAILED_SEE_LOGS'
