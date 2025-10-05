import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TimezoneService } from '../services/timezone.service';
import { SKIP_TIMEZONE_KEY } from '../decorators/skip-timezone.decorator';

/**
 * Global interceptor để tự động convert timestamps sang Vietnam timezone
 * Áp dụng cho tất cả responses mà không cần code thêm trong services
 */
@Injectable()
export class GlobalTimezoneInterceptor implements NestInterceptor {
  constructor(
    private readonly timezoneService: TimezoneService,
    private readonly reflector: Reflector,
  ) { }

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // Check if this endpoint should skip timezone conversion
    const skipTimezone = this.reflector.getAllAndOverride<boolean>(SKIP_TIMEZONE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipTimezone) {
      return next.handle();
    }

    return next.handle().pipe(
      map(data => this.transformTimestamps(data))
    );
  }

  /**
   * Recursively transform all timestamp fields to Vietnam timezone
   */
  private transformTimestamps(data: any, seen = new WeakSet()): any {
    if (!data) return data;

    // Prevent circular references
    if (typeof data === 'object') {
      if (seen.has(data)) return data;
      seen.add(data);
    }

    // Handle arrays
    if (Array.isArray(data)) {
      return data.map(item => this.transformTimestamps(item, seen));
    }

    // Handle objects
    if (typeof data === 'object' && data !== null) {
      if (data instanceof Date) {
        return this.timezoneService.toVietnamTime(data);
      }

      const transformed: any = {};
      for (const [key, value] of Object.entries(data)) {
        if ((key === 'createdAt' || key === 'updatedAt') && value instanceof Date) {
          transformed[key] = this.timezoneService.toVietnamTime(value);
        } else if (value && typeof value === 'object') {
          transformed[key] = this.transformTimestamps(value, seen);
        } else {
          transformed[key] = value;
        }
      }
      return transformed;
    }

    return data;
  }
}