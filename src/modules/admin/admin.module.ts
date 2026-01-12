// admin.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { User, UserSchema } from '../users/entities/user.entity';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { CoachProfile, CoachProfileSchema } from '../coaches/entities/coach-profile.entity';

import { AiModule } from '../ai/ai.module';
import { FieldOwnerProfile } from '@modules/field-owner/entities/field-owner-profile.entity';
import { Notification, NotificationSchema } from '../notifications/entities/notification.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Field.name, schema: FieldSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
      { name: FieldOwnerProfile.name, schema: CoachProfileSchema },

      { name: Notification.name, schema: NotificationSchema },
    ]),
    AiModule,
  ],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule { }