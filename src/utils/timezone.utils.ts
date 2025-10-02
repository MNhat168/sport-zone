/**
 * Timezone utilities for Vietnam (UTC+7)
 */

/**
 * Convert UTC time to Vietnam timezone (UTC+7)
 */
export function convertToVietnamTime(utcDate: Date): Date {
    if (!utcDate) return utcDate;
    
    // Create new date instance để tránh modify original
    const vietnamTime = new Date(utcDate);
    
    // Add 7 hours for Vietnam timezone (UTC+7)
    vietnamTime.setHours(vietnamTime.getHours() + 7);
    
    return vietnamTime;
}

/**
 * Get current Vietnam time
 */
export function getCurrentVietnamTime(): Date {
    return new Date(Date.now() + (7 * 60 * 60 * 1000));
}

/**
 * Format date to Vietnam timezone string
 */
export function formatVietnamTime(date: Date, format: 'iso' | 'readable' = 'iso'): string {
    const vietnamTime = convertToVietnamTime(date);
    
    if (format === 'readable') {
        return vietnamTime.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
        });
    }
    
    // ISO format with +07:00 timezone
    return vietnamTime.toISOString().replace('Z', '+07:00');
}

/**
 * Create date in Vietnam timezone
 */
export function createVietnamDate(
    year: number, 
    month: number, 
    day: number, 
    hour: number = 0, 
    minute: number = 0, 
    second: number = 0
): Date {
    // Tạo date local rồi convert về UTC-7 để lưu database
    const localDate = new Date(year, month - 1, day, hour, minute, second);
    return new Date(localDate.getTime() - (7 * 60 * 60 * 1000));
}