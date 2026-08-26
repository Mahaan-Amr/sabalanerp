import PartnerManagementPrototype from "@/features/partner-prototype/PartnerManagementPrototype";

// Three throwaway variants of Partner management and reporting, switchable with
// ?variant=A|B|C on one prototype-only route inside the existing Sales workspace.
export default function PartnerManagementPrototypePage() {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== "1") return null;
  return <PartnerManagementPrototype />;
}
