import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PayOSService } from './payos.service';
import { Transaction, TransactionSchema } from './entities/transaction.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { ServiceModule } from '../../service/service.module';
import { FieldOwnerModule } from '../field-owner/field-owner.module';
import { CoachProfile, CoachProfileSchema } from '../coaches/entities/coach-profile.entity';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
    ]),
    forwardRef(() => ServiceModule), // Import để dùng CleanupService
    forwardRef(() => FieldOwnerModule), // Import để dùng FieldOwnerService for bank account verification
    forwardRef(() => BookingsModule), // Import để dùng PaymentHandlerService
    NotificationsModule, // Import để dùng NotificationsGateway for real-time payment updates
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService,
    PayOSService,
  ],
  exports: [TransactionsService, PayOSService], // Export để các module khác sử dụng
})
export class TransactionsModule { }


