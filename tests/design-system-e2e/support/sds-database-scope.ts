/** Only catalog-owned temporary clients. This config is test input, never an
 * application/native ownership grant. The original controller supplies the
 * exact isolated database tuple and waits for fixture disconnect before capture. */
type Environment=Record<string,string|undefined>;
export function sdsDatabaseScope(value:string,environment:Environment=process.env){
 const url=new URL(value),expected=environment.SABALAN_SDS_NATIVE_DATABASE_NAME;
 const database=decodeURIComponent(url.pathname.slice(1));
 let expectedIdentity:{name:string;oid:string;systemIdentifier:string}|undefined;
 if(expected){
  if(!/^qa_application_native_[a-f0-9]{32}$/.test(expected)||database!==expected)throw Error('SDS_ISOLATED_DATABASE_MISMATCH');
  if(!(url.hostname==='postgres'&&url.port==='5432'||['127.0.0.1','localhost'].includes(url.hostname)&&url.port==='55432'))throw Error('SDS_LOCAL_DATABASE_REQUIRED');
  const oid=environment.SABALAN_SDS_NATIVE_DATABASE_OID,systemIdentifier=environment.SABALAN_SDS_NATIVE_SYSTEM_IDENTIFIER;
  if(!oid||!/^\d+$/.test(oid)||!systemIdentifier||!/^\d+$/.test(systemIdentifier))throw Error('SDS_DATABASE_IDENTITY_REQUIRED');
  expectedIdentity={name:expected,oid,systemIdentifier};
 }else if(database!=='sabalanerp'||!['127.0.0.1','localhost'].includes(url.hostname)||url.port!=='55432')throw Error('SDS_LOCAL_DATABASE_REQUIRED');
 const adminUsername=environment.DESIGN_SYSTEM_E2E_ADMIN_USERNAME||'admin';
 if(expected&&!/^native-app-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(adminUsername))throw Error('SDS_ISOLATED_ACTOR_REQUIRED');
 url.searchParams.set('connection_limit','2');url.searchParams.set('pool_timeout','10');
 return {url,adminUsername,expectedIdentity};
}
export async function assertSdsDatabaseIdentity(db:{$queryRaw<T=unknown>(query:TemplateStringsArray,...values:any[]):Promise<T>},scope:ReturnType<typeof sdsDatabaseScope>){
 const expected=scope.expectedIdentity;if(!expected)return;
 const rows=await db.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string}>>`SELECT current_database() AS name, d.oid::text AS oid, p.system_identifier::text AS "systemIdentifier"
  FROM pg_database d CROSS JOIN pg_control_system() p WHERE d.datname=current_database()`;
 if(!Array.isArray(rows)||rows.length!==1||rows[0].name!==expected.name||rows[0].oid!==expected.oid||rows[0].systemIdentifier!==expected.systemIdentifier)throw Error('SDS_DATABASE_IDENTITY_MISMATCH');
}
