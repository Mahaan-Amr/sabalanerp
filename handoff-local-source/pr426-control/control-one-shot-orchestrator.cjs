"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/** PRIVATE REVIEW CANDIDATE: never run before independent review and authorization. */
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const node_child_process_1 = require("node:child_process");
const base = 'D:/sabalan-private-build-93145311-e0847af934b64f16b286a72e265aaecd';
const workspace = 'C:/Users/mahan/.codex/worktrees/candidate-migration-review/sabalanerp';
const packetSha = '5cee7fd12b3c460895cec90862c6a6e74e05c42bcac7516ad2f3376eb45537ff';
const digest = (b) => (0, node_crypto_1.createHash)('sha256').update(b).digest('hex');
const writeAll=(fd,b)=>{let o=0;while(o<b.length){const n=node_fs_1.default.writeSync(fd,b,o,b.length-o);if(!Number.isSafeInteger(n)||n<=0||n>b.length-o)throw Error('SHORT_WRITE_UNKNOWN');o+=n;}};
let knownId = null, commandHash = null, containerName = null, lastCompletedPhase = 'START';
const writeExclusive = (name, value) => { const fd = node_fs_1.default.openSync(node_path_1.default.join(base, name), 'wx', 0o600); try {
    node_fs_1.default.writeFileSync(fd, JSON.stringify(value) + '\n');
    node_fs_1.default.fsyncSync(fd);
}
finally {
    node_fs_1.default.closeSync(fd);
} };
async function main() {
    if (process.platform !== 'win32' || node_path_1.default.resolve(process.cwd()) !== node_path_1.default.resolve(workspace) || process.argv.length !== 3)
        throw Error('CONTEXT_UNKNOWN');
    const phase = process.argv[2];
    if (!['observer', 'transfer', 'producer'].includes(phase))
        throw Error('PHASE_UNKNOWN');
    const raw = node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-producer-command-packet-v2.json'));
    if (digest(raw) !== packetSha)
        throw Error('PACKET_UNKNOWN');
    const packet = JSON.parse(raw.toString('utf8'));
    const selectedCommand = packet.exactCommands[phase];
    if (!Array.isArray(selectedCommand))
        throw Error('COMMAND_UNKNOWN');
    containerName = selectedCommand[selectedCommand.indexOf('--name') + 1] || null;
    commandHash = digest(Buffer.from(JSON.stringify(selectedCommand)));
    for (const [name, hash] of Object.entries(packet.files))
        if (digest(node_fs_1.default.readFileSync(node_path_1.default.join(base, name))) !== hash)
            throw Error('SOURCE_UNKNOWN');
    const inputs = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-producer-input-manifest.json'), 'utf8'));
    for (const [name, hash] of Object.entries(inputs.files))
        if (digest(node_fs_1.default.readFileSync(node_path_1.default.join(packet.bundle, name))) !== hash)
            throw Error('INPUT_UNKNOWN');
    if (phase !== 'observer') {
        const prior = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-' + (phase === 'transfer' ? 'observer' : 'transfer') + '-receipt.json'), 'utf8'));
        if (prior.format !== 'control-one-shot-receipt/v1' || prior.packetSha !== packetSha || prior.state !== 'OBSERVED' || prior.phase !== (phase === 'transfer' ? 'observer' : 'transfer'))
            throw Error('PRIOR_UNKNOWN');
        if (phase === 'transfer' && (!prior.output || prior.output.state !== 'PARENT_OBSERVED' || prior.output.device !== 57 || prior.output.inode !== 2 || prior.output.uid !== 0 || prior.output.gid !== 0 || prior.output.mode !== 448 || prior.output.newRunAbsent !== true))
            throw Error('PRIOR_OBSERVER_UNKNOWN');
        if (phase === 'producer') {
            const v = prior.output;
            if (!v || v.state !== 'TRANSFER_OBSERVED' || v.files !== 8)
                throw Error('TRANSFER_UNKNOWN');
            for (const x of [v.inputs, v.output, v.fixture])
                if (x.device !== 57 || !Number.isSafeInteger(x.inode) || x.inode <= 0 || x.uid !== 0 || x.gid !== 0 || x.mode !== 448)
                    throw Error('MOUNT_UNKNOWN');
            process.env.SABALAN_CONTROL_INPUT_ID = '57:' + v.inputs.inode;
            process.env.SABALAN_CONTROL_OUTPUT_ID = '57:' + v.output.inode;
        }
    }
    // The first effect is an exclusive, fsynced per-phase attempt marker. It is never removed.
    writeExclusive('control-' + phase + '-attempt.json', { format: 'control-one-shot-attempt/v1', phase, packetSha, state: 'UNKNOWN', productionAdmission: false });
    // Narrow one-shot collector: every spawned process gets private bounded stream files,
    // even if it fails, times out, exceeds its bound or never emits valid JSON.
    let sequence = 0;
    const run = async (args, limit = 30000, onId, sensitive = false) => {
        const label = 'control-' + phase + '-child-' + String(++sequence).padStart(3, '0');
        const stdoutFd = sensitive ? null : node_fs_1.default.openSync(node_path_1.default.join(base, label + '-stdout.bin'), 'wx', 0o600);
        let stderrFd = null;
        try {
            if (!sensitive)
                stderrFd = node_fs_1.default.openSync(node_path_1.default.join(base, label + '-stderr.bin'), 'wx', 0o600);
        }
        catch (e) {
            if (stdoutFd !== null)
                node_fs_1.default.closeSync(stdoutFd);
            throw e;
        }
        const stdoutHash = (0, node_crypto_1.createHash)('sha256'), stderrHash = (0, node_crypto_1.createHash)('sha256');
        return new Promise(resolve => {
            let bad = false, writeFailed = false, total = 0, stdout = '', stderr = '', idRecorded = false;
            let child;
            try {
                child = (0, node_child_process_1.spawn)('C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
            }
            catch {
                if (stdoutFd !== null) {
                    node_fs_1.default.fsyncSync(stdoutFd);
                    node_fs_1.default.closeSync(stdoutFd);
                }
                if (stderrFd !== null) {
                    node_fs_1.default.fsyncSync(stderrFd);
                    node_fs_1.default.closeSync(stderrFd);
                }
                resolve({ state: 'UNKNOWN', stdout: '', stderr: '' });
                return;
            }
            const timer = setTimeout(() => { bad = true; }, limit);
            const capture = (dest, fd) => (chunk) => {
                try {
                    (dest === 'stdout' ? stdoutHash : stderrHash).update(chunk);
                    const remaining = Math.max(0, 1024 * 1024 - total), piece = chunk.subarray(0, remaining);
                    total += chunk.length;
                    if (piece.length) {
                        if (fd !== null) {
                            if (!writeFailed) writeAll(fd, piece);
                            node_fs_1.default.fsyncSync(fd);
                        }
                        if (dest === 'stdout')
                            stdout += piece.toString('utf8');
                        else
                            stderr += piece.toString('utf8');
                    }
                    if (total > 1024 * 1024)
                        bad = true;
                    if (onId && !idRecorded && dest === 'stdout') {
                        const line = stdout.split(/\r?\n/)[0];
                        if (/^[a-f0-9]{64}$/.test(line) && /\r?\n/.test(stdout)) {
                            writeExclusive('control-' + phase + '-container-id.json', { phase, id: line, state: 'STARTED', productionAdmission: false });
                            idRecorded = true;
                            onId(line);
                        }
                    }
                }
                catch {
                    bad = true; writeFailed = true;
                }
            };
            if (!child.stdout || !child.stderr)
                bad = true;
            else {
                child.stdout.on('data', capture('stdout', stdoutFd));
                child.stderr.on('data', capture('stderr', stderrFd));
            }
            child.on('error', () => { bad = true; });
            child.on('close', (code, signal) => {
                clearTimeout(timer);
                try {
                    if (stdoutFd !== null) {
                        node_fs_1.default.fsyncSync(stdoutFd);
                        node_fs_1.default.closeSync(stdoutFd);
                    }
                    if (stderrFd !== null) {
                        node_fs_1.default.fsyncSync(stderrFd);
                        node_fs_1.default.closeSync(stderrFd);
                    }
                    writeExclusive(label + '-state.json', { state: !bad && code === 0 && signal === null ? 'SUCCESS' : 'UNKNOWN', exitCode: code, signal, bytesObserved: total, limitExceeded: total > 1024 * 1024, sensitiveCapture: sensitive, stdoutSha256: stdoutHash.digest('hex'), stderrSha256: stderrHash.digest('hex'), productionAdmission: false });
                }
                catch {
                    bad = true;
                }
                resolve({ state: !bad && code === 0 && signal === null ? 'SUCCESS' : 'UNKNOWN', stdout, stderr });
            });
        });
    };
    const guarded = async (args, limit = 30000, onId, sensitive = false) => { const ps = await run(['compose', '-p', 'sabalanerp-local', '-f', 'docker-compose.local.yml', 'ps', '--format', 'json']); if (ps.state !== 'SUCCESS')
        throw Error('PS_UNKNOWN'); return run(args, limit, onId, sensitive); };
    const checked = async (args, limit = 30000, onId, sensitive = false) => { const r = await guarded(args, limit, onId, sensitive); if (r.state !== 'SUCCESS')
        throw Error('CHILD_UNKNOWN'); return r; };
    const cmd = packet.exactCommands[phase], name = cmd[cmd.indexOf('--name') + 1];
    containerName = name;
    commandHash = digest(Buffer.from(JSON.stringify(cmd)));
    lastCompletedPhase = 'PACKET_AND_PRIOR_VERIFIED';
    const override = cmd[cmd.indexOf('-f', cmd.indexOf('-f') + 1) + 1];
    if (phase === 'producer') process.env.TEST_INPUT_SHA256 = inputs.files['test-host-input.json'];
    const config = await checked(['compose', '-p', 'sabalanerp-local', '-f', 'docker-compose.local.yml', '-f', override, 'config', '--format', 'json'], 30000, undefined, true);
    const svc = JSON.parse(config.stdout).services?.backend;
    if (!svc || svc.image !== packet.image || svc.build || svc.network_mode !== 'none' || svc.read_only !== true || (svc.ports || []).length || (svc.depends_on && Object.keys(svc.depends_on).length))
        throw Error('PRECONFIG_UNKNOWN');
    const nativePre = '/dev/shm/sabalan-native-fixture-64453e941051405d9fe9979b19a7caf4', runPre = nativePre + '/control-e2cc9d5fec4c4f6986fd18be516f8c5b';
    const mountsPre = phase === 'observer' ? [{ target: '/parent', source: nativePre, ro: true }] : phase === 'transfer' ? [{ target: '/source', source: packet.bundle, ro: true }, { target: '/target', source: nativePre, ro: false }] : [{ target: '/inputs', source: runPre + '/inputs', ro: true }, { target: '/work/.deploy-state', source: runPre + '/output', ro: false }];
    if (!Array.isArray(svc.volumes) || svc.volumes.length !== mountsPre.length)
        throw Error('PRECONFIG_UNKNOWN');
    for (const v of mountsPre)
        if (svc.volumes.filter((m) => m.type === 'bind' && m.target === v.target && m.source.replace(/\\/g, '/').toLowerCase() === v.source.replace(/\\/g, '/').toLowerCase() && Boolean(m.read_only) === v.ro && m.bind?.create_host_path === false).length !== 1)
            throw Error('PRECONFIG_UNKNOWN');
    const preEntry = phase === 'producer' ? ['/bin/sh'] : ['/usr/bin/python3'];
    const preArgs = phase === 'producer' ? ['/inputs/producer.sh'] : ['-I', '-B', '-c', node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-' + phase + '.py'), 'utf8')];
    if (JSON.stringify(svc.entrypoint) !== JSON.stringify(preEntry) || JSON.stringify(svc.command) !== JSON.stringify(preArgs))
        throw Error('PRECONFIG_UNKNOWN');
    const env = svc.environment || {}, expectedEnv = phase === 'producer' ? { TEST_INPUT_SHA256: inputs.files['test-host-input.json'], TEST_INPUT_ID: process.env.SABALAN_CONTROL_INPUT_ID, TEST_OUTPUT_ID: process.env.SABALAN_CONTROL_OUTPUT_ID } : {};
    if (Object.keys(env).sort().join(',') !== Object.keys(expectedEnv).sort().join(',') || Object.entries(expectedEnv).some(([k, v]) => env[k] !== v))
        throw Error('PRECONFIG_UNKNOWN');
    writeExclusive('control-' + phase + '-config-summary.json', { format: 'control-sanitized-compose-config/v1', phase, image: svc.image, network: 'none', readOnly: true, mountTargets: mountsPre.map(x => ({ target: x.target, readOnly: x.ro })), environmentKeys: Object.keys(expectedEnv).sort(), productionAdmission: false });
    lastCompletedPhase = 'COMPOSE_CONFIG_VERIFIED';
    const names = await checked(['ps', '--all', '--filter', 'name=^/' + name + '$', '--format', '{{.Names}}']);
    if (names.stdout.trim())
        throw Error('NAME_EXISTS');
    let capturedId = '';
    const spawned = await checked(cmd.slice(1), 120000, value => { capturedId = value; knownId = value; lastCompletedPhase = 'CONTAINER_ID_CAPTURED'; }), id = spawned.stdout.trim();
    if (id !== capturedId)
        throw Error('ID_CAPTURE_UNKNOWN');
    if (!/^[a-f0-9]{64}$/.test(id))
        throw Error('CONTAINER_ID_UNKNOWN');
    const result = await checked(['inspect', id], 30000, undefined, true);
    const [c] = JSON.parse(result.stdout);
    const wanted = phase === 'observer' ? ['/parent'] : phase === 'transfer' ? ['/source', '/target'] : ['/inputs', '/work/.deploy-state'];
    if (c.Id !== id || c.Image !== packet.image || c.Config?.Labels?.['com.docker.compose.project'] !== 'sabalanerp-local' || c.Config?.Labels?.['com.docker.compose.service'] !== 'backend' || String(c.Config?.Labels?.['com.docker.compose.oneoff']).toLowerCase() !== 'true' || c.HostConfig?.ReadonlyRootfs !== true || c.HostConfig?.NetworkMode !== 'none' || c.Mounts?.length !== wanted.length || wanted.some(t => !c.Mounts.some((m) => m.Destination === t && m.Type === 'bind')) || (c.Config.Env || []).some((v) => v.startsWith('DATABASE_URL=')))
        throw Error('CONTAINER_CONFIG_UNKNOWN');
    const native = '/dev/shm/sabalan-native-fixture-64453e941051405d9fe9979b19a7caf4', runRoot = native + '/control-e2cc9d5fec4c4f6986fd18be516f8c5b';
    const expected = phase === 'observer' ? [{ target: '/parent', source: native, rw: false }] : phase === 'transfer' ? [{ target: '/source', source: packet.bundle, rw: false }, { target: '/target', source: native, rw: true }] : [{ target: '/inputs', source: runRoot + '/inputs', rw: false }, { target: '/work/.deploy-state', source: runRoot + '/output', rw: true }];
    for (const x of expected) {
        const matches = c.Mounts.filter((m) => m.Destination === x.target && m.Source.replace(/\\/g, '/').toLowerCase() === x.source.replace(/\\/g, '/').toLowerCase() && m.RW === x.rw);
        if (matches.length !== 1)
            throw Error('MOUNT_UNKNOWN');
    }
    const entry = phase === 'producer' ? ['/bin/sh'] : ['/usr/bin/python3'];
    const args = phase === 'producer' ? ['/inputs/producer.sh'] : ['-I', '-B', '-c', node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-' + phase + '.py'), 'utf8')];
    if (JSON.stringify(c.Config.Entrypoint) !== JSON.stringify(entry) || JSON.stringify(c.Config.Cmd) !== JSON.stringify(args))
        throw Error('COMMAND_UNKNOWN');
    const waited = await checked(['wait', id], 480000);
    if (waited.stdout.trim() !== '0')
        throw Error('CONTAINER_EXIT_UNKNOWN');
    lastCompletedPhase = 'CONTAINER_WAIT_EXIT_ZERO';
    const closure = await checked(['inspect', id], 30000, undefined, true);
    const [final] = JSON.parse(closure.stdout);
    if (final.Id !== id || final.State?.Running !== false || final.State?.ExitCode !== 0 || final.State?.FinishedAt === '0001-01-01T00:00:00Z' || final.State?.StartedAt !== c.State?.StartedAt)
        throw Error('CONTAINER_CLOSURE_UNKNOWN');
    const logs = await checked(['logs', id]);
    let output;
    try {
        output = JSON.parse(logs.stdout.trim());
    }
    catch {
        throw Error('OUTPUT_UNKNOWN');
    }
    if (phase === 'observer' && (output.state !== 'PARENT_OBSERVED' || output.device !== 57 || output.inode !== 2 || output.uid !== 0 || output.gid !== 0 || output.mode !== 448 || output.newRunAbsent !== true))
        throw Error('OBSERVER_UNKNOWN');
    if (phase === 'transfer' && (output.state !== 'TRANSFER_OBSERVED' || output.files !== 8))
        throw Error('TRANSFER_UNKNOWN');
    if (phase === 'producer' && (output.testOnly !== true || output.releaseAdmission !== false || !/^\/work\/\.deploy-state\/migration-projection-test-candidate-[a-f0-9]{32}\.json$/.test(output.file) || !/^[a-f0-9]{64}$/.test(output.sha256)))
        throw Error('PRODUCER_UNKNOWN');
    if (phase === 'producer') {
        const cp = await checked(['cp', id + ':' + output.file, '-']);
        void cp;
        const tar = node_fs_1.default.readFileSync(node_path_1.default.join(base, 'control-' + phase + '-child-' + String(sequence).padStart(3, '0') + '-stdout.bin'));
        if (tar.length < 1024 || tar.length % 512 !== 0)
            throw Error('PROJECTION_TAR_UNKNOWN');
        const head = tar.subarray(0, 512), field = (a, n) => head.subarray(a, a + n).toString('ascii').replace(/\0.*$/s, '').trim();
        const oct = (a, n) => { const value = field(a, n); if (!/^[0-7]+$/.test(value))
            throw Error('TAR_HEADER_UNKNOWN'); return parseInt(value, 8); };
        const saved = oct(148, 8);
        let sum = 0;
        for (let i = 0; i < 512; i++)
            sum += i >= 148 && i < 156 ? 32 : head[i];
        if (sum !== saved)
            throw Error('TAR_HEADER_UNKNOWN');
        const filename = output.file.split('/').pop(), name = field(0, 100), size = oct(124, 12), type = field(156, 1);
        if (name !== filename || oct(100, 8) !== 0o400 || oct(108, 8) !== 0 || !(type === '' || type === '0') || size <= 0 || size > 1048576 || 512 + size > tar.length)
            throw Error('PROJECTION_METADATA_UNKNOWN');
        const bytes = tar.subarray(512, 512 + size);
        if (digest(bytes) !== output.sha256)
            throw Error('PROJECTION_HASH_UNKNOWN');
        const actual = JSON.parse(bytes.toString('utf8')), input = JSON.parse(node_fs_1.default.readFileSync(node_path_1.default.join(packet.bundle, 'test-host-input.json'), 'utf8'));
        if (actual.format !== 'sabalan-build-migration-projection/v1' || actual.deploymentId !== input.deploymentId || actual.releaseId !== input.releaseId || actual.applicationCommit !== input.selection.applicationCommit || actual.applicationTree !== input.applicationTree || actual.applicationSourceHash !== input.selection.applicationSourceHash || actual.backendImage !== packet.image || actual.planSha256 !== input.planSha256 || actual.inventory?.sha256 !== input.inventory.sha256 || actual.inventory?.releaseAdmission !== false)
            throw Error('PROJECTION_BINDING_UNKNOWN');
        const fd = node_fs_1.default.openSync(node_path_1.default.join(base, 'control-projection-copy.json'), 'wx', 0o600);
        try {
            node_fs_1.default.writeFileSync(fd, bytes);
            node_fs_1.default.fsyncSync(fd);
        }
        finally {
            node_fs_1.default.closeSync(fd);
        }
        output = { ...output, readback: { sha256: digest(bytes), tarUid: 0, tarMode: '0400', regular: true, nlink: 'NOT_PROVEN_BY_TAR', binding: 'MATCHED' } };
    }
    writeExclusive('control-' + phase + '-logs.json', { stdout: logs.stdout, stderr: logs.stderr });
    writeExclusive('control-' + phase + '-receipt.json', { format: 'control-one-shot-receipt/v1', phase, state: 'OBSERVED', packetSha, containerId: id, exitCode: 0, output, logsStdoutSha256: digest(Buffer.from(logs.stdout)), logsStderrSha256: digest(Buffer.from(logs.stderr)), productionAdmission: false });
    console.log(JSON.stringify({ phase, state: 'OBSERVED', receipt: 'control-' + phase + '-receipt.json' }));
}
main().catch(() => { const phase = process.argv[2]; if (['observer', 'transfer', 'producer'].includes(phase))
    try {
        writeExclusive('control-' + phase + '-unknown.json', { format: 'control-one-shot-unknown/v1', phase, state: 'UNKNOWN', packetSha, commandHash, containerName, knownId, lastCompletedPhase, productionAdmission: false });
    }
    catch { } process.stderr.write('ONE_SHOT_UNKNOWN_NO_RETRY\n'); process.exitCode = 1; });
