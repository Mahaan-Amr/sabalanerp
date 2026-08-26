import PartnerManagementPrototype from "@/features/partner-prototype/PartnerManagementPrototype";

// Authentication-free mirror for reviewing the same throwaway prototype when
// the local backend is unavailable. Production builds keep it disabled.
export default function PartnerManagementStandalonePrototypePage() {
  if (process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== "1") return null;
  return <PartnerManagementPrototype standalone />;
}
