import { Module } from '@nestjs/common';
import { CustomMailerModule } from './mailer.module';
import { EmailService } from './email.service';
import { EmailQueueService } from './email-queue.service';

@Module({
  imports: [CustomMailerModule],
  providers: [EmailService, EmailQueueService],
  exports: [EmailService, EmailQueueService],
})
export class EmailModule {}
