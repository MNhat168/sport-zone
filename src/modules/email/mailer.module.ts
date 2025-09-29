import { MailerModule } from '@nestjs-modules/mailer';
import { HandlebarsAdapter } from '@nestjs-modules/mailer/dist/adapters/handlebars.adapter';
import { Module } from '@nestjs/common';
import * as path from 'path';

@Module({
    imports: [
        MailerModule.forRoot({
            transport: {
                host: process.env.MAIL_HOST,
                port: Number(process.env.MAIL_PORT),
                auth: {
                    user: process.env.MAIL_USER,
                    pass: process.env.MAIL_PASS,
                },
            },
            defaults: {
                from: '"SportZone Support" <support@sportzone.com>',
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
        }),
    ],
    exports: [MailerModule],
})
export class CustomMailerModule { }
