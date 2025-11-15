import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PaymentCleanupService } from './payment-cleanup.service';
import { VNPayService } from './vnpay.service';
import { PayOSService } from './payos.service';
import { Transaction, TransactionSchema } from './entities/transaction.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { ServiceModule } from '../../service/service.module';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Booking.name, schema: BookingSchema },
      { name: Schedule.name, schema: ScheduleSchema },
    ]),
    forwardRef(() => ServiceModule), // Import để dùng CleanupService
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService, 
    PaymentCleanupService, 
    VNPayService,
    PayOSService,
  ],
  exports: [TransactionsService, VNPayService, PayOSService], // Export để các module khác sử dụng
})
export class TransactionsModule {}


