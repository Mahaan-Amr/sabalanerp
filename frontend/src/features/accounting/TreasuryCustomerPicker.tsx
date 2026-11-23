"use client";

import { useEffect, useState } from "react";
import { ErpField, ErpInlineState, ErpSearchableSelect } from "@/components/erp";
import { readTreasuryCustomerOptions, useTreasuryRead, type TreasuryCustomerOption } from "./treasuryReads";

export function TreasuryCustomerPicker({ selected, onChange, onDenied }: {
  selected?: TreasuryCustomerOption;
  onChange: (next?: TreasuryCustomerOption) => void;
  onDenied: () => void;
}) {
  const [search, setSearch] = useState("");
  const lookup = useTreasuryRead(search.trim(), readTreasuryCustomerOptions, "جست‌وجوی مشتری انجام نشد.", 200);
  const matches = lookup.data ?? [];
  const rows = selected && !matches.some(row => row.id === selected.id) ? [selected, ...matches] : matches;
  useEffect(() => { if (lookup.denied) onDenied(); }, [lookup.denied, onDenied]);

  return (
    <div className="min-w-0 space-y-2">
      <ErpField label="مشتری" required>
        <ErpSearchableSelect aria-label="مشتری" value={lookup.denied ? "" : selected?.id ?? ""} onSearchChange={setSearch}
          loading={lookup.pending} onChange={event => onChange(rows.find(row => row.id === event.target.value))}>
          <option value="">انتخاب مشتری</option>
          {!lookup.denied && rows.map(row => <option key={row.id} value={row.id}>{row.displayName}</option>)}
        </ErpSearchableSelect>
      </ErpField>
      {lookup.error && <ErpInlineState kind="error" title={lookup.error}
        action={{ label: "تلاش دوباره برای جست‌وجو", onClick: lookup.retry }} />}
    </div>
  );
}
