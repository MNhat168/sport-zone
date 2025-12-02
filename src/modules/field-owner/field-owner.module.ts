import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { FieldOwnerController } from './field-owner.controller';
import { FieldOwnerService } from './field-owner.service';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from './entities/field-owner-profile.entity';
import { FieldOwnerRegistrationRequest, FieldOwnerRegistrationRequestSchema } from './entities/field-owner-registration-request.entity';
import { BankAccount, BankAccountSchema } from './entities/bank-account.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { Amenity, AmenitySchema } from '../amenities/entities/amenities.entity';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { ServiceModule } from '../../service/service.module';
import { TransactionsModule } from '../transactions/transactions.module';
import { EmailModule } from '../email/email.module';
import { FieldsModule } from '../fields/fields.module';
import { EkycModule } from '../ekyc/ekyc.module';

@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      { name: Field.name, schema: FieldSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: FieldOwnerRegistrationRequest.name, schema: FieldOwnerRegistrationRequestSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: User.name, schema: UserSchema },
      { name: Amenity.name, schema: AmenitySchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    forwardRef(() => FieldsModule),
    forwardRef(() => TransactionsModule),
    forwardRef(() => ServiceModule),
    EmailModule,
    EkycModule,
  ],
  controllers: [FieldOwnerController],
  providers: [FieldOwnerService],
  exports: [FieldOwnerService],
})
export class FieldOwnerModule {}

