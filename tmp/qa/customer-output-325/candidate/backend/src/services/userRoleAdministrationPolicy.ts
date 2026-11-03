export type SystemRole = 'USER' | 'MODERATOR' | 'SALES' | 'MANAGER' | 'ADMIN';

export const canAssignSystemRole = (input: {
  actorRole: string;
  targetRole: string;
  requestedRole: string;
}) => {
  if (input.actorRole === 'ADMIN') return true;
  if (input.actorRole !== 'MANAGER') return false;
  return input.targetRole !== 'ADMIN' && input.requestedRole !== 'ADMIN';
};
