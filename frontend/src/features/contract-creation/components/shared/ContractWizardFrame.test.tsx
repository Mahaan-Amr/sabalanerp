import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FaCalendarAlt, FaUser } from 'react-icons/fa';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { ContractWizardFrame } from './ContractWizardFrame';

test('contract wizard frame presents the shared workflow hierarchy', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={{
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: async () => undefined,
    }}>
      <ContractWizardFrame
        title="ایجاد فروش همکار"
        currentStep={1}
        steps={[
          { id: 1, title: 'تاریخ قرارداد', titleEn: 'date', icon: FaCalendarAlt, description: 'تاریخ قرارداد' },
          { id: 2, title: 'انتخاب مشتری', titleEn: 'customer', icon: FaUser, description: 'انتخاب مشتری' },
        ]}
        navigation={{
          onPrevious: () => undefined,
          onNext: () => undefined,
          canGoPrevious: false,
        }}
      >
        <p>محتوای مرحله مشترک</p>
      </ContractWizardFrame>
    </AppRouterContext.Provider>,
  );

  assert.match(html, /sds-neumorphic-workflow-scope/);
  assert.match(html, /ایجاد فروش همکار/);
  assert.match(html, /تاریخ قرارداد/);
  assert.match(html, /محتوای مرحله مشترک/);
  assert.match(html, /مرحله ۱ از ۲/);
});
