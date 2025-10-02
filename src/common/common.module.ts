import { Global, Module } from '@nestjs/common';
import { TimezoneService } from './services/timezone.service';
import { GlobalTimezoneInterceptor } from './interceptors/global-timezone.interceptor';

/**
 * Global Common Module
 * Cung cấp các services và interceptors chung cho toàn bộ ứng dụng
 */
@Global()
@Module({
  providers: [
    TimezoneService,
    GlobalTimezoneInterceptor,
  ],
  exports: [
    TimezoneService,
    GlobalTimezoneInterceptor,
  ],
})
export class CommonModule {}