'use client';

import React, { useMemo } from 'react';
import { ErpInlineState } from '@/components/erp';
import { ManagementWorkspace } from './ManagementWorkspace';
import { createManagementFixture, type ManagementPersona } from './fixturePorts';

export default function ManagementFixturePreview({ persona }: { persona: ManagementPersona }) {
  const ports = useMemo(() => createManagementFixture(persona), [persona]);
  return <div className="sds-neumorphic-scope min-w-0 space-y-4" dir="rtl">
    <ErpInlineState kind="stale" title="داده آزمایشی؛ هیچ اقدام واقعی ثبت نمی‌شود." />
    <ManagementWorkspace key={persona} {...ports} />
  </div>;
}
