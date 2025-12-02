import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';

// Entities
import { Booking, BookingSchema } from './entities/booking.entity';
import { Schedule, ScheduleSchema } from '../schedules/entities/schedule.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { User, UserSchema } from '../users/entities/user.entity';

// Services and Controllers
import { BookingsService } from './bookings.service';
import { BookingsController } from './bookings.controller';
import { TransactionsModule } from '../transactions/transactions.module';
import { FieldsModule } from '../fields/fields.module';
import { CoachesModule } from '../coaches/coaches.module';
import { EmailModule } from '../email/email.module';
import { ServiceModule } from '../../service/service.module';
import { WalletModule } from '../wallet/wallet.module';

// Specialized Services
import { AvailabilityService } from './services/availability.service';
import { FieldBookingService } from './services/field-booking.service';
import { SessionBookingService } from './services/session-booking.service';
import { PaymentHandlerService } from './services/payment-handler.service';
import { BookingEmailService } from './services/booking-email.service';

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
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
    EventEmitterModule,
    forwardRef(() => TransactionsModule),
    FieldsModule,
    CoachesModule,
    EmailModule,
    WalletModule, // [V2] Import WalletModule for wallet operations
    forwardRef(() => ServiceModule), // Import để dùng CleanupService
  ],
  controllers: [BookingsController],
  providers: [
    BookingsService,
    AvailabilityService,
    FieldBookingService,
    SessionBookingService,
    PaymentHandlerService,
    BookingEmailService,
  ],
  exports: [
    BookingsService,
    PaymentHandlerService, // Export để các module khác có thể dùng releaseBookingSlots
    BookingEmailService,
  ],
})
export class BookingsModule { }



