export type LoadingIssueRequest = {
  id: string;
  recovery?: { waybillId: string; invoiceId: string; reason: string };
};

const storageKey = 'sabalan.accounting.pendingLoadingIssues.v1';

function readCommands(actorId: string): Record<string, LoadingIssueRequest> {
  const raw = sessionStorage.getItem(storageKey);
  if (!raw) return {};
  const stored = JSON.parse(raw) as { actorId?: string; commands?: Record<string, LoadingIssueRequest> };
  if (stored.actorId !== actorId) {
    sessionStorage.removeItem(storageKey);
    return {};
  }
  return stored.commands ?? {};
}

export function storedLoadingIssue(actorId: string, loadingId: string): LoadingIssueRequest | undefined {
  try {
    const command = readCommands(actorId)[loadingId];
    if (!command || typeof command.id !== 'string' || !/^[a-f0-9-]{36}$/.test(command.id)) return;
    if (command.recovery !== undefined && (!command.recovery ||
        typeof command.recovery.waybillId !== 'string' || typeof command.recovery.invoiceId !== 'string' ||
        typeof command.recovery.reason !== 'string')) return;
    return command;
  } catch {
    return;
  }
}

export function rememberLoadingIssue(actorId: string, loadingId: string, command: LoadingIssueRequest) {
  try {
    const commands = { ...readCommands(actorId), [loadingId]: command };
    sessionStorage.setItem(storageKey, JSON.stringify({ actorId, commands }));
  } catch {
    // The open tab retains the command in memory if storage is unavailable.
  }
}

export function forgetLoadingIssue(actorId: string, loadingId: string, commandId: string) {
  try {
    const commands = readCommands(actorId);
    if (commands[loadingId]?.id !== commandId) return;
    delete commands[loadingId];
    if (Object.keys(commands).length) sessionStorage.setItem(storageKey, JSON.stringify({ actorId, commands }));
    else sessionStorage.removeItem(storageKey);
  } catch {
    // The current request's authoritative receipt still controls its outcome.
  }
}

export function clearOtherActorLoadingIssues(actorId?: string) {
  try {
    if (actorId) readCommands(actorId);
    else sessionStorage.removeItem(storageKey);
  } catch {
    // There is no recoverable command in an inaccessible or malformed record.
  }
}
