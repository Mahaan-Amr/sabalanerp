export type RunAction = (action: () => Promise<any>, message: string) => Promise<void>;
export const today = () => new Date().toISOString().slice(0, 10);
export const field = 'space-y-1.5 text-sm font-medium sds-text-secondary';
