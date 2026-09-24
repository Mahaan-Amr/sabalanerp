const offsetMinutes = (instant: Date) => {
  const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', timeZoneName: 'shortOffset' })
    .formatToParts(instant).find((part) => part.type === 'timeZoneName')?.value;
  const match = zone?.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  if (!match) throw new Error(`Cannot resolve Asia/Tehran offset at ${instant.toISOString()}`);
  return (match[1] === '+' ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3] ?? 0));
};

/** SQL Server datetime values in the Sepidar export are local wall time, without an offset. */
export const parseSepidarLocalDateTime = (value: string) => {
  const match = value.match(/^(\d{4}-\d\d-\d\d)T(\d\d:\d\d:\d\d)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid Sepidar local datetime: ${value}`);
  const milliseconds = (match[3] ?? '').padEnd(3, '0').slice(0, 3);
  const nominal = Date.parse(`${match[1]}T${match[2]}.${milliseconds}Z`);
  if (Number.isNaN(nominal)) throw new Error(`Invalid Sepidar local datetime: ${value}`);
  let instant = new Date(nominal);
  for (let attempt = 0; attempt < 2; attempt++) instant = new Date(nominal - offsetMinutes(instant) * 60_000);
  return instant;
};

export const sepidarLocalDayStart = (day: string) => parseSepidarLocalDateTime(`${day}T00:00:00`);
