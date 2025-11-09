import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AwsS3Service } from './aws-s3.service';
import { GeneratorService } from './generator.service';
import { PriceFormatService } from './price-format.service';
import { CleanupService } from './cleanup.service';
import { Transaction, TransactionSchema } from '../modules/transactions/entities/transaction.entity';
import { Booking, BookingSchema } from '../modules/bookings/entities/booking.entity';
import { BookingsModule } from '../modules/bookings/bookings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    EventEmitterModule, // Import để CleanupService có thể emit events
    forwardRef(() => BookingsModule), // Import để dùng PaymentHandlerService
  ],
  providers: [
    AwsS3Service,
    GeneratorService,
    PriceFormatService,
    CleanupService,
  ],
  exports: [
    AwsS3Service,
    GeneratorService,
    PriceFormatService,
    CleanupService, // Export để các module khác có thể dùng cleanup logic
  ],
})
export class ServiceModule {}