import { Module, forwardRef } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { FieldsController } from './fields.controller';
import { FieldsService } from './fields.service';
import { PriceSchedulerService } from './services/price-scheduler.service';


import { MongooseModule } from '@nestjs/mongoose';
import { Field, FieldSchema } from './entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { FieldOwnerRegistrationRequest, FieldOwnerRegistrationRequestSchema } from '../field-owner/entities/field-owner-registration-request.entity';
import { BankAccount, BankAccountSchema } from '../field-owner/entities/bank-account.entity';
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
// Import Transaction for transaction status filtering
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
// Import PayOS and Email services
import { TransactionsModule } from '../transactions/transactions.module';
import { EmailModule } from '../email/email.module';
// Removed separate PendingPriceUpdate collection; use embedded pendingPriceUpdates in Field
import { Court, CourtSchema } from '../courts/entities/court.entity';
import { CourtsModule } from '../courts/courts.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    MongooseModule.forFeature([
      { name: Field.name, schema: FieldSchema },
      { name: Court.name, schema: CourtSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: FieldOwnerRegistrationRequest.name, schema: FieldOwnerRegistrationRequestSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: User.name, schema: UserSchema },
      { name: Amenity.name, schema: AmenitySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    forwardRef(() => ServiceModule),
    forwardRef(() => TransactionsModule),
    EmailModule,
    CourtsModule,
  ],
  controllers: [FieldsController],
  providers: [FieldsService, PriceSchedulerService],
  exports: [FieldsService], // PriceFormatService được export từ ServiceModule
})
export class FieldsModule { }


