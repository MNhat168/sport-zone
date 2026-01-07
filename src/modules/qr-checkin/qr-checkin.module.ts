import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QrCheckinService } from './qr-checkin.service';

@Module({
    imports: [
        ConfigModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (configService: ConfigService) => ({
                secret: configService.get<string>('QR_CHECKIN_SECRET') ||
                    configService.get<string>('JWT_SECRET'),
                signOptions: {
                    expiresIn: `${configService.get('QR_TOKEN_EXPIRY_MINUTES', '10')}m`,
                },
            }),
        }),
    ],
    providers: [QrCheckinService],
    exports: [QrCheckinService],
})
export class QrCheckinModule { }
