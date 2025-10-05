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
  private transformTimestamps(data: any, visited = new WeakSet()): any {
    if (!data) return data;

    // Handle primitive types
    if (typeof data !== 'object') return data;

    // Check for circular references
    if (visited.has(data)) {
      return data; // Return original to avoid infinite loop
    }

    // Handle Date objects
    if (data instanceof Date) {
      return this.timezoneService.toVietnamTime(data);
    }

    // Handle arrays
    if (Array.isArray(data)) {
      visited.add(data);
      const result = data.map(item => this.transformTimestamps(item, visited));
      visited.delete(data);
      return result;
    }

    // Handle objects (including Mongoose documents)
    if (typeof data === 'object' && data !== null) {
      visited.add(data);

      // Convert Mongoose document to plain object if needed
      const plainData = data.toObject ? data.toObject() : data;
      
      // Transform object properties
      const transformed = {};
      for (const [key, value] of Object.entries(plainData)) {
        // Transform timestamp fields
        if ((key === 'createdAt' || key === 'updatedAt') && value instanceof Date) {
          transformed[key] = this.timezoneService.toVietnamTime(value);
        } else if (value && typeof value === 'object') {
          // Recursively transform nested objects
          transformed[key] = this.transformTimestamps(value, visited);
        } else {
          transformed[key] = value;
        }
      }
      
      visited.delete(data);
      return transformed;
    }

    return data;
  }
}