import { redirect } from "next/navigation";

export default function LegacyHrAuthoritiesRedirect() {
  redirect("/dashboard/hr/permissions");
}
