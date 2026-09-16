import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ContractCustomerStepView,
  ContractDateStepView,
  ContractProjectStepView,
} from './ContractWizardStepViews';

test('shared contract step views expose the same date, customer, and project vocabulary', () => {
  const dateHtml = renderToStaticMarkup(<ContractDateStepView
    creatorName="فروشنده همکار"
    dateControl={<input value="1405/06/24" readOnly />}
    numberNotice="شماره پس از ثبت نهایی تخصیص داده می‌شود."
  />);
  assert.match(dateHtml, /کاربر ایجادکننده/);
  assert.match(dateHtml, /تاریخ قرارداد/);
  assert.match(dateHtml, /شماره پس از ثبت نهایی تخصیص داده می‌شود/);
  assert.match(dateHtml, /<label for="([^"]+)"[\s\S]*<input[^>]+id="\1"/);

  const customerHtml = renderToStaticMarkup(<ContractCustomerStepView
    customers={[{ id: 'customer-1', title: 'مشتری نمونه', phone: '09120000000', type: 'حقیقی', status: 'فعال' }]}
    selectedCustomerId="customer-1"
    searchTerm=""
    totalCount={1}
    onSearchChange={() => undefined}
    onSelect={() => undefined}
    onCreate={() => undefined}
  />);
  assert.match(customerHtml, /مشتری انتخاب شده/);
  assert.match(customerHtml, /جستجو با نام/);
  assert.match(customerHtml, /aria-pressed="true"/);

  const projectHtml = renderToStaticMarkup(<ContractProjectStepView
    customerName="مشتری نمونه"
    projects={[{ id: 'project-1', title: 'پروژه نمونه', address: 'تهران' }]}
    selectedProjectId="project-1"
    onSelect={() => undefined}
    onCreate={() => undefined}
  />);
  assert.match(projectHtml, /پروژه انتخاب شده/);
  assert.match(projectHtml, /پروژه‌های مشتری نمونه/);
  assert.match(projectHtml, /aria-pressed="true"/);
});
