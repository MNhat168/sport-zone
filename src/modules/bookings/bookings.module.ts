import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Entities
import { Booking, BookingSchema } from './entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../fields/entities/field-owner-profile.entity';
import { User, UserSchema } from '../users/entities/user.entity';

// Services and Controllers
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { FieldsModule } from '../fields/fields.module';
import { CoachesModule } from '../coaches/coaches.module';
import { EmailModule } from '../email/email.module';

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
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EventEmitterModule,
    TransactionsModule,
    FieldsModule,
    CoachesModule,
    EmailModule,
  ],
  controllers: [BookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule { }
