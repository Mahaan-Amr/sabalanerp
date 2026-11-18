export type MaintenanceImageBinding = {format:'sabalan-maintenance-image-binding/v1';planSha256:string;contentSha256:string;content:{applicationCommit:string;images:Record<'backend'|'frontend'|'inquiry',{image:string}>;[key:string]:unknown}};
export function validateMaintenanceBinding(value:unknown):MaintenanceImageBinding;
export function maintenanceImageBinding(plan:unknown,planSha256:string):MaintenanceImageBinding;
export function validateMaintenanceRecord(record:unknown,binding:unknown):unknown;
export function readMaintenanceRecord(file:string,binding:unknown):unknown;
export function validateMaintenanceResume(session:unknown,first:unknown,record:unknown,inherited:unknown):MaintenanceImageBinding|null;
