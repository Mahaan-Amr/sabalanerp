/** Ordinary Sales defaults. Explicit saved choices always take precedence. */
export function stairMandatoryDefaults(part: 'tread' | 'riser' | 'landing') {
  return { enabled: part === 'riser' || part === 'landing', percentage: 20 };
}
