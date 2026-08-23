type DateTimePart = "date" | "time";

export const resolveDateTimeSelection = (input: {
  initialValue: string;
  draftDate: string;
  draftTime: string;
  changedPart: DateTimePart;
  nextValue: string;
}) => {
  const date = input.changedPart === "date" ? input.nextValue : input.draftDate;
  const time = input.changedPart === "time" ? input.nextValue : input.draftTime;
  return {
    date,
    time,
    commitValue: date && time ? `${date} ${time}` : null,
  };
};
