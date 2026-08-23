type DateTimePart = "date" | "time";

export const resolveDateTimeSelection = (input: {
  initialValue: string;
  draftDate: string;
  draftTime: string;
  changedPart: DateTimePart;
  nextValue: string;
}) => {
  const date = input.changedPart === "date" ? input.nextValue : input.draftDate;
  const committedTime = input.initialValue.match(/(?:^|\s)(\d{2}:\d{2})$/)?.[1] || "";
  const time = input.changedPart === "time" ? input.nextValue : committedTime;
  return {
    date,
    time,
    commitValue: input.changedPart === "date"
      ? date ? (time ? `${date} ${time}` : date) : null
      : date && time ? `${date} ${time}` : null,
  };
};
