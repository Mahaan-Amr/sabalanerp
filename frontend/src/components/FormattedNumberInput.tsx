'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { formatInputNumber, formatInputNumberLatin, normalizeDigits, parseFormattedNumber } from '@/lib/numberFormat';

interface FormattedNumberInputProps {
  value: number | string | null | undefined;
  onChange: (value: number) => void;
  placeholder?: string;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  id?: string;
  name?: string;
  onFocus?: () => void;
  formatWhileTyping?: boolean;
}

const FormattedNumberInput: React.FC<FormattedNumberInputProps> = ({
  value,
  onChange,
  placeholder,
  className = '',
  min,
  max,
  step = 1,
  disabled = false,
  id,
  name,
  onFocus,
  formatWhileTyping = true
}) => {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);

  const formatForInput = useCallback(
    (input: number | string | null | undefined) =>
      formatWhileTyping ? formatInputNumberLatin(input) : formatInputNumber(input),
    [formatWhileTyping]
  );

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatForInput(value));
    }
  }, [value, isFocused, formatForInput]);

  const clamp = (numValue: number): number => {
    let constrainedValue = numValue;
    if (min !== undefined && numValue < min) constrainedValue = min;
    if (max !== undefined && numValue > max) constrainedValue = max;
    return constrainedValue;
  };

  const handleFocus = () => {
    setIsFocused(true);
    setDisplayValue(formatWhileTyping ? formatInputNumberLatin(value) : (value?.toString() || ''));
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    const rawValue = displayValue.trim();

    if (!rawValue) {
      setDisplayValue('');
      onChange(min ?? 0);
      return;
    }

    const roundedValue = Math.round(clamp(parseFormattedNumber(rawValue)) * 100) / 100;
    setDisplayValue(formatForInput(roundedValue));
    onChange(roundedValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = normalizeDigits(e.target.value);
    const decimalIndex = inputValue.indexOf('.');
    const normalizedValue =
      decimalIndex !== -1 && inputValue.length - decimalIndex - 1 > 2
        ? inputValue.substring(0, decimalIndex + 3)
        : inputValue;
    const numValue = clamp(parseFormattedNumber(normalizedValue));

    setDisplayValue(formatWhileTyping ? formatInputNumberLatin(normalizedValue) : normalizedValue);
    onChange(numValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const allowedKeys = [
      'Backspace',
      'Delete',
      'Tab',
      'Escape',
      'Enter',
      'Home',
      'End',
      'ArrowLeft',
      'ArrowRight',
      'ArrowUp',
      'ArrowDown'
    ];

    if (
      allowedKeys.includes(e.key) ||
      ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase()))
    ) {
      return;
    }

    if (/^[0-9\u06F0-\u06F9\u0660-\u0669.,\u066B\u066C،-]$/.test(e.key)) {
      return;
    }

    if (e.shiftKey || e.key.length === 1) {
      e.preventDefault();
    }
  };

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      className={className}
      disabled={disabled}
      id={id}
      name={name}
      min={min}
      max={max}
      step={step}
    />
  );
};

export default FormattedNumberInput;
