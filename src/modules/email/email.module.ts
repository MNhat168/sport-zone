import { Module } from '@nestjs/common';
import { CustomMailerModule } from './mailer.module';
import { EmailService } from './email.service';

@Module({
	imports: [CustomMailerModule],
	providers: [EmailService],
	exports: [EmailService],
})
export class EmailModule {}
