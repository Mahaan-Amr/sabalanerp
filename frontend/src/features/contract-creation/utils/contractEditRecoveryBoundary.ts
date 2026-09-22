export function contractEditRecoveryBoundaryProps(blocked: boolean) {
  return {
    'aria-disabled': blocked,
    ...(blocked ? { inert: true as const } : {}),
    className: blocked ? 'pointer-events-none select-none opacity-70' : '',
  };
}
