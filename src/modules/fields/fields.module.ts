import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule'; 
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { PriceSchedulerService } from './services/price-scheduler.service';
import { MongooseModule } from '@nestjs/mongoose';
import { Field } from './entities/field.entity';
import { FieldSchema } from './schema/field-schema';
import { FieldOwnerProfile } from './entities/field-owner-profile.entity';
import { FieldOwnerProfileSchema } from './schema/field-owner-schema';
// Removed separate PendingPriceUpdate collection; use embedded pendingPriceUpdates in Field

@Module({
  imports: [
    ScheduleModule.forRoot(), 
    MongooseModule.forFeature([
      { name: Field.name, schema: FieldSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
    ]),
  ],
  controllers: [FieldsController],
  providers: [FieldsService, PriceSchedulerService],
})
export class FieldsModule {}
