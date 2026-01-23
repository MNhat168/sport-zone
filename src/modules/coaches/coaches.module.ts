import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { CoachesController } from './coaches.controller';
import { CoachProfileController } from './coach-profile.controller';
import { CoachesService } from './coaches.service';
import { CoachScheduleService } from './services/coach-schedule.service';
import { User, UserSchema } from 'src/modules/users/entities/user.entity';
import { CoachProfile, CoachProfileSchema } from 'src/modules/coaches/entities/coach-profile.entity';
import {
  Schedule,
  ScheduleSchema,
} from 'src/modules/schedules/entities/schedule.entity';

import { BankAccount, BankAccountSchema } from '../field-owner/entities/bank-account.entity';
import { CoachRegistrationRequest, CoachRegistrationRequestSchema } from './entities/coach-registration-request.entity';
import { FieldOwnerRegistrationRequest, FieldOwnerRegistrationRequestSchema } from '../field-owner/entities/field-owner-registration-request.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { EmailService } from 'src/modules/email/email.service';
import { ServiceModule } from '../../service/service.module';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { TransactionsModule } from '../transactions/transactions.module';
import { EkycModule } from '../ekyc/ekyc.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
      { name: Schedule.name, schema: ScheduleSchema },

      { name: BankAccount.name, schema: BankAccountSchema },
      { name: CoachRegistrationRequest.name, schema: CoachRegistrationRequestSchema },
      { name: FieldOwnerRegistrationRequest.name, schema: FieldOwnerRegistrationRequestSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
      { name: Transaction.name, schema: TransactionSchema },
    ]),
    ServiceModule,
    TransactionsModule,
    EkycModule,
    ConfigModule,
  ],
  controllers: [CoachesController, CoachProfileController],
  providers: [CoachesService, CoachScheduleService, EmailService],
  exports: [CoachesService, CoachScheduleService],
})
export class CoachesModule { }

