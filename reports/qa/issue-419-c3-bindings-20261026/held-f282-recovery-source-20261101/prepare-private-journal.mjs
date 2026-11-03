import{prepareOriginalPrivateEvidenceDirectory}from'file:///C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp/scripts/lib/original-private-evidence-directory.mjs';
import path from'node:path';
const directory=path.resolve(process.argv[2]);await prepareOriginalPrivateEvidenceDirectory(directory);console.log(JSON.stringify({privateJournalPrepared:true,allOriginalChildrenClosed:true,directory}));
