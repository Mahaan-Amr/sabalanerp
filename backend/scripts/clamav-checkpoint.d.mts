type IncidentTarget = {receiptSha256: string; image: string};
export function boundIncidentTarget(session: any): IncidentTarget | undefined;
export function verifyUnit(input: {unit: string; id: string; checkpoint?: any; target?: IncidentTarget}): Promise<any>;
export function recoverUnit(input: {unit: string; id: string; checkpoint: any; readArchive: (destination: string) => Promise<void>}): Promise<void>;
export function restoreUnit(input: {bank: string; unit: string; id: string; checkpoint: any; beforeMutation?: () => Promise<void>}): Promise<void>;
export function requireBoundary(input: {session: any; active: any; maintenance: any; id: string; token: string; phase: string}): void;
