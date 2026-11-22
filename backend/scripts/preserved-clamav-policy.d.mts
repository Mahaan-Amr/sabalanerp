export type PreservedClamavSelection = {format:'sabalan-preserved-clamav/v1';containerId:string;image:string;startedAt:string;hostPid:number;stableConfigurationSha256:string;initialIdentitySha256:string;initialHealthSha256:string};
export type PreservedClamavBinding = {format:'sabalan-preserved-clamav-binding/v1';planSha256:string;selectionSha256:string;selection:PreservedClamavSelection};
export function canonical(value:unknown):string;
export function hash(value:string|Buffer):string;
export function validateSelection(value:unknown):PreservedClamavSelection;
export function validateBinding(value:unknown):PreservedClamavBinding;
export function selectionBinding(selection:unknown,planSha256:string):PreservedClamavBinding;
