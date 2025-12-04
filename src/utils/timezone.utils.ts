/**
 * Timezone utilities for Vietnam (UTC+7)
 */

/**
 * Convert UTC time to Vietnam timezone (UTC+7)
 */
export function convertToVietnamTime(utcDate: Date): Date {
    if (!utcDate) return utcDate;
    // New behavior: dữ liệu đã được lưu theo UTC+7, không cần cộng offset khi đọc/hiển thị
    // Trả về bản sao để tránh mutate đối tượng gốc
    return new Date(utcDate);
}

/**
 * Get current Vietnam time
 */
export function getCurrentVietnamTime(): Date {
    // Dữ liệu trong DB đã được lưu theo giờ Việt Nam (UTC+7),
    // nên cho mục đích hiển thị/log chỉ cần new Date() là đủ.
    return new Date();
}

/**
 * Get current Vietnam time for DB storage
 * 
 * Dùng hàm này khi bạn muốn:
 * - Server deploy ở bất kỳ timezone nào
 * - Nhưng giá trị lưu trong MongoDB luôn trùng với giờ Việt Nam khi nhìn bằng mắt
 */
export function getCurrentVietnamTimeForDB(): Date {
    return new Date(Date.now() + (7 * 60 * 60 * 1000));
}

/**
 * Format date to Vietnam timezone string
 */
export function formatVietnamTime(date: Date, format: 'iso' | 'readable' = 'iso'): string {
    const baseDate = date instanceof Date ? date : new Date(date);

    if (format === 'readable') {
        // Hiển thị theo múi giờ Việt Nam nhưng KHÔNG đổi mốc thời gian
        return baseDate.toLocaleString('vi-VN', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false,
        });
    }

    // Chuẩn ISO có offset +07:00, tính toán phần ngày/giờ theo Asia/Ho_Chi_Minh rồi đóng gói offset
    // Vì Việt Nam không DST, offset luôn +07:00
    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Ho_Chi_Minh',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
        hour12: false,
    });
    const parts = dtf.formatToParts(baseDate);
    const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
    return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}+07:00`;
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
    // Dữ liệu được hiểu là thời gian Việt Nam; tạo Date tương ứng với mốc đó
    // Cách đơn giản và nhất quán: lấy thời điểm theo VN bằng cách cộng offset +7 vào UTC mốc 0h cùng ngày
    const vnLocal = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    // vnLocal hiện đang ở UTC mốc theo input; để biểu diễn đúng VN (UTC+7), dịch thêm +7h
    return new Date(vnLocal.getTime() - (0 * 60 * 60 * 1000)); // giữ nguyên, không trừ 7h nữa
}
