'use client';

import { useState, useRef, useEffect, useMemo, useId } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronDown, FaSearch, FaCheck } from 'react-icons/fa';

export interface DropdownOption {
  value: string;
  label: string;
  disabled?: boolean;
  group?: string;
}

interface EnhancedDropdownProps {
  options: DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  error?: string;
  label?: string;
  required?: boolean;
  maxHeight?: number;
  noOptionsText?: string;
  loading?: boolean;
}

export default function EnhancedDropdown({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  className = '',
  disabled = false,
  searchable = false,
  clearable = false,
  error,
  label,
  required = false,
  maxHeight = 260,
  noOptionsText = 'No options found',
  loading = false
}: EnhancedDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const listboxId = useId();
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [portalPosition, setPortalPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
    maxHeight: 0,
    optionsMaxHeight: 0
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const portalRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm.trim()) {
      return options;
    }

    const q = searchTerm.toLowerCase();
    return options.filter(
      (option) => option.label.toLowerCase().includes(q) || option.value.toLowerCase().includes(q)
    );
  }, [options, searchTerm, searchable]);

  const groupedOptions = useMemo(() => {
    const groups: Record<string, DropdownOption[]> = {};
    const ungrouped: DropdownOption[] = [];

    filteredOptions.forEach((option) => {
      if (option.group) {
        if (!groups[option.group]) {
          groups[option.group] = [];
        }
        groups[option.group].push(option);
      } else {
        ungrouped.push(option);
      }
    });

    return { groups, ungrouped };
  }, [filteredOptions]);

  const selectedOption = options.find((option) => option.value === value);
  const displayValue = selectedOption ? selectedOption.label : '';

  const updatePortalPosition = () => {
    if (!dropdownRef.current) {
      return;
    }

    const rect = dropdownRef.current.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const dropdownWidth = rect.width;
    const searchHeight = searchable ? 68 : 0;
    const minOptionsHeight = 120;
    const requiredHeight = Math.min(maxHeight, searchHeight + minOptionsHeight);

    const spaceBelow = viewportHeight - rect.bottom - 16;
    const spaceAbove = rect.top - 16;
    const openAbove = spaceBelow < requiredHeight && spaceAbove > spaceBelow;

    let top = openAbove ? rect.top - Math.min(maxHeight, spaceAbove) - 8 : rect.bottom + 8;
    let left = rect.left;

    const availableHeight = Math.max(
      searchHeight + minOptionsHeight,
      Math.min(maxHeight, openAbove ? spaceAbove : spaceBelow)
    );
    const optionsMaxHeight = Math.max(96, availableHeight - searchHeight);

    if (top < 8) {
      top = 8;
    }

    if (left + dropdownWidth > viewportWidth) {
      left = viewportWidth - dropdownWidth - 16;
    }

    if (left < 16) {
      left = 16;
    }

    setPortalPosition({
      top,
      left,
      width: dropdownWidth,
      maxHeight: availableHeight,
      optionsMaxHeight
    });
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    updatePortalPosition();

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(target) &&
        portalRef.current &&
        !portalRef.current.contains(target)
      ) {
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
      }
    };

    const handleResize = () => updatePortalPosition();
    const handleScroll = () => updatePortalPosition();

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleResize);
    window.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen, maxHeight, searchable]);

  useEffect(() => {
    if (isOpen && searchable && searchRef.current) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [isOpen, searchable]);

  const handleOptionSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchTerm('');
    setHighlightedIndex(-1);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setSearchTerm('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          handleOptionSelect(filteredOptions[highlightedIndex].value);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setIsOpen(false);
        setSearchTerm('');
        setHighlightedIndex(-1);
        break;
      default:
        break;
    }
  };

  const renderOptions = () => {
    if (loading) {
      return (
        <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">
          <div className="animate-spin w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full mx-auto mb-2" />
          Loading...
        </div>
      );
    }

    if (filteredOptions.length === 0) {
      return <div className="p-4 text-center text-sm text-slate-500 dark:text-slate-400">{noOptionsText}</div>;
    }

    return (
      <div>
        {groupedOptions.ungrouped.map((option, index) => (
          <div
            key={option.value}
            ref={(el) => {
              optionRefs.current[index] = el;
            }}
            onClick={() => !option.disabled && handleOptionSelect(option.value)}
            role="option"
            aria-selected={value === option.value}
            className={`flex min-h-10 cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              option.disabled
                ? 'cursor-not-allowed text-slate-400 opacity-60 dark:text-slate-500'
                : highlightedIndex === index
                ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200'
                : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>{option.label}</span>
            {value === option.value && <FaCheck className="text-teal-500 text-sm" />}
          </div>
        ))}

        {Object.entries(groupedOptions.groups).map(([groupName, groupOptions]) => (
          <div key={groupName}>
            <div className="px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{groupName}</div>
            {groupOptions.map((option, index) => {
              const globalIndex =
                groupedOptions.ungrouped.length +
                Object.entries(groupedOptions.groups)
                  .slice(0, Object.keys(groupedOptions.groups).indexOf(groupName))
                  .reduce((acc, [, opts]) => acc + opts.length, 0) +
                index;

              return (
                <div
                  key={option.value}
                  ref={(el) => {
                    optionRefs.current[globalIndex] = el;
                  }}
                  onClick={() => !option.disabled && handleOptionSelect(option.value)}
                  role="option"
                  aria-selected={value === option.value}
                  className={`flex min-h-10 cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                    option.disabled
                      ? 'cursor-not-allowed text-slate-400 opacity-60 dark:text-slate-500'
                      : highlightedIndex === globalIndex
                      ? 'bg-teal-50 text-teal-800 dark:bg-teal-950/60 dark:text-teal-200'
                      : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{option.label}</span>
                  {value === option.value && <FaCheck className="text-teal-500 text-sm" />}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  useEffect(() => {
    if (highlightedIndex >= 0 && optionRefs.current[highlightedIndex]) {
      optionRefs.current[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [highlightedIndex]);

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="mb-1 block text-xs font-semibold text-slate-600 dark:text-slate-300">
          {label}
          {required && <span className="text-red-400 mr-1">*</span>}
        </label>
      )}

      <div
        ref={dropdownRef}
        className={`flex min-h-10 cursor-pointer items-center justify-between rounded-lg border bg-white px-3 text-sm outline-none transition dark:bg-slate-950 ${
          disabled
            ? 'cursor-not-allowed border-slate-200 opacity-55 dark:border-slate-800'
            : 'border-slate-300 hover:border-teal-500 dark:border-slate-700'
        } ${error ? 'border-red-500 dark:border-red-500' : ''} ${
          isOpen ? 'border-teal-500 ring-2 ring-teal-500/15' : ''
        }`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-controls={listboxId}
        aria-haspopup="listbox"
        aria-label={label || placeholder}
      >
        <div className="flex items-center space-x-2 space-x-reverse flex-1 min-w-0">
          <span className={`truncate ${displayValue ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500'}`}>
            {displayValue || placeholder}
          </span>
        </div>

        <div className="flex items-center space-x-2 space-x-reverse">
          {clearable && value && (
            <button
              onClick={handleClear}
              className="p-1 text-slate-400 transition-colors hover:text-red-500"
              type="button"
            >
              ×
            </button>
          )}
          <FaChevronDown className={`text-xs text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </div>
      </div>

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}

      {isOpen &&
        typeof window !== 'undefined' &&
        createPortal(
          <div
            ref={portalRef}
            id={listboxId}
            role="listbox"
            className="enhanced-dropdown-portal fixed z-[99999] overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-2xl dark:border-slate-700 dark:bg-slate-950"
            style={{
              top: `${portalPosition.top}px`,
              left: `${portalPosition.left}px`,
              width: `${portalPosition.width}px`,
              maxHeight: `${portalPosition.maxHeight}px`,
              transform: 'none'
            }}
          >
            {searchable && (
              <div className="border-b border-slate-200 p-2 dark:border-slate-800">
                <div className="relative">
                  <FaSearch className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-400" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search..."
                    className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-10 text-sm text-slate-900 outline-none placeholder:text-slate-400 focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>
            )}

            <div
              className="space-y-0.5 overflow-y-auto overscroll-contain"
              style={{ maxHeight: `${portalPosition.optionsMaxHeight}px` }}
              onWheelCapture={(e) => e.stopPropagation()}
            >
              {renderOptions()}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
