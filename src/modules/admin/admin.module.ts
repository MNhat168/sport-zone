import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/entities/user.entity';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
  ],
  controllers: [AdminController],
  providers: [AdminService]
})
export class AdminModule { }
