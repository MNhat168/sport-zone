import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import * as path from 'path';

@Module({
    imports: [
        ConfigModule,
        MailerModule.forRootAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: (config: ConfigService) => {
                const host = config.get<string>('MAIL_HOST') || 'smtp.gmail.com';
                const port = Number(config.get<string>('MAIL_PORT') || 587);
                const user = config.get<string>('MAIL_USER');
                const pass = config.get<string>('MAIL_PASS');
                const from = config.get<string>('DEFAULT_MAIL_FROM') || '"SportZone" <no-reply@sportzone.com>';

                const secure = port === 465; // true for 465, false for 587

                return {
                    transport: {
                        host,
                        port,
                        secure,
                        auth: user && pass ? { user, pass } : undefined,
                        // Force IPv4 to avoid ::1 on Windows
                        family: 4,
                        // Ensure STARTTLS is attempted for 587
                        requireTLS: !secure,
                        tls: {
                            // In dev, avoid cert issues; in prod, consider removing
                            rejectUnauthorized: false,
                        },
                    },
                    defaults: {
                        from,
                    },
                    template: {
                        dir: path.join(
                            process.cwd(),
                            'src/templates',
                        ),
                        adapter: new HandlebarsAdapter(),
                        options: {
                            strict: true,
                        },
                    },
                };
            },
        }),
    ],
    exports: [MailerModule],
})
export class CustomMailerModule { }
