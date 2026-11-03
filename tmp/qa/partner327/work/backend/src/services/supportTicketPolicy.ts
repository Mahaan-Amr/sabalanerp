export type TicketParticipantRole = 'HANDLER' | 'COLLABORATOR' | 'WATCHER';
export type TicketPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
export type TicketImpact = 'MINOR' | 'SINGLE_TASK' | 'BLOCKED' | 'WIDESPREAD';

type TicketAccessActor = {
  id: string;
  role: string;
  managedWorkspaces: string[];
  accessibleWorkspaces?: string[];
  accessibleFeatures?: string[];
  managedFeatures?: string[];
  securityIncidentHandler?: boolean;
};

type TicketAccessSubject = {
  reporterId: string;
  workspace?: string | null;
  feature?: string | null;
  restrictedIncident: boolean;
  participants: Array<{ userId: string; role: TicketParticipantRole }>;
};

const SECRET_KEY = /(password|passcode|pin|access.?code|verification.?code|token|cookie|secret|authorization|otp|credential|encryption|private.?key|api.?key|recovery.?code|رمز|گذرواژه|توکن|کوکی|کلید|کد.?بازیابی|کد.?(?:تأیید|تایید|ورود|امنیتی))/i;
const SECRET_VALUE = /(bearer\s+[a-z0-9._-]+|(?:password|passcode|pin|access.?code|verification.?code|token|session|otp|authorization(?:\s+code)?|api.?key|private.?key|secret|cookie|credential|recovery.?code|رمز(?:\s*عبور)?|گذرواژه|توکن|کوکی|کلید|کد.?(?:بازیابی|تأیید|تایید|ورود|امنیتی))\s*(?:(?:is|است|شما)\s*)?[=:：]?\s*\S+|(?:otp|one.?time|pin|access.?code|verification.?code|کد\s*(?:تأیید|تایید|ورود|یکبار.?مصرف|امنیتی))\D{0,16}[0-9۰-۹٠-٩]{4,8}|-----BEGIN [A-Z ]*(?:PRIVATE KEY|CERTIFICATE)-----|\beyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\b|\b[a-z0-9_-]{40,}\b|\b[a-z0-9+/]{40,}={0,2}\b)/i;

export function canAccessTicket(actor: TicketAccessActor, ticket: TicketAccessSubject): boolean {
  if (actor.role === 'ADMIN') return true;
  if (ticket.restrictedIncident) {
    return Boolean(actor.securityIncidentHandler) || actor.id === ticket.reporterId;
  }
  if (actor.id === ticket.reporterId) return true;
  if (ticket.participants.some((participant) => participant.userId === actor.id)) return true;
  const featureAllowed = !ticket.feature
    || actor.managedFeatures?.includes(`${ticket.workspace || ''}:${ticket.feature}`);
  return actor.role === 'MANAGER'
    && Boolean(ticket.workspace)
    && actor.managedWorkspaces.includes(ticket.workspace!)
    && Boolean(featureAllowed);
}

export function canAccessSensitiveEvidence(actor: TicketAccessActor, ticket: TicketAccessSubject): boolean {
  if (!canAccessTicket(actor, ticket)) return false;
  if (actor.id === ticket.reporterId) return true;
  if (ticket.restrictedIncident && actor.role !== 'ADMIN' && !actor.securityIncidentHandler) return false;
  const participant = ticket.participants.find((item) => item.userId === actor.id);
  if (participant?.role === 'WATCHER') return false;
  if (actor.role === 'ADMIN') return true;
  if (!ticket.workspace) return actor.id === ticket.reporterId;
  const workspaceAllowed = (actor.accessibleWorkspaces || actor.managedWorkspaces).includes(ticket.workspace);
  const featureAllowed = !ticket.feature
    || actor.accessibleFeatures?.includes(`${ticket.workspace}:${ticket.feature}`);
  return workspaceAllowed && Boolean(featureAllowed);
}

export function deriveSuggestedPriority(input: {
  impact: TicketImpact;
  workaroundExists: boolean;
  restrictedIncident: boolean;
  workspace?: string | null;
}): TicketPriority {
  if (input.restrictedIncident || input.impact === 'WIDESPREAD') return 'URGENT';
  const criticalWorkspace = input.workspace === 'accounting' || input.workspace === 'security';
  if (input.impact === 'BLOCKED') return input.workaroundExists ? 'NORMAL' : 'HIGH';
  if (input.impact === 'SINGLE_TASK') return input.workaroundExists && !criticalWorkspace ? 'NORMAL' : 'HIGH';
  return criticalWorkspace ? 'NORMAL' : 'LOW';
}

export function canMutateTicket(
  participantRole: TicketParticipantRole | null,
  workspaceHandler: boolean,
  restrictedIncident: boolean,
): boolean {
  if (restrictedIncident) {
    return workspaceHandler || participantRole === 'HANDLER' || participantRole === 'COLLABORATOR';
  }
  return workspaceHandler || participantRole === 'HANDLER' || participantRole === 'COLLABORATOR';
}

