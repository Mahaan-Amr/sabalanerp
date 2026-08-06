export const formatAttendanceDelay = (delayMinutes?: number | null): string | null => {
  if (!Number.isFinite(delayMinutes) || Number(delayMinutes) <= 0) return null;

  const totalMinutes = Math.floor(Number(delayMinutes));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (!hours) return `${minutes.toLocaleString('fa-IR')} دقیقه`;
  if (!minutes) return `${hours.toLocaleString('fa-IR')} ساعت`;
  return `${hours.toLocaleString('fa-IR')} ساعت و ${minutes.toLocaleString('fa-IR')} دقیقه`;
};
