import { Module, forwardRef } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { User, UserSchema } from './entities/user.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { Booking, BookingSchema } from '../bookings/entities/booking.entity';
import { UserRepository } from './repositories/user.repository';
import { USER_REPOSITORY } from './interface/users.interface';
import { ServiceModule } from '../../service/service.module';
import { EmailModule } from '../email/email.module';
import { JwtModule } from '@nestjs/jwt';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Field.name, schema: FieldSchema },
      { name: Booking.name, schema: BookingSchema },
    ]),
    forwardRef(() => BookingsModule),
    ServiceModule,
    JwtModule.register({}),
    EmailModule
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UserRepository,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    }
  ],
  exports: [
    UsersService,
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]), // Export the User model
  ]
})
export class UsersModule {}