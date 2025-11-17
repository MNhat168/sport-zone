import { Body, Controller, Get, Param, Patch, Post, ParseEnumPipe, Inject, forwardRef } from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import { RefundRequestDto } from './dto/refund-request.dto';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';
import { WalletStatus, WalletRole } from './entities/wallet.entity';
import { PaymentHandlerService } from '../bookings/services/payment-handler.service';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => PaymentHandlerService))
    private readonly paymentHandlerService: PaymentHandlerService,
  ) {}

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

  // ===================================================================
  // V2 ENDPOINTS
  // ===================================================================

  /**
   * [V2] Get field owner wallet
   * Returns pendingBalance (money waiting for bank transfer)
   */
  @Get('field-owner/:userId')
  getFieldOwnerWallet(@Param('userId') userId: string) {
    return this.walletService.getFieldOwnerWallet(userId);
  }

  /**
   * [V2] Get user wallet
   * Returns refundBalance (credit available for booking)
   * Returns null if user has no wallet (99% case - lazy creation)
   */
  @Get('user/:userId')
  getUserWallet(@Param('userId') userId: string) {
    return this.walletService.getUserWallet(userId);
  }

  /**
   * [V2] Get admin wallet
   * Returns systemBalance (total money in system)
   * Admin only endpoint
   */
  @Get('admin/system')
  getAdminWallet() {
    return this.walletService.getAdminWallet();
  }

  /**
   * [V2] Process refund
   * Admin endpoint to refund booking
   * Supports bank and credit refund options
   */
  @Post('admin/refund')
  async processRefund(@Body() dto: RefundRequestDto) {
    await this.paymentHandlerService.handleRefund(
      dto.bookingId,
      dto.refundTo,
      dto.refundAmount,
      dto.reason,
    );
    return { success: true, message: 'Refund processed successfully' };
  }

  /**
   * [V2] Withdraw refund balance
   * User endpoint to withdraw their refundBalance to bank
   */
  @Post('user/:userId/withdraw')
  async withdrawRefund(
    @Param('userId') userId: string,
    @Body() dto: WithdrawRequestDto,
  ) {
    await this.paymentHandlerService.withdrawRefund(userId, dto.amount);
    return { success: true, message: 'Withdrawal processed successfully' };
  }
}

