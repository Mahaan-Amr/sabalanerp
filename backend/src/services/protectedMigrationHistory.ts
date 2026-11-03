import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

type HistoryRow=Readonly<{name:string;checksum:string;finished:Date|null;rolledBack:Date|null}>;
function fail(code:string):never{throw Object.assign(new Error(code),{code});}

/** Read the same finite migration inventory used by the existing CLI. */
export function readProtectedMigrationSources(directory:string):Map<string,Buffer>{
 return new Map(fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isDirectory()).map(entry=>{
  if(!/^\d{14}_[a-zA-Z0-9_]+$/.test(entry.name))fail('PROTECTED_MIGRATION_SOURCE_NAME_INVALID');
  return [entry.name,fs.readFileSync(path.join(directory,entry.name,'migration.sql'))] as const;
 }));
}

/** Validate every active history row; rolled-back attempts remain unchanged. */
export function validateProtectedMigrationHistory(rows:readonly HistoryRow[],files:ReadonlyMap<string,Buffer>):Set<string>{
 const applied=new Set<string>();
 for(const row of rows){
  if(row.rolledBack)continue;
  const bytes=files.get(row.name);
  if(!row.finished||applied.has(row.name)||!bytes||createHash('sha256').update(bytes).digest('hex')!==row.checksum)fail('PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION');
  applied.add(row.name);
 }
 return applied;
}
