import { Prop, Schema } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Base Entity với timezone Việt Nam mặc định
 * Tất cả entities khác sẽ extend từ class này
 */
@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    // Cấu hình timezone cho Việt Nam (UTC+7)
    currentTime: () => new Date(Date.now() + (7 * 60 * 60 * 1000))
  },
  toJSON: {
    transform: function(_, ret: any) {
      // Convert main _id to string
      if (ret._id) {
        ret._id = ret._id.toString();
      }
      
      // Convert nested ObjectIds to strings (for populated fields)
      const convertNestedObjectIds = (obj: any): any => {
        if (!obj) return obj;
        
        if (Array.isArray(obj)) {
          return obj.map(item => convertNestedObjectIds(item));
        }
        
        if (typeof obj === 'object' && obj !== null) {
          // Handle ObjectId
          if (obj.constructor && obj.constructor.name === 'ObjectId') {
            return obj.toString();
          }
          
          // Handle nested objects
          const converted: any = {};
          for (const [key, value] of Object.entries(obj)) {
            if (key === '_id' && value && typeof value === 'object' && 'toString' in value) {
              converted[key] = value.toString();
            } else if (typeof value === 'object') {
              converted[key] = convertNestedObjectIds(value);
            } else {
              converted[key] = value;
            }
          }
          return converted;
        }
        
        return obj;
      };
      
      // Apply conversion to all fields
      Object.keys(ret).forEach(key => {
        if (key !== '_id') {
          ret[key] = convertNestedObjectIds(ret[key]);
        }
      });
      
      // Remove mongoose version key safely
      if (ret.__v !== undefined) {
        delete ret.__v;
      }
      return ret;
    },
  }
})
export abstract class BaseEntity extends Document {
  /**
   * Thời gian tạo (Vietnam timezone)
   */
  @Prop({ type: Date })
  createdAt: Date;

  /**
   * Thời gian cập nhật cuối (Vietnam timezone)  
   */
  @Prop({ type: Date })
  updatedAt: Date;
}

/**
 * Helper function để cấu hình timestamps cho schema extends BaseEntity
 */
export function configureBaseEntitySchema(schema: any) {
  schema.set('timestamps', {
    createdAt: true,
    updatedAt: true,
    // Cấu hình timezone cho Việt Nam (UTC+7)
    currentTime: () => new Date(Date.now() + (7 * 60 * 60 * 1000))
  });
}