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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: CoachProfile.name, schema: CoachProfileSchema },
      { name: Schedule.name, schema: ScheduleSchema },
      { name: LessonType.name, schema: LessonTypeSchema },
      { name: BankAccount.name, schema: BankAccountSchema },
    ]),
  ],
  controllers: [CoachesController],
  providers: [CoachesService, CoachScheduleService],
  exports: [CoachesService, CoachScheduleService],
})
export class CoachesModule { }