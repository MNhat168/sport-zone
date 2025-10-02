// Helper function để chuyển 'HH:MM' thành phút (đặt trong file util hoặc ở đây tạm)
export function timeToMinutes(time: string): number {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
}