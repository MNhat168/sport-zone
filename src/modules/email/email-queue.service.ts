import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EmailService } from './email.service';

type EmailJob =
  | { type: 'VERIFY_EMAIL'; email: string; token: string }
  | { type: 'RESET_PASSWORD'; email: string; token: string };

@Injectable()
export class EmailQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly queue: EmailJob[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly emailService: EmailService) {}

  onModuleInit() {
    this.startWorker();
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  enqueue(job: EmailJob) {
    this.queue.push(job);
  }

  private startWorker() {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      const job = this.queue.shift();
      if (!job) return;

      try {
        switch (job.type) {
          case 'VERIFY_EMAIL':
            await this.emailService.sendEmailVerification(job.email, job.token);
            break;
          case 'RESET_PASSWORD':
            await this.emailService.sendResetPassword(job.email, job.token);
            break;
        }
      } catch (error) {
        // Không throw để tránh làm crash worker, chỉ log.
        console.error('Email job failed:', error);
      }
    }, 1000); // mỗi 1s xử lý tối đa 1 job
  }
}


