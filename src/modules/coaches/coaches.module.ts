import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoachesController } from './coaches.controller';
import { CoachesService } from './coaches.service';
import { User, UserSchema } from 'src/modules/users/entities/user.entity';
import { CoachProfile, CoachProfileSchema } from 'src/modules/profiles/entities/coach-profile.entity';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: User.name, schema: UserSchema },
            { name: CoachProfile.name, schema: CoachProfileSchema },
        ]),
    ],
    controllers: [CoachesController],
    providers: [CoachesService],
    exports: [CoachesService],
})
export class CoachesModule { }