import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoachesController } from './coaches.controller';
import { CoachesService } from './coaches.service';
import { CoachScheduleService } from './services/coach-schedule.service';
import { User, UserSchema } from 'src/modules/users/entities/user.entity';
import { CoachProfile, CoachProfileSchema } from 'src/modules/coaches/entities/coach-profile.entity';
import {
  Schedule,
  ScheduleSchema,
} from 'src/modules/schedules/entities/schedule.entity';
import {
  LessonType,
  LessonTypeSchema,
} from 'src/modules/lessontypes/entities/lesson-type.entity';
import { BankAccount, BankAccountSchema } from '../field-owner/entities/bank-account.entity';
import { CoachRegistrationRequest, CoachRegistrationRequestSchema } from './entities/coach-registration-request.entity';
import { EmailService } from 'src/modules/email/email.service';
import { ServiceModule } from '../../service/service.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: LessonType.name, schema: LessonTypeSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
      { name: CoachRegistrationRequest.name, schema: CoachRegistrationRequestSchema },
    ]),
    ServiceModule,
  ],
  controllers: [CoachesController],
  providers: [CoachesService, CoachScheduleService, EmailService],
  exports: [CoachesService, CoachScheduleService],
})
export class CoachesModule { }
