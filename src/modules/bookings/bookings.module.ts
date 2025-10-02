import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Entities
import { Booking, BookingSchema } from './entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';

// Services and Controllers
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';

/**
 * Bookings Module with Pure Lazy Creation pattern
 * Implements lazy schedule creation with atomic upserts
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: Field.name, schema: FieldSchema },
    ]),
    EventEmitterModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
