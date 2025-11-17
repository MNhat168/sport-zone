import { Prop, Schema } from '@nestjs/mongoose';
import { Document } from 'mongoose';

/**
 * Base Entity with proper UTC timestamps
 * All other entities will extend from this class
 * 
 * ⚠️ IMPORTANT: MongoDB always stores timestamps in UTC
 * - Use new Date() to get current UTC time
 * - Never add timezone offsets to stored timestamps
 * - Display in Vietnam timezone (UTC+7) only when rendering to user
 */
@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    // ✅ Use UTC time - MongoDB stores in UTC, we convert to Vietnam time for display
    currentTime: () => new Date()
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
   * Creation time (stored in UTC, display in Vietnam timezone when needed)
   */
  @Prop({ type: Date })
  createdAt: Date;

  /**
   * Last update time (stored in UTC, display in Vietnam timezone when needed)
   */
  @Prop({ type: Date })
  updatedAt: Date;
}

/**
 * Helper function to configure timestamps for schemas extending BaseEntity
 */
export function configureBaseEntitySchema(schema: any) {
  schema.set('timestamps', {
    createdAt: true,
    updatedAt: true,
    // ✅ Use UTC time - MongoDB stores in UTC, we convert to Vietnam time for display
    currentTime: () => new Date()
  });
}