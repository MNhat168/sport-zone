import { Body, Controller, Get, Param, Patch, Post, ParseEnumPipe } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import { WalletStatus } from './entities/wallet.entity';

@Controller('wallets')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  /**
   * Lấy thông tin ví theo userId
   */
  @Get(':userId')
  getWallet(@Param('userId') userId: string) {
    return this.walletService.getWalletByUserId(userId);
  }

  /**
   * Khởi tạo ví cho user (nếu chưa có)
   */
  @Post(':userId/init')
  createWallet(@Param('userId') userId: string, @Body() dto: CreateWalletDto) {
    return this.walletService.createWalletForUser(userId, dto);
  }

  /**
   * Điều chỉnh số dư khả dụng của ví
   */
  @Post(':userId/adjust-balance')
  adjustBalance(@Param('userId') userId: string, @Body() dto: AdjustWalletBalanceDto) {
    return this.walletService.adjustAvailableBalance(userId, dto);
  }

  /**
   * Cập nhật trạng thái ví (active/suspended/closed)
   */
  @Patch(':userId/status/:status')
  updateStatus(
    @Param('userId') userId: string,
    @Param('status', new ParseEnumPipe(WalletStatus)) status: WalletStatus,
  ) {
    return this.walletService.updateWalletStatus(userId, status);
  }
}

