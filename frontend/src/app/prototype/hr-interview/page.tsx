import HrInterviewPrototype from "@/features/hr-hiring/prototype/HrInterviewPrototype";

// Public only for local design review; the component uses in-memory mock data.
export default function PublicHrInterviewPrototypePage() {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== "1") return null;
  return <HrInterviewPrototype />;
}
