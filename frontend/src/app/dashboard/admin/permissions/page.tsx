import { redirect } from 'next/navigation';

export default function LegacyPermissionsRedirect({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams || {})) {
    if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
    else if (value) query.set(key, value);
  }
  redirect(`/dashboard/hr/permissions${query.size ? `?${query.toString()}` : ''}`);
}
