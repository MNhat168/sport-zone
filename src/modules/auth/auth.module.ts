import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, UserSchema } from '../users/entities/user.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';
import { CoachProfile, CoachProfileSchema } from '../coaches/entities/coach-profile.entity';
import { UsersModule } from '../users/users.module';
import { EmailModule } from '../email/email.module';
import { HttpModule } from '@nestjs/axios';
import { USER_REPOSITORY } from '../users/interface/users.interface';
import { UserRepository } from '../users/repositories/user.repository';
import { UsersService } from '../users/users.service';
import { ServiceModule } from '../../service/service.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';
@Module({
  imports: [
    PassportModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: 'FieldOwnerProfile', schema: FieldOwnerProfileSchema },
      { name: 'CoachProfile', schema: CoachProfileSchema }
    ]),
    UsersModule,
    EmailModule,
    ServiceModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        return {
          secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
          signOptions: {
            expiresIn: Number(configService.get('JWT_ACCESS_TOKEN_EXPIRATION_TIME')) || 3600,
          },
        };
      },
      inject: [ConfigService],
    }),
    HttpModule,
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtRefreshStrategy,
    UserRepository,
    UsersService,
    {
      provide: USER_REPOSITORY,
      useClass: UserRepository,
    }
  ],
  exports: [AuthService],
})
export class AuthModule { }
