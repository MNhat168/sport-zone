import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Wallet, WalletSchema } from './entities/wallet.entity';
import { WithdrawalRequest, WithdrawalRequestSchema } from './entities/withdrawal-request.entity';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      {
        name: Wallet.name,
        schema: WalletSchema,
      },
      {
        name: WithdrawalRequest.name,
        schema: WithdrawalRequestSchema,
      },
    ]),
    // [V2] Import BookingsModule for PaymentHandlerService (circular dependency)
    forwardRef(() => import('../bookings/bookings.module').then(m => m.BookingsModule)),
  ],
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}

