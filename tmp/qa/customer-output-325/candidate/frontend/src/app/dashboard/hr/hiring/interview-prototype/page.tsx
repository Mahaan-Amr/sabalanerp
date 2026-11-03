import HrInterviewPrototype from "@/features/hr-hiring/prototype/HrInterviewPrototype";

// Three throwaway variants of the initial HR interview and Company Manager checklist,
// switchable with ?variant=A|B|C on this prototype-only route.
export default function HrInterviewPrototypePage() {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== "1") return null;
  return <HrInterviewPrototype />;
}
