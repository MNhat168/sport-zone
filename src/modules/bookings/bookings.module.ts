import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Entities
import { Booking, BookingSchema } from './entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { CoachProfile, CoachProfileSchema } from '../coaches/entities/coach-profile.entity';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { Court, CourtSchema } from '../courts/entities/court.entity';

// Services and Controllers
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { FieldsModule } from '../fields/fields.module';
import { CoachesModule } from '../coaches/coaches.module';
import { EmailModule } from '../email/email.module';
import { ServiceModule } from '../../service/service.module';
import { WalletModule } from '../wallet/wallet.module';
import { AiModule } from '../ai/ai.module';

// Specialized Services
import { AvailabilityService } from './services/availability.service';
import { FieldBookingService } from './services/field-booking.service';
import { SessionBookingService } from './services/session-booking.service';
import { PaymentHandlerService } from './services/payment-handler.service';
import { BookingEmailService } from './services/booking-email.service';
import { CoachBookingService } from './services/coach-booking.service';
import { OwnerBookingService } from './services/owner-booking.service';
import { BookingQueryService } from './services/booking-query.service';
import { BookingCancellationService } from './services/booking-cancellation.service';
import { PaymentProofService } from './services/payment-proof.service';

/**
 * Bookings Module with Pure Lazy Creation pattern
 * Implements lazy schedule creation with atomic upserts
 * 
 * Modular architecture with separation of concerns:
 * - AvailabilityService: Slot generation & conflict checking
 * - FieldBookingService: Field booking creation & management
 * - SessionBookingService: Coach session booking operations
 * - PaymentHandlerService: Payment event handling (CRITICAL)
 * - BookingsService: Main orchestrator
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Booking.name, schema: BookingSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: Field.name, schema: FieldSchema },
      { name: Court.name, schema: CourtSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: User.name, schema: UserSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    EventEmitterModule,
    forwardRef(() => TransactionsModule),
    FieldsModule,
    CoachesModule,
    EmailModule,
    WalletModule, // [V2] Import WalletModule for wallet operations
    forwardRef(() => ServiceModule), // Import để dùng CleanupService
    AiModule,
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    AvailabilityService,
    FieldBookingService,
    SessionBookingService,
    PaymentHandlerService,
    BookingEmailService,
    CoachBookingService,
    OwnerBookingService,
    BookingQueryService,
    BookingCancellationService,
    PaymentProofService,
  ],
  exports: [
    BookingsService,
    PaymentHandlerService, // Export để các module khác có thể dùng releaseBookingSlots
    BookingEmailService,
  ],
})
export class BookingsModule { }



