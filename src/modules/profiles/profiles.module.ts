import { Module } from '@nestjs/common';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';
import { MongooseModule } from '@nestjs/mongoose';
import { CoachProfile, CoachProfileSchema } from '../coaches/entities/coach-profile.entity';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CoachProfile.name, schema: CoachProfileSchema }]),
  ],
  controllers: [ProfilesController],
  providers: [ProfilesService]
})
export class ProfilesModule {}
