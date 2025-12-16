import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ScheduleModule } from '@nestjs/schedule';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { Invoice, InvoiceSchema } from './entities/invoice.entity';
import { User, UserSchema } from '../users/entities/user.entity';
import { PayOSService } from '../transactions/payos.service';
import { TransactionsModule } from '../transactions/transactions.module';

import { EmailModule } from '../email/email.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Invoice.name, schema: InvoiceSchema },
            { name: User.name, schema: UserSchema },
        ]),
        TransactionsModule,
        EmailModule,
        NotificationsModule,
        ScheduleModule.forRoot(),
    ],
    controllers: [BillingController],
    providers: [BillingService],
    exports: [BillingService],
})
export class BillingModule { }
