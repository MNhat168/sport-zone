import { SetMetadata } from '@nestjs/common';

/**
 * Decorator để bỏ qua timezone conversion cho endpoint cụ thể
 * Sử dụng: @SkipTimezoneConversion()
 */
export const SKIP_TIMEZONE_KEY = 'skipTimezone';
export const SkipTimezoneConversion = () => SetMetadata(SKIP_TIMEZONE_KEY, true);