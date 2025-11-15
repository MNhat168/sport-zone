import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { PriceSchedulerService } from './services/price-scheduler.service';


import { MongooseModule } from '@nestjs/mongoose';
import { Field, FieldSchema } from './entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from './entities/field-owner-profile.entity';
import { ServiceModule } from '../../service/service.module';
// Import Schedule and Booking for availability checking
import { Schedule } from '../schedules/entities/schedule.entity';
import { ScheduleSchema } from '../schedules/entities/schedule.entity';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingSchema } from '../bookings/entities/booking.entity';
// Import User for today bookings feature
import { User, UserSchema } from '../users/entities/user.entity';
// Import Amenities for field amenities integration
import { Amenity, AmenitySchema } from '../amenities/entities/amenities.entity';
// Removed separate PendingPriceUpdate collection; use embedded pendingPriceUpdates in Field

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Field.name, schema: FieldSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
      { name: Amenity.name, schema: AmenitySchema },
    ]),
    forwardRef(() => ServiceModule),
  ],
  controllers: [FieldsController],
  providers: [FieldsService, PriceSchedulerService],
  exports: [FieldsService], // PriceFormatService được export từ ServiceModule
})
export class FieldsModule { }


