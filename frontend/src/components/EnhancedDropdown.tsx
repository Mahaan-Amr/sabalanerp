'use client';

import { useState, useRef, useEffect, useMemo } from 'react';
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
  placeholder = 'انتخاب کنید',
  className = '',
  disabled = false,
  searchable = false,
  clearable = false,
  error,
  label,
  required = false,
  maxHeight = 200,
  noOptionsText = 'گزینه‌ای یافت نشد',
  loading = false
}: EnhancedDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [portalPosition, setPortalPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Filter options based on search term
  const filteredOptions = useMemo(() => {
    if (!searchable || !searchTerm.trim()) {
      return options;
    }
    
    return options.filter(option =>
      option.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
      option.value.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [options, searchTerm, searchable]);

  // Group options if they have group property
  const groupedOptions = useMemo(() => {
    const groups: { [key: string]: DropdownOption[] } = {};
    const ungrouped: DropdownOption[] = [];
    
    filteredOptions.forEach(option => {
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

  // Get selected option label
  const selectedOption = options.find(option => option.value === value);
  const displayValue = selectedOption ? selectedOption.label : '';

  // Update portal position
  const updatePortalPosition = () => {
    if (dropdownRef.current) {
      const rect = dropdownRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const dropdownHeight = Math.min(maxHeight + 100, 300); // Approximate dropdown height
      const dropdownWidth = rect.width;
      
      // Calculate position
      let top = rect.bottom + 8;
      let left = rect.left;
      
      // Check if dropdown would go below viewport
      if (top + dropdownHeight > viewportHeight) {
        // Position above the input
        top = rect.top - dropdownHeight - 8;
      }
      
      // Check if dropdown would go beyond right edge
      if (left + dropdownWidth > viewportWidth) {
        left = viewportWidth - dropdownWidth - 16; // 16px margin
      }
      
      // Ensure dropdown doesn't go beyond left edge
      if (left < 16) {
        left = 16;
      }
      
      // Calculate available height
      const availableHeight = Math.min(viewportHeight - top - 16, maxHeight);
      
      setPortalPosition({
        top,
        left,
        width: dropdownWidth,
        maxHeight: availableHeight
      });
    }
  };

  // Handle click outside
  useEffect(() => {
    if (isOpen) {
      updatePortalPosition();
      
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        if (dropdownRef.current && 
            !dropdownRef.current.contains(target) && 
            !document.querySelector('.enhanced-dropdown-portal')?.contains(target)) {
          setIsOpen(false);
          setSearchTerm('');
          setHighlightedIndex(-1);
        }
      };
      
      const handleResize = () => updatePortalPosition();
      const handleScroll = () => updatePortalPosition();
      
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('resize', handleResize);
      window.addEventListener('scroll', handleScroll);
      
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleScroll);
      };
    }
  }, [isOpen, maxHeight]);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isOpen && searchable && searchRef.current) {
      setTimeout(() => {
        searchRef.current?.focus();
      }, 100);
    }
  }, [isOpen, searchable]);

  // Handle keyboard navigation
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
        setHighlightedIndex(prev => 
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(prev => 
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
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
    }
  };

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

  const renderOptions = () => {
    if (loading) {
      return (
        <div className="p-4 text-center text-gray-400">
          <div className="animate-spin w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full mx-auto mb-2"></div>
          در حال بارگذاری...
        </div>
      );
    }

    if (filteredOptions.length === 0) {
      return (
        <div className="p-4 text-center text-gray-400">
          {noOptionsText}
        </div>
      );
    }

    return (
      <div className="max-h-full overflow-y-auto">
        {/* Ungrouped options */}
        {groupedOptions.ungrouped.map((option, index) => (
          <div
            key={option.value}
            ref={el => { optionRefs.current[index] = el; }}
            onClick={() => !option.disabled && handleOptionSelect(option.value)}
            className={`px-4 py-3 cursor-pointer transition-colors flex items-center justify-between ${
              option.disabled
                ? 'text-gray-500 cursor-not-allowed'
                : highlightedIndex === index
                ? 'bg-teal-500/20 text-teal-400'
                : 'hover:bg-white/10 text-white'
            }`}
          >
            <span>{option.label}</span>
            {value === option.value && (
              <FaCheck className="text-teal-500 text-sm" />
            )}
          </div>
        ))}

        {/* Grouped options */}
        {Object.entries(groupedOptions.groups).map(([groupName, groupOptions]) => (
          <div key={groupName}>
            <div className="px-4 py-2 text-xs text-gray-400 bg-white/5 border-b border-white/10">
              {groupName}
            </div>
            {groupOptions.map((option, index) => {
              const globalIndex = groupedOptions.ungrouped.length + 
                Object.entries(groupedOptions.groups).slice(0, Object.keys(groupedOptions.groups).indexOf(groupName)).reduce((acc, [, opts]) => acc + opts.length, 0) + index;
              
              return (
                <div
                  key={option.value}
                  ref={el => { optionRefs.current[globalIndex] = el; }}
                  onClick={() => !option.disabled && handleOptionSelect(option.value)}
                  className={`px-4 py-3 cursor-pointer transition-colors flex items-center justify-between ${
                    option.disabled
                      ? 'text-gray-500 cursor-not-allowed'
                      : highlightedIndex === globalIndex
                      ? 'bg-teal-500/20 text-teal-400'
                      : 'hover:bg-white/10 text-white'
                  }`}
                >
                  <span>{option.label}</span>
                  {value === option.value && (
                    <FaCheck className="text-teal-500 text-sm" />
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    );
  };

  // Scroll highlighted option into view
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
      {/* Label */}
      {label && (
        <label className="block text-sm font-medium text-gray-300 mb-2">
          {label}
          {required && <span className="text-red-400 mr-1">*</span>}
        </label>
      )}

      {/* Dropdown Trigger */}
      <div
        ref={dropdownRef}
        className={`glass-liquid-input flex items-center justify-between cursor-pointer transition-all duration-200 ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'hover:border-teal-400/50'
        } ${error ? 'border-red-500' : ''} ${isOpen ? 'border-teal-500 ring-2 ring-teal-500/20' : ''}`}
        onClick={() => !disabled && setIsOpen(!isOpen)}
        onKeyDown={handleKeyDown}
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={label || placeholder}
      >
        <div className="flex items-center space-x-2 space-x-reverse flex-1 min-w-0">
          <span className={`truncate ${displayValue ? 'text-white' : 'text-gray-400'}`}>
            {displayValue || placeholder}
          </span>
        </div>
        
        <div className="flex items-center space-x-2 space-x-reverse">
          {clearable && value && (
            <button
              onClick={handleClear}
              className="text-gray-400 hover:text-red-400 transition-colors p-1"
              type="button"
            >
              ×
            </button>
          )}
          <FaChevronDown 
            className={`text-gray-400 transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`} 
          />
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <p className="text-red-400 text-sm mt-1">{error}</p>
      )}

      {/* Dropdown Portal */}
      {isOpen && typeof window !== 'undefined' && createPortal(
        <div 
          className="enhanced-dropdown-portal fixed glass-liquid-card shadow-2xl border border-white/20 z-[99999] overflow-hidden" 
          style={{ 
            top: `${portalPosition.top}px`,
            left: `${portalPosition.left}px`,
            width: `${portalPosition.width}px`,
            maxHeight: `${portalPosition.maxHeight}px`,
            transform: 'none'
          }}
        >
          {/* Search Input */}
          {searchable && (
            <div className="p-3 border-b border-white/10">
              <div className="relative">
                <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-sm" />
                <input
                  ref={searchRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="جستجو..."
                  className="w-full pr-10 pl-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
                />
              </div>
            </div>
          )}

          {/* Options */}
          <div className="max-h-full overflow-hidden">
            {renderOptions()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
