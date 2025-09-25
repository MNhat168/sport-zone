import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { User, UserSchema } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { HttpModule } from '@nestjs/axios';
import { USER_REPOSITORY } from '../users/interface/users.interface';
import { UserRepository } from '../users/repositories/user.repository';
import { UsersService } from '../users/users.service';
@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    UsersModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        // Load keys either from PEM env or file paths
        const accessPrivPemEnv = process.env.JWT_ACCESS_TOKEN_PRIVATE_KEY;
        const accessPrivPath = process.env.JWT_ACCESS_TOKEN_PRIVATE_KEY_PATH;
        const accessPubPemEnv = process.env.JWT_ACCESS_TOKEN_PUBLIC_KEY;
        const accessPubPath = process.env.JWT_ACCESS_TOKEN_PUBLIC_KEY_PATH;

        const normalizePem = (val?: string) => val?.replace(/\\n/g, '\n');
        let privateKey: string | undefined = normalizePem(accessPrivPemEnv);
        let publicKey: string | undefined = normalizePem(accessPubPemEnv);

        if (!privateKey && accessPrivPath) {
          const fs = await import('fs');
          privateKey = fs.readFileSync(accessPrivPath, 'utf8');
        }
        if (!publicKey && accessPubPath) {
          const fs = await import('fs');
          publicKey = fs.readFileSync(accessPubPath, 'utf8');
        }

        return {
          privateKey,
          publicKey,
          signOptions: {
            algorithm: 'RS256',
            expiresIn: configService.get<string>('JWT_ACCESS_TOKEN_EXPIRATION_TIME'),
          },
        };
      },
      inject: [ConfigService],
    }),
    HttpModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, UserRepository, UsersService,{
    provide: USER_REPOSITORY,
    useClass: UserRepository,
  }],
  exports: [AuthService],
})
export class AuthModule {}