const allowedTransitions: Record<string, string[]> = {
  NEW: ['TRIAGED', 'IN_PROGRESS', 'WAITING_REPORTER', 'RESOLVED', 'DUPLICATE'],
  TRIAGED: ['IN_PROGRESS', 'WAITING_REPORTER', 'RESOLVED', 'DUPLICATE'],
  IN_PROGRESS: ['WAITING_REPORTER', 'RESOLVED', 'DUPLICATE'],
  WAITING_REPORTER: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'],
  DUPLICATE: ['RESOLVED', 'CLOSED'],
  CLOSED: [],
};

export function canTransitionTicket(from: string, to: string): boolean {
  return Boolean(allowedTransitions[from]?.includes(to));
}

export function shouldAutoCloseWaitingTicket(input: {
  restrictedIncident: boolean;
  waitingSince: Date | null;
  now: Date;
  elapsedSupportDays: number;
}): boolean {
  return !input.restrictedIncident
    && Boolean(input.waitingSince)
    && input.elapsedSupportDays >= 7
    && input.now >= input.waitingSince!;
}

export type SanitizedDiagnosticSnapshot = {
  route?: string;
  pageTitle?: string;
  buildCommit?: string;
  viewport?: { width: number; height: number };
  userAgentCategory?: string;
  errors?: string[];
  recordIdentifiers?: Record<string, string>;
};

export function sanitizeDiagnosticSnapshot(input: unknown): SanitizedDiagnosticSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  const output: SanitizedDiagnosticSnapshot = {};
  if (typeof value.route === 'string') {
    const route = value.route.split(/[?#]/, 1)[0];
    if (route.startsWith('/dashboard/')) output.route = route.slice(0, 500);
  }
  if (typeof value.pageTitle === 'string') output.pageTitle = value.pageTitle.slice(0, 200);
  if (typeof value.buildCommit === 'string' && /^[a-zA-Z0-9._-]{1,80}$/.test(value.buildCommit)) {
    output.buildCommit = value.buildCommit;
  }
  if (value.viewport && typeof value.viewport === 'object' && !Array.isArray(value.viewport)) {
    const viewport = value.viewport as Record<string, unknown>;
    if (Number.isFinite(viewport.width) && Number.isFinite(viewport.height)) {
      output.viewport = {
        width: Math.max(0, Math.min(10_000, Number(viewport.width))),
        height: Math.max(0, Math.min(10_000, Number(viewport.height))),
      };
    }
  }
  if (typeof value.userAgentCategory === 'string' && !SECRET_VALUE.test(value.userAgentCategory)) {
    output.userAgentCategory = value.userAgentCategory.slice(0, 80);
  }
  if (Array.isArray(value.errors)) {
    const errors = value.errors
      .filter((entry): entry is string => typeof entry === 'string')
      .filter((entry) => !SECRET_VALUE.test(entry))
      .map((entry) => entry.slice(0, 500))
      .slice(0, 20);
    if (errors.length) output.errors = errors;
  }
  if (value.recordIdentifiers && typeof value.recordIdentifiers === 'object' && !Array.isArray(value.recordIdentifiers)) {
    const identifiers = Object.fromEntries(
      Object.entries(value.recordIdentifiers as Record<string, unknown>)
        .filter(([key, entry]) => !SECRET_KEY.test(key) && typeof entry === 'string')
        .map(([key, entry]) => [key.slice(0, 80), String(entry).slice(0, 160)])
        .slice(0, 20),
    );
    if (Object.keys(identifiers).length) output.recordIdentifiers = identifiers;
  }
  return output;
}

export type SensitiveEvidenceSnapshot = {
  pageText?: string;
  formValues?: Record<string, string | boolean | number>;
  uploadedFileMetadata?: Array<{ name: string; size: number; type: string }>;
};

export function sanitizeSensitiveEvidenceSnapshot(input: unknown): SensitiveEvidenceSnapshot {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const value = input as Record<string, unknown>;
  const output: SensitiveEvidenceSnapshot = {};
  if (typeof value.pageText === 'string' && !SECRET_VALUE.test(value.pageText)) {
    output.pageText = value.pageText.slice(0, 20_000);
  }
  if (value.formValues && typeof value.formValues === 'object' && !Array.isArray(value.formValues)) {
    output.formValues = Object.fromEntries(
      Object.entries(value.formValues as Record<string, unknown>)
        .filter(([key, entry]) => !SECRET_KEY.test(key) && ['string', 'boolean', 'number'].includes(typeof entry))
        .filter(([, entry]) => typeof entry !== 'string' || !SECRET_VALUE.test(entry))
        .map(([key, entry]) => [key.slice(0, 120), typeof entry === 'string' ? entry.slice(0, 2_000) : entry as boolean | number])
        .slice(0, 100),
    );
  }
  if (Array.isArray(value.uploadedFileMetadata)) {
    output.uploadedFileMetadata = value.uploadedFileMetadata
      .filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)))
      .filter((entry) => typeof entry.name === 'string' && !SECRET_KEY.test(entry.name) && !SECRET_VALUE.test(entry.name))
      .map((entry) => ({
        name: String(entry.name).slice(0, 255),
        size: Math.max(0, Math.min(100_000_000, Number(entry.size) || 0)),
        type: String(entry.type || 'application/octet-stream').slice(0, 160),
      }))
      .slice(0, 20);
  }
  return output;
}
