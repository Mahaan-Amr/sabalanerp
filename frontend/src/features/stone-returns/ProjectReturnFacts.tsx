import type { ReactNode } from 'react';

export function ProjectReturnFacts({ items, className }: {
  items: { label: string; value: ReactNode }[];
  className: string;
}) {
  return <dl className={`grid min-w-0 gap-x-4 gap-y-2 ${className}`}>
    {items.map(({ label, value }) => <div key={label} className="min-w-0">
      <dt className="text-xs sds-text-secondary">{label}</dt>
      <dd className="break-words text-sm font-semibold sds-text-primary">{value}</dd>
    </div>)}
  </dl>;
}
