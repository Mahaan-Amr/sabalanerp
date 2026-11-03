'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ErpInput } from '@/components/erp';
import {
  formatNumericInputText,
  parseFormattedNumber
} from '@/lib/numberFormat';

interface FormattedNumberInputProps {
  value: number | string | null | undefined;
  onChange?: (value: number) => void;
  onTextChange?: (value: string) => void;
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
  decimalScale?: number | null;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

const FormattedNumberInput: React.FC<FormattedNumberInputProps> = ({
  value,
  onChange,
  onTextChange,
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
  decimalScale = 4,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy
}) => {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const roundToScale = useCallback((numValue: number): number => {
    if (decimalScale === null) return numValue;
    const factor = 10 ** decimalScale;
    return Math.round(numValue * factor) / factor;
  }, [decimalScale]);

  const formatNumberForScale = useCallback((input: number | string | null | undefined): string => {
    if (input === null || input === undefined || input === '') return '';
    if (decimalScale === null) {
      return formatNumericInputText(String(input)).displayText;
    }
    const num = typeof input === 'string' ? parseFormattedNumber(input) : input;
    if (!Number.isFinite(num)) return '';

    return roundToScale(num).toLocaleString(formatWhileTyping ? 'en-US' : 'fa-IR', {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimalScale
    });
  }, [decimalScale, formatWhileTyping, roundToScale]);

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
      onTextChange?.('');
      onChange?.(min ?? 0);
      onBlur?.();
      return;
    }

    const roundedValue = roundToScale(clamp(parseFormattedNumber(rawValue)));
    setDisplayValue(formatNumberForScale(roundedValue));
    onTextChange?.(
      decimalScale === null
        ? formatNumericInputText(rawValue).canonicalText
        : String(roundedValue)
    );
    onChange?.(roundedValue);
    onBlur?.();
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    const selectionStart = e.target.selectionStart ?? inputValue.length;
    const formatted = formatNumericInputText(
      inputValue,
      selectionStart,
      decimalScale
    );
    const nextDisplayValue = formatWhileTyping
      ? formatted.displayText
      : formatted.canonicalText;
    const numValue = clamp(parseFormattedNumber(formatted.canonicalText));

    setDisplayValue(nextDisplayValue);
    onTextChange?.(formatted.canonicalText);
    onChange?.(numValue);
    requestAnimationFrame(() => {
      const field = inputRef.current;
      if (!field || document.activeElement !== field) return;
      const caretPosition = Math.min(
        formatted.caretPosition,
        nextDisplayValue.length
      );
      field.setSelectionRange(caretPosition, caretPosition);
    });
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
      ref={inputRef}
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
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  );
};

export default FormattedNumberInput;
