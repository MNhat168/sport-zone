import { Injectable, PipeTransform } from '@nestjs/common';

/**
 * Transform pipe to convert ObjectIds to strings in API responses
 */
@Injectable()
export class ObjectIdToStringPipe implements PipeTransform {
  transform(value: any): any {
    if (!value) return value;
    
    return this.convertObjectIds(value);
  }

  private convertObjectIds(obj: any): any {
    if (!obj) return obj;
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.convertObjectIds(item));
    }
    
    if (typeof obj === 'object' && obj !== null) {
      // Handle ObjectId specifically
      if (obj.constructor.name === 'ObjectId') {
        return obj.toString();
      }
      
      // Handle buffer objects (ObjectId serialized as buffer)
      if (obj.buffer && typeof obj.buffer === 'object') {
        // This is likely an ObjectId serialized incorrectly
        return obj.toString();
      }
      
      const converted = {};
      for (const [key, value] of Object.entries(obj)) {
        if (key === '_id' && value && typeof value === 'object' && 'toString' in value) {
          converted[key] = value.toString();
        } else {
          converted[key] = this.convertObjectIds(value);
        }
      }
      return converted;
    }
    
    return obj;
  }
}