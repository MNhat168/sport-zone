import { Injectable } from '@nestjs/common';
import { convertToVietnamTime, getCurrentVietnamTime, formatVietnamTime } from '../../utils/timezone.utils';

/**
 * Service để xử lý timezone một cách nhất quán trong toàn bộ ứng dụng
 */
@Injectable()
export class TimezoneService {
  
  /**
   * Convert UTC time to Vietnam timezone
   */
  toVietnamTime(utcDate: Date): Date {
    return convertToVietnamTime(utcDate);
  }

  /**
   * Get current Vietnam time
   */
  getCurrentVietnamTime(): Date {
    return getCurrentVietnamTime();
  }

  /**
   * Format date to Vietnam timezone string
   */
  formatVietnamTime(date: Date, format: 'iso' | 'readable' = 'iso'): string {
    return formatVietnamTime(date, format);
  }

  /**
   * Add Vietnam timezone info to response objects
   */
  addTimezoneToResponse<T extends Record<string, any>>(
    entity: T,
    timestampFields: string[] = ['createdAt', 'updatedAt']
  ): T {
    const response = { ...entity } as any;
    
    timestampFields.forEach(field => {
      if (response[field]) {
        response[field] = this.toVietnamTime(response[field]);
      }
    });
    
    return response;
  }

  /**
   * Add Vietnam timezone to array of response objects
   */
  addTimezoneToResponseArray<T extends Record<string, any>>(
    entities: T[],
    timestampFields: string[] = ['createdAt', 'updatedAt']
  ): T[] {
    return entities.map(entity => this.addTimezoneToResponse(entity, timestampFields));
  }
}