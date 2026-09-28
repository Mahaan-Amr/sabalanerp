export const parseOfficialReportDate = (value: unknown, label: string, boundary: 'start' | 'end' | 'cutoff') => {
  const text = String(value ?? '');
  const day = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  if (day) {
    const checked = new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00.000Z`);
    if (Number.isNaN(checked.getTime()) || checked.toISOString().slice(0, 10) !== `${day[1]}-${day[2]}-${day[3]}`) throw new Error(`${label} معتبر نیست.`);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? `${text}T${boundary === 'end' ? '23:59:59.999' : '00:00:00.000'}Z`
    : boundary === 'cutoff' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text)
      ? `${text}:00+03:30` : text;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} معتبر نیست.`);
  return parsed;
};
