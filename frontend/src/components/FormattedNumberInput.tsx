'use client';

import React, { useState, useEffect } from 'react';
import { formatInputNumber, parseFormattedNumber } from '@/lib/numberFormat';

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
  onFocus
}) => {
  const [displayValue, setDisplayValue] = useState<string>('');
  const [isFocused, setIsFocused] = useState(false);

  // Update display value when prop value changes
  useEffect(() => {
    if (!isFocused) {
      setDisplayValue(formatInputNumber(value));
    }
  }, [value, isFocused]);

  const handleFocus = () => {
    setIsFocused(true);
    // Show raw number when focused for easier editing
    setDisplayValue(value?.toString() || '');
    // Call onFocus callback if provided
    if (onFocus) {
      onFocus();
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const rawValue = displayValue.trim();

    // User intentionally cleared the field
    if (!rawValue) {
      setDisplayValue('');
      onChange(min ?? 0);
      return;
    }

    // Format the number when not focused and round to 2 decimal places
    const numValue = parseFormattedNumber(rawValue);
    let roundedValue = Math.round(numValue * 100) / 100;

    // Re-apply min/max constraints on blur for consistency
    if (min !== undefined && roundedValue < min) {
      roundedValue = min;
    }
    if (max !== undefined && roundedValue > max) {
      roundedValue = max;
    }

    setDisplayValue(formatInputNumber(roundedValue));
    onChange(roundedValue);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    
    // Check for more than 2 decimal places
    const decimalIndex = inputValue.indexOf('.');
    if (decimalIndex !== -1 && inputValue.length - decimalIndex - 1 > 2) {
      // Truncate to 2 decimal places
      const truncatedValue = inputValue.substring(0, decimalIndex + 3);
      setDisplayValue(truncatedValue);
      
      // Parse and validate the truncated number
      const numValue = parseFormattedNumber(truncatedValue);
      
      // Apply min/max constraints
      let constrainedValue = numValue;
      if (min !== undefined && numValue < min) {
        constrainedValue = min;
      }
      if (max !== undefined && numValue > max) {
        constrainedValue = max;
      }
      
      // Update the parent component with the numeric value
      onChange(constrainedValue);
      return;
    }
    
    setDisplayValue(inputValue);
    
    // Parse and validate the number
    const numValue = parseFormattedNumber(inputValue);
    
    // Apply min/max constraints
    let constrainedValue = numValue;
    if (min !== undefined && numValue < min) {
      constrainedValue = min;
    }
    if (max !== undefined && numValue > max) {
      constrainedValue = max;
    }
    
    // Update the parent component with the numeric value
    onChange(constrainedValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Allow navigation/editing keys and common shortcuts
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

    // Allow ASCII/Persian/Arabic-Indic digits and decimal separators
    if (/^[0-9۰-۹٠-٩.,٬،٫-]$/.test(e.key)) {
      return;
    }

    // Block everything else
    if (e.shiftKey || e.key.length === 1) {
      e.preventDefault();
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
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
