import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { TransactionsController } from './transactions.controller';
import { TransactionsService } from './transactions.service';
import { PaymentCleanupService } from './payment-cleanup.service';
import { VNPayService } from './vnpay.service';
import { Transaction, TransactionSchema } from './entities/transaction.entity';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: Transaction.name, schema: TransactionSchema },
    ]),
  ],
  controllers: [TransactionsController],
  providers: [
    TransactionsService, 
    PaymentCleanupService, 
    VNPayService,
  ],
  exports: [TransactionsService, VNPayService], // Export để các module khác sử dụng
})
export class TransactionsModule {}
