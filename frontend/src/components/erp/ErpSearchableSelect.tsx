'use client';

import React from 'react';
import EnhancedDropdown, { type DropdownOption } from '@/components/EnhancedDropdown';

const text = (node: React.ReactNode): string => React.Children.toArray(node).map((child) =>
  React.isValidElement<{ children?: React.ReactNode }>(child) ? text(child.props.children) : String(child),
).join('');

export const selectOptions = (children: React.ReactNode, group?: string): DropdownOption[] => React.Children.toArray(children).flatMap((child) => {
  if (!React.isValidElement<{ value?: string | number; children?: React.ReactNode; label?: string; disabled?: boolean }>(child)) return [];
  if (child.type === 'option') return [{ value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children), disabled: child.props.disabled, group }];
  return selectOptions(child.props.children, child.type === 'optgroup' ? child.props.label : group);
});

export default function ErpSearchableSelect({ children, value, defaultValue, onChange, id, disabled, required, className, ...props }: {
  children: React.ReactNode;
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
  onChange?: (selection: { target: { value: string }; currentTarget: { value: string } }) => void;
  id?: string; disabled?: boolean; required?: boolean; className?: string;
  'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false'; 'aria-label'?: string;
}) {
  const [localValue, setLocalValue] = React.useState(String(defaultValue ?? ''));
  const options = selectOptions(children);
  return <EnhancedDropdown id={id} options={options} value={value === undefined ? localValue : String(value)}
    onChange={(next) => { setLocalValue(next); onChange?.({ target: { value: next }, currentTarget: { value: next } }); }}
    placeholder={props['aria-label'] || options.find((option) => option.value === '')?.label || 'انتخاب گزینه'}
    aria-describedby={props['aria-describedby']} aria-invalid={props['aria-invalid']}
    disabled={disabled} required={required} className={className} searchable noOptionsText="نتیجه‌ای پیدا نشد" />;
}
