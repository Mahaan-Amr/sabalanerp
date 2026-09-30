export function persianCalendarLayout(rect: { width: number; top: number; bottom: number; left: number }, viewport: { width: number; height: number }, desiredHeight: number) {
  const width = Math.max(1, Math.min(Math.max(rect.width, 344), viewport.width - 32));
  const maxHeight = Math.max(1, Math.min(desiredHeight, viewport.height - 32));
  const preferredTop = rect.bottom + maxHeight + 24 <= viewport.height ? rect.bottom + 8 : rect.top - maxHeight - 8;
  return { width, maxHeight, top: Math.max(16, Math.min(preferredTop, viewport.height - maxHeight - 16)), left: Math.max(16, Math.min(rect.left, viewport.width - width - 16)) };
}
