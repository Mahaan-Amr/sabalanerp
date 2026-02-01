'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronLeft, FaChevronRight, FaCalendarAlt } from 'react-icons/fa';
import PersianCalendar from '@/lib/persian-calendar';
import moment from 'moment-jalaali';

interface PersianCalendarProps {
  value?: string;
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  showTime?: boolean;
  enableYearSelection?: boolean; // New prop for year selection
  minYear?: number; // Minimum year for birth dates
  maxYear?: number; // Maximum year for birth dates
}

export default function PersianCalendarComponent({
  value,
  onChange,
  placeholder = 'تاریخ را انتخاب کنید',
  className = '',
  disabled = false,
  showTime = false,
  enableYearSelection = false,
  minYear = 1300, // Default minimum year (1921 CE)
  maxYear = 1410  // Default maximum year (2031 CE)
}: PersianCalendarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [currentMonth, setCurrentMonth] = useState(PersianCalendar.now('jYYYY/jMM'));
  const [selectedDate, setSelectedDate] = useState(value || PersianCalendar.now('jYYYY/jMM/jDD'));
  const [selectedTime, setSelectedTime] = useState('');
  const [showYearSelector, setShowYearSelector] = useState(false);
  const inputRef = useRef<HTMLDivElement>(null);
  const [portalPosition, setPortalPosition] = useState({ top: 0, left: 0, width: 0, maxHeight: 0 });
  const isUserSelecting = useRef(false);
  const lastValueRef = useRef(value);

  const monthNames = PersianCalendar.getMonthNames();
  const dayNames = PersianCalendar.getDayNames();

  useEffect(() => {
    // Only update if:
    // 1. Value has actually changed from the last time
    // 2. User is not currently selecting
    // 3. Value is different from current selectedDate
    if (value && 
        value !== lastValueRef.current && 
        !isUserSelecting.current && 
        value !== selectedDate) {
      setSelectedDate(value);
      lastValueRef.current = value;
      
      if (showTime && value.includes(' ')) {
        const [date, time] = value.split(' ');
        setSelectedTime(time);
      }
    }
  }, [value, showTime]);

  const getDaysInMonth = (year: number, month: number): number[] => {
    const daysInMonth = moment().jYear(year).jMonth(month - 1).daysInMonth();
    return Array.from({ length: daysInMonth }, (_, i) => i + 1);
  };

  const getFirstDayOfMonth = (year: number, month: number): number => {
    const firstDay = moment().jYear(year).jMonth(month - 1).jDate(1);
    // Adjust for Persian calendar where Saturday (شنبه) is day 0
    const day = firstDay.day();
    return day === 6 ? 0 : day + 1; // Convert Sunday=0 to Saturday=0
  };

  const handleDateSelect = (day: number) => {
    console.log('=== handleDateSelect called with day:', day, '===');
    console.log('Current selectedDate:', selectedDate);
    console.log('Current currentMonth:', currentMonth);
    
    isUserSelecting.current = true;
    const year = parseInt(currentMonth.split('/')[0]);
    const month = parseInt(currentMonth.split('/')[1]);
    const newDate = `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
    
    console.log('Calculated newDate:', newDate);
    setSelectedDate(newDate);
    lastValueRef.current = newDate;
    
    const fullDate = showTime ? `${newDate} ${selectedTime}` : newDate;
    console.log('Calling onChange with:', fullDate);
    onChange(fullDate);
    setIsOpen(false);
    
    console.log('=== handleDateSelect completed ===');
    
    // Reset the flag after a short delay
    setTimeout(() => {
      isUserSelecting.current = false;
      console.log('isUserSelecting reset to false');
    }, 100);
  };

  const handleTimeChange = (time: string) => {
    setSelectedTime(time);
    if (selectedDate) {
      onChange(`${selectedDate} ${time}`);
    }
  };

  const navigateMonth = (direction: 'prev' | 'next') => {
    const [year, month] = currentMonth.split('/').map(Number);
    let newYear = year;
    let newMonth = month;

    if (direction === 'prev') {
      newMonth--;
      if (newMonth < 1) {
        newMonth = 12;
        newYear--;
      }
    } else {
      newMonth++;
      if (newMonth > 12) {
        newMonth = 1;
        newYear++;
      }
    }

    setCurrentMonth(`${newYear}/${newMonth.toString().padStart(2, '0')}`);
  };

  const navigateYear = (direction: 'prev' | 'next') => {
    const [year, month] = currentMonth.split('/').map(Number);
    let newYear = year;

    if (direction === 'prev') {
      newYear = Math.max(newYear - 1, minYear);
    } else {
      newYear = Math.min(newYear + 1, maxYear);
    }

    setCurrentMonth(`${newYear}/${month.toString().padStart(2, '0')}`);
  };

  const selectYear = (year: number) => {
    const [, month] = currentMonth.split('/').map(Number);
    setCurrentMonth(`${year}/${month.toString().padStart(2, '0')}`);
    setShowYearSelector(false);
  };

  const generateYearOptions = () => {
    const years = [];
    for (let year = maxYear; year >= minYear; year--) {
      years.push(year);
    }
    return years;
  };

  const formatDisplayValue = useMemo((): string => {
    if (!selectedDate) return '';
    
    if (showTime && selectedTime) {
      return PersianCalendar.formatForDisplay(`${selectedDate} ${selectedTime}`, true);
    }
    
    return PersianCalendar.formatForDisplay(selectedDate);
  }, [selectedDate, selectedTime, showTime]);

  const updatePortalPosition = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      const calendarHeight = 400; // Approximate calendar height
      const calendarWidth = Math.max(rect.width, 300); // Minimum calendar width
      
      // Calculate position
      let top = rect.bottom + 8;
      let left = rect.left;
      
      // Check if calendar would go below viewport
      if (top + calendarHeight > viewportHeight) {
        // Position above the input
        top = rect.top - calendarHeight - 8;
      }
      
      // Check if calendar would go beyond right edge
      if (left + calendarWidth > viewportWidth) {
        left = viewportWidth - calendarWidth - 16; // 16px margin
      }
      
      // Ensure calendar doesn't go beyond left edge
      if (left < 16) {
        left = 16;
      }
      
      // Calculate available height
      const availableHeight = showYearSelector ? 
        Math.min(viewportHeight - top - 16, 500) : 
        Math.min(viewportHeight - top - 16, 400);
      
      setPortalPosition({
        top,
        left,
        width: calendarWidth,
        maxHeight: availableHeight
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePortalPosition();
      const handleResize = () => updatePortalPosition();
      const handleScroll = () => updatePortalPosition();
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as Node;
        console.log('Click outside detected, target:', target);
        console.log('Input contains target:', inputRef.current?.contains(target));
        console.log('Portal contains target:', document.querySelector('.persian-calendar-portal')?.contains(target));
        
        if (inputRef.current && 
            !inputRef.current.contains(target) && 
            !document.querySelector('.persian-calendar-portal')?.contains(target)) {
          console.log('Closing calendar due to click outside');
          // Add a small delay to prevent immediate closure
          setTimeout(() => {
            setIsOpen(false);
          }, 100);
        }
      };
      
      // Add a small delay before adding the click outside listener
      const timeoutId = setTimeout(() => {
        window.addEventListener('resize', handleResize);
        window.addEventListener('scroll', handleScroll);
        document.addEventListener('mousedown', handleClickOutside);
      }, 100);
      
      return () => {
        clearTimeout(timeoutId);
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('scroll', handleScroll);
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [isOpen]);

  const year = parseInt(currentMonth.split('/')[0]);
  const month = parseInt(currentMonth.split('/')[1]);
  const days = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  return (
    <div className={`relative ${className}`}>
      {/* Input Field */}
      <div
        ref={inputRef}
        className={`glass-liquid-input flex items-center justify-between cursor-pointer ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          console.log('Calendar input clicked, disabled:', disabled, 'isOpen:', isOpen);
          if (!disabled) {
            setIsOpen(!isOpen);
            console.log('Calendar toggled to:', !isOpen);
          }
        }}
      >
        <div className="flex items-center space-x-2 space-x-reverse">
          <FaCalendarAlt className="text-teal-500" />
          <span className={selectedDate ? 'text-primary' : 'text-secondary'}>
            {selectedDate ? formatDisplayValue : placeholder}
          </span>
        </div>
        <div className="flex items-center space-x-2 space-x-reverse">
          {showTime && selectedDate && (
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => handleTimeChange(e.target.value)}
              className="bg-transparent border-none text-sm text-primary focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
          )}
          <FaChevronLeft className={`text-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        </div>
      </div>

      {/* Calendar Dropdown Portal */}
      {isOpen && typeof window !== 'undefined' && createPortal(
        <div 
          className="persian-calendar-portal fixed glass-liquid-card p-4 z-[99999] shadow-2xl border border-white/20" 
          style={{ 
            top: `${portalPosition.top}px`,
            left: `${portalPosition.left}px`,
            width: `${portalPosition.width}px`,
            maxHeight: `${portalPosition.maxHeight}px`,
            transform: 'none',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <button
              onClick={() => navigateMonth('prev')}
              className="glass-liquid-btn p-2"
            >
              <FaChevronLeft />
            </button>
            
            <div className="text-center flex items-center gap-2">
              <div className="text-lg font-bold text-primary">
                {monthNames[month - 1]}
              </div>
              {enableYearSelection ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => navigateYear('prev')}
                    className="glass-liquid-btn p-1 text-sm"
                    disabled={year <= minYear}
                  >
                    <FaChevronLeft className="text-xs" />
                  </button>
                  <button
                    onClick={() => setShowYearSelector(!showYearSelector)}
                    className="text-lg font-bold text-primary hover:text-teal-400 transition-colors px-2 py-1 rounded"
                  >
                    {year}
                  </button>
                  <button
                    onClick={() => navigateYear('next')}
                    className="glass-liquid-btn p-1 text-sm"
                    disabled={year >= maxYear}
                  >
                    <FaChevronRight className="text-xs" />
                  </button>
                </div>
              ) : (
                <div className="text-lg font-bold text-primary">
                  {year}
                </div>
              )}
            </div>
            
            <button
              onClick={() => navigateMonth('next')}
              className="glass-liquid-btn p-2"
            >
              <FaChevronRight />
            </button>
          </div>

          {/* Year Selector Dropdown */}
          {enableYearSelection && showYearSelector && (
            <div className="mb-4 p-3 bg-white/5 rounded-lg border border-white/10">
              <div className="text-sm text-gray-300 mb-2 text-center">انتخاب سال</div>
              <div className="grid grid-cols-4 gap-2 max-h-32 overflow-y-auto">
                {generateYearOptions().map((yearOption) => (
                  <button
                    key={yearOption}
                    onClick={() => selectYear(yearOption)}
                    className={`p-2 text-sm rounded transition-colors ${
                      year === yearOption
                        ? 'bg-teal-500 text-white'
                        : 'hover:bg-white/10 text-primary'
                    }`}
                  >
                    {yearOption}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Day Names */}
          <div className="grid grid-cols-7 gap-1 mb-2">
            {dayNames.map((dayName) => (
              <div key={dayName} className="text-center text-sm text-secondary py-2">
                {dayName}
              </div>
            ))}
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1">
            {/* Empty cells for days before month starts */}
            {Array.from({ length: firstDay }, (_, i) => (
              <div key={`empty-${i}`} className="h-8"></div>
            ))}
            
            {/* Days of the month */}
            {days.map((day) => {
              const dayDate = `${year}/${month.toString().padStart(2, '0')}/${day.toString().padStart(2, '0')}`;
              const isSelected = selectedDate === dayDate;
              // Remove isToday check to prevent infinite re-rendering
              
              return (
                <button
                  key={day}
                  onClick={() => {
                    console.log('Button clicked for day:', day);
                    handleDateSelect(day);
                  }}
                  className={`h-8 text-sm rounded-lg transition-colors ${
                    isSelected
                      ? 'bg-teal-500 text-white'
                      : 'hover:bg-white/10 text-primary'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer */}
          <div className="mt-4 pt-4 border-t border-gray-700">
            <div className="flex justify-between items-center">
              <button
                onClick={() => {
                  isUserSelecting.current = true;
                  const today = PersianCalendar.now();
                  setSelectedDate(today);
                  lastValueRef.current = today; // Update the last value reference
                  onChange(today);
                  setIsOpen(false);
                  setTimeout(() => {
                    isUserSelecting.current = false;
                  }, 100);
                }}
                className="glass-liquid-btn text-sm px-3 py-1"
              >
                امروز
              </button>
              
              <button
                onClick={() => setIsOpen(false)}
                className="glass-liquid-btn-primary text-sm px-3 py-1"
              >
                تایید
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
