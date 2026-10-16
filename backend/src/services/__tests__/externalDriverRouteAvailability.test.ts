import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveWorkspaceRouteAvailability } from '../workspaceRouteAvailability';
const client = (allow: boolean) => ({
 workspacePermission:{findMany:async()=>[]},roleWorkspacePermission:{findMany:async()=>[]},featurePermission:{findMany:async()=>[]},roleFeaturePermission:{findMany:async()=>[]},
 hrWorkspaceAccessGrant:{findMany:async()=>[{workspaceCode:'HUMAN_RESOURCES',level:'VIEW',status:'ACTIVE',effectiveFrom:new Date(0)}]},
 hrFeatureAccessGrant:{findMany:async()=>allow?[{featureCode:'hr_vehicle_operations_view',level:'VIEW',status:'ACTIVE',effectiveFrom:new Date(0)}]:[]},
});
for (const path of ['/dashboard/hr/vehicle-operations','/dashboard/hr/external-drivers/driver','/dashboard/security/external-registry','/dashboard/security/external-drivers/driver']) test(`shared fleet view permission owns ${path}`,async()=>{
 assert.equal((await resolveWorkspaceRouteAvailability(client(true) as never,{userId:'operator',role:'USER',path})).allowed,true);
 assert.equal((await resolveWorkspaceRouteAvailability(client(false) as never,{userId:'operator',role:'USER',path})).allowed,false);
});
