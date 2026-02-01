import moment from 'moment-jalaali';

// Ensure moment-jalaali is properly loaded
try {
  moment.loadPersian({ dialect: 'persian-modern' });
} catch (error) {
  console.warn('Could not load Persian dialect:', error);
}

// Persian calendar utility functions
export class PersianCalendar {
  /**
   * Convert Gregorian date to Persian (Jalali) date string
   * @param date - JavaScript Date object or date string
   * @param format - Output format (default: 'jYYYY/jMM/jDD')
   * @returns Persian date string
   */
  static toPersian(date: Date | string, format: string = 'jYYYY/jMM/jDD'): string {
    const momentDate = moment(date);
    return momentDate.format(format);
  }

  /**
   * Convert Persian (Jalali) date string to Gregorian Date object
   * @param persianDate - Persian date string (e.g., '1403/06/15')
   * @param format - Input format (default: 'jYYYY/jMM/jDD')
   * @returns JavaScript Date object
   */
  static toGregorian(persianDate: string, format: string = 'jYYYY/jMM/jDD'): Date {
    const momentDate = moment(persianDate, format);
    return momentDate.toDate();
  }

  /**
   * Get current Persian date
   * @param format - Output format (default: 'jYYYY/jMM/jDD')
   * @returns Current Persian date string
   */
  static now(format: string = 'jYYYY/jMM/jDD'): string {
    try {
      // Use moment-jalaali directly
      const now = moment();
      const formatted = now.format(format);
      
      // If the formatted date looks wrong, try manual formatting
      if (!formatted || formatted.includes('Invalid') || formatted.length < 8) {
        const year = now.jYear();
        const month = String(now.jMonth() + 1).padStart(2, '0');
        const day = String(now.jDate()).padStart(2, '0');
        const manualFormat = `${year}/${month}/${day}`;
        return manualFormat;
      }
      
      return formatted;
    } catch (error) {
      console.error('Error in PersianCalendar.now():', error);
      // Fallback to current year
      return '1403/01/01';
    }
  }

  /**
   * Get current Persian time
   * @param format - Output format (default: 'HH:mm')
   * @returns Current Persian time string
   */
  static nowTime(format: string = 'HH:mm'): string {
    return moment().format(format);
  }

  /**
   * Format Persian date with Persian month names
   * @param date - JavaScript Date object or date string
   * @returns Formatted Persian date with month names
   */
  static formatWithMonthNames(date: Date | string): string {
    const momentDate = moment(date);
    const year = momentDate.format('jYYYY');
    const month = momentDate.format('jMM');
    const day = momentDate.format('jDD');
    
    const monthNames = [
      'فروردین', 'اردیبهشت', 'خرداد', 'تیر',
      'مرداد', 'شهریور', 'مهر', 'آبان',
      'آذر', 'دی', 'بهمن', 'اسفند'
    ];
    
    const monthName = monthNames[parseInt(month) - 1];
    return `${day} ${monthName} ${year}`;
  }

  /**
   * Get Persian day of week
   * @param date - JavaScript Date object, date string, or moment object
   * @returns Persian day name
   */
  static getPersianDayOfWeek(date: Date | string | any): string {
    let momentDate;
    
    // If it's already a moment object, use it directly
    if (date && typeof date === 'object' && date._isAMomentObject) {
      momentDate = date;
    }
    // If it's a string, check if it's already a Persian date format
    else if (typeof date === 'string' && date.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
      // It's already a Persian date, parse it correctly
      momentDate = moment(date, 'jYYYY/jMM/jDD');
    } else {
      // It's a regular date, convert to Persian
      momentDate = moment(date);
    }
    
    // Use the Persian day of week directly from moment-jalaali
    const persianDayOfWeek = momentDate.format('dddd');
    
    // Map Persian day names to our consistent format
    const dayNameMap: { [key: string]: string } = {
      'شنبه': 'شنبه',
      'یکشنبه': 'یکشنبه', 
      'دوشنبه': 'دوشنبه',
      'سه‌شنبه': 'سه‌شنبه',
      'چهارشنبه': 'چهارشنبه',
      'پنج‌شنبه': 'پنج‌شنبه',
      'جمعه': 'جمعه'
    };
    
    return dayNameMap[persianDayOfWeek] || persianDayOfWeek;
  }

