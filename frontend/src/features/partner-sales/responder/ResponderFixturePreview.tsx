'use client';

import React, { useMemo } from 'react';
import { ErpInlineState } from '@/components/erp';
import { ResponderWorkspace } from './ResponderWorkspace';
import { createResponderFixture, type ResponderScenario } from './fixturePorts';

export default function ResponderFixturePreview({ scenario }: { scenario: ResponderScenario }) {
  const ports = useMemo(() => createResponderFixture(scenario), [scenario]);
  return <div className="sds-neumorphic-scope min-w-0 space-y-4" dir="rtl">
    <ErpInlineState kind="stale" title="داده آزمایشی؛ هیچ اقدام واقعی ثبت نمی‌شود." />
    <ResponderWorkspace key={scenario} {...ports} />
  </div>;
}
