import assert from 'node:assert/strict';
import React from 'react';
import { YAxis } from 'recharts';
import { chartTickInterval, resolveChartLabel, RtlTrendChart } from '../RtlCharts';

const findElement = (node: React.ReactNode, type: React.ElementType): React.ReactElement | null => {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node;
  for (const child of React.Children.toArray((node.props as { children?: React.ReactNode }).children)) {
    const match = findElement(child, type);
    if (match) return match;
  }
  return null;
};

assert.equal(resolveChartLabel({ label: 'امضاشده' }), 'امضاشده');
assert.equal(resolveChartLabel({ statusLabel: 'تأییدشده' }), 'تأییدشده');
assert.equal(resolveChartLabel({ status: 'APPROVED' }), 'APPROVED');
assert.equal(resolveChartLabel({}), 'نامشخص');

assert.equal(chartTickInterval(7), 0);
assert.equal(chartTickInterval(31), 3);
assert.ok(Math.ceil(31 / (chartTickInterval(31) + 1)) <= 8);

const defaultChart = RtlTrendChart({ data: [] }) as React.ReactElement;
const leftAxisChart = RtlTrendChart({ data: [], valueAxisSide: 'left' }) as React.ReactElement;
const defaultAxis = findElement(defaultChart, YAxis);
const leftAxis = findElement(leftAxisChart, YAxis);
assert.ok(defaultAxis);
assert.ok(leftAxis);
assert.equal((defaultAxis.props as { orientation?: string }).orientation, 'right');
assert.equal((leftAxis.props as { orientation?: string }).orientation, 'left');

console.log('RTL chart regression tests passed');