  /**
   * Add days to Persian date
   * @param persianDate - Persian date string
   * @param days - Number of days to add
   * @param format - Input/output format (default: 'jYYYY/jMM/jDD')
   * @returns New Persian date string
   */
  static addDays(persianDate: string, days: number, format: string = 'jYYYY/jMM/jDD'): string {
    const momentDate = moment(persianDate, format);
    return momentDate.add(days, 'days').format(format);
  }

  /**
   * Subtract days from Persian date
   * @param persianDate - Persian date string
   * @param days - Number of days to subtract
   * @param format - Input/output format (default: 'jYYYY/jMM/jDD')
   * @returns New Persian date string
   */
  static subtractDays(persianDate: string, days: number, format: string = 'jYYYY/jMM/jDD'): string {
    const momentDate = moment(persianDate, format);
    return momentDate.subtract(days, 'days').format(format);
  }

  /**
   * Get start of Persian day (00:00:00)
   * @param date - JavaScript Date object or date string
   * @returns Date object at start of day
   */
  static startOfDay(date: Date | string): Date {
    return moment(date).startOf('day').toDate();
  }

  /**
   * Get end of Persian day (23:59:59)
   * @param date - JavaScript Date object or date string
   * @returns Date object at end of day
   */
  static endOfDay(date: Date | string): Date {
    return moment(date).endOf('day').toDate();
  }

  /**
   * Check if date is today in Persian calendar
   * @param date - JavaScript Date object or date string
   * @returns True if date is today
   */
  static isToday(date: Date | string): boolean {
    const today = moment().format('jYYYY/jMM/jDD');
    const checkDate = moment(date).format('jYYYY/jMM/jDD');
    return today === checkDate;
  }

  /**
   * Get Persian date range for attendance records
   * @param persianDate - Persian date string (default: today)
   * @returns Object with start and end dates for the day
   */
  static getDayRange(persianDate?: string): { start: Date; end: Date; persianDate: string } {
    const targetDate = persianDate || this.now();
    const gregorianDate = this.toGregorian(targetDate);
    
    return {
      start: this.startOfDay(gregorianDate),
      end: this.endOfDay(gregorianDate),
      persianDate: targetDate
    };
  }

  /**
   * Format Persian date for display in UI
   * @param date - JavaScript Date object or date string
   * @param includeTime - Whether to include time (default: false)
   * @returns Formatted Persian date string for UI
   */
  static formatForDisplay(date: Date | string, includeTime: boolean = false): string {
    let momentDate;
    
    
    // If it's a string, check if it's already a Persian date format
    if (typeof date === 'string' && date.match(/^\d{4}\/\d{2}\/\d{2}$/)) {
      // It's already a Persian date, parse it correctly
      momentDate = moment(date, 'jYYYY/jMM/jDD');
    } else {
      // It's a regular date, convert to Persian
      momentDate = moment(date);
    }
    
    const persianDate = momentDate.format('jYYYY/jMM/jDD');
    const dayOfWeek = this.getPersianDayOfWeek(momentDate);
    
    
    if (includeTime) {
      const time = momentDate.format('HH:mm');
      return `${dayOfWeek} ${persianDate} - ${time}`;
    }
    
    return `${dayOfWeek} ${persianDate}`;
  }

  /**
   * Get Persian month names array
   * @returns Array of Persian month names
   */
  static getMonthNames(): string[] {
    return [
      'فروردین', 'اردیبهشت', 'خرداد', 'تیر',
      'مرداد', 'شهریور', 'مهر', 'آبان',
      'آذر', 'دی', 'بهمن', 'اسفند'
    ];
  }

  /**
   * Get Persian day names array
   * @returns Array of Persian day names
   */
  static getDayNames(): string[] {
    return [
      'شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 
      'چهارشنبه', 'پنج‌شنبه', 'جمعه'
    ];
  }

  /**
   * Validate Persian date string
   * @param persianDate - Persian date string to validate
   * @param format - Expected format (default: 'jYYYY/jMM/jDD')
   * @returns True if date is valid
   */
  static isValid(persianDate: string, format: string = 'jYYYY/jMM/jDD'): boolean {
    const momentDate = moment(persianDate, format, true);
    return momentDate.isValid();
  }
}

// Export default instance for convenience
export default PersianCalendar;
