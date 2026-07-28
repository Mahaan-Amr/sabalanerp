'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ErpInput } from '@/components/erp';
import { normalizeDigits, parseFormattedNumber } from '@/lib/numberFormat';

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
  onBlur?: () => void;
  formatWhileTyping?: boolean;
  decimalScale?: number;
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
  onBlur,
  formatWhileTyping = true,
  decimalScale = 4
}) => {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);

  const roundToScale = useCallback((numValue: number): number => {
    const factor = 10 ** decimalScale;
    return Math.round(numValue * factor) / factor;
  }, [decimalScale]);

  const formatNumberForScale = useCallback((input: number | string | null | undefined): string => {
    if (input === null || input === undefined || input === '') return '';
    const num = typeof input === 'string' ? parseFormattedNumber(input) : input;
    if (!Number.isFinite(num)) return '';

    return roundToScale(num).toLocaleString(formatWhileTyping ? 'en-US' : 'fa-IR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimalScale
    });
  }, [decimalScale, formatWhileTyping, roundToScale]);

  const formatTypingValue = useCallback((input: string): string => {
    if (!formatWhileTyping) return input;

    const isNegative = input.startsWith('-');
    const signlessInput = isNegative ? input.slice(1) : input;
    const hasDecimal = signlessInput.includes('.');
    const [rawIntegerPart, decimalPart = ''] = signlessInput.split('.');
    const integerPart = rawIntegerPart.replace(/[^\d]/g, '');
    const formattedInteger = integerPart
      ? Number(integerPart).toLocaleString('en-US', { maximumFractionDigits: 0 })
      : '';

    return `${isNegative ? '-' : ''}${formattedInteger}${hasDecimal ? `.${decimalPart}` : ''}`;
  }, [formatWhileTyping]);

  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatNumberForScale(value));
    }
  }, [value, isFocused, formatNumberForScale]);

  const clamp = (numValue: number): number => {
    let constrainedValue = numValue;
    if (min !== undefined && numValue < min) constrainedValue = min;
    if (max !== undefined && numValue > max) constrainedValue = max;
    return constrainedValue;
  };

  const handleFocus = () => {
    setIsFocused(true);
    setDisplayValue(formatNumberForScale(value));
    onFocus?.();
  };

  const handleBlur = () => {
    setIsFocused(false);
    const rawValue = displayValue.trim();

    if (!rawValue) {
      setDisplayValue('');
      onChange(min ?? 0);
      onBlur?.();
      return;
    }

    const roundedValue = roundToScale(clamp(parseFormattedNumber(rawValue)));
    setDisplayValue(formatNumberForScale(roundedValue));
    onChange(roundedValue);
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = normalizeDigits(e.target.value);
    const decimalIndex = inputValue.indexOf('.');
    const normalizedValue =
      decimalIndex !== -1 && inputValue.length - decimalIndex - 1 > decimalScale
        ? inputValue.substring(0, decimalIndex + decimalScale + 1)
        : inputValue;
    const numValue = clamp(parseFormattedNumber(normalizedValue));

    setDisplayValue(formatTypingValue(normalizedValue));
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
    <ErpInput
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
