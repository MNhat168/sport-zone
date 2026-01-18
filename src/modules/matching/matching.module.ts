import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { MatchProfile, MatchProfileSchema } from './entities/match-profile.entity';
import { Swipe, SwipeSchema } from './entities/swipe.entity';
import { Match, MatchSchema } from './entities/match.entity';
import { MatchingService } from './matching.service';
import { MatchingController } from './matching.controller';
import { MatchingGateway } from './matching.gateway';
import { UsersModule } from '../users/users.module';
import { ChatModule } from '../chat/chat.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: MatchProfile.name, schema: MatchProfileSchema },
            { name: Swipe.name, schema: SwipeSchema },
            { name: Match.name, schema: MatchSchema },
        ]),
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'your-secret-key',
            signOptions: { expiresIn: '7d' },
        }),
        forwardRef(() => UsersModule),
        forwardRef(() => ChatModule),
        BookingsModule,
    ],
    controllers: [MatchingController],
    providers: [MatchingService, MatchingGateway],
    exports: [MatchingService, MatchingGateway],
})
export class MatchingModule { }
