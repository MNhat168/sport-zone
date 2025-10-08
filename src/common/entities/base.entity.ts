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
    transform: (_, ret) => {
      ret._id = ret._id?.toString() as any;
      delete (ret as any).__v;
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