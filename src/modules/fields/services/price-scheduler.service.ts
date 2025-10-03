import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule'; 
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Field } from '../entities/field.entity';

@Injectable()
export class PriceSchedulerService {
  private readonly logger = new Logger(PriceSchedulerService.name);

  constructor(
    @InjectModel(Field.name)
    private readonly fieldModel: Model<Field>,
  ) {}

  // Chạy mỗi ngày lúc 00:01 để áp dụng price updates
  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async applyScheduledPriceUpdates() {
    this.logger.log('Starting scheduled price updates application...');

    const today = new Date();
    today.setHours(0, 0, 0, 0); // 00:00:00 hôm nay

    // Tìm các Field có pendingPriceUpdates đến hạn (effectiveDate <= today và applied=false)
    const fields = await this.fieldModel.find({
      pendingPriceUpdates: { $elemMatch: { effectiveDate: { $lte: today }, applied: false } },
    });

    this.logger.log(`Found ${fields.length} fields with pending price updates to apply`);

    for (const field of fields) {
      try {
        // Lấy các update đến hạn, sắp xếp theo effectiveDate tăng dần
        const dueUpdates = (field as any).pendingPriceUpdates
          .filter((u: any) => !u.applied && new Date(u.effectiveDate) <= today)
          .sort((a: any, b: any) => new Date(a.effectiveDate).getTime() - new Date(b.effectiveDate).getTime());

        for (const update of dueUpdates) {
          (field as any).priceRanges = update.newPriceRanges;
          (field as any).basePrice = update.newBasePrice;
          update.applied = true;
        }

        await field.save();
        this.logger.log(`Applied ${dueUpdates.length} price updates for field ${field._id}`);
      } catch (error) {
        this.logger.error(`Failed to apply price updates for field ${field._id}:`, error);
      }
    }

    this.logger.log('Completed scheduled price updates application');
  }
  // Scheduler này chỉ áp dụng update; các thao tác tạo/hủy/list handled bởi FieldsService khi lưu trong Field
}
