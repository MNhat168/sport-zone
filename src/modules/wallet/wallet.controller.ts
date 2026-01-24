import { Body, Controller, Get, Param, Patch, Post, ParseEnumPipe, Inject, forwardRef, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { WalletService } from './wallet.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { AdjustWalletBalanceDto } from './dto/adjust-wallet-balance.dto';
import { RefundRequestDto } from './dto/refund-request.dto';
import { WithdrawRequestDto } from './dto/withdraw-request.dto';
import { CreateWithdrawalRequestDto } from './dto/create-withdrawal-request.dto';
import { WithdrawalRequestDocument } from './entities/withdrawal-request.entity';
import { WalletStatus, WalletRole } from '@common/enums/wallet.enum';
import { PaymentHandlerService } from '../bookings/services/payment-handler.service';

@Controller('wallets')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    @Inject(forwardRef(() => PaymentHandlerService))
    private readonly paymentHandlerService: PaymentHandlerService,
  ) { }

  /**
   * Get wallet info for current authenticated user
   * - Field owners: returns pendingBalance via `getFieldOwnerWallet`
   * - Users: returns refundBalance via `getUserWallet` (may be null)
   * - Admins: returns systemBalance via `getAdminWallet`
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get wallet for current authenticated user' })
  @ApiResponse({ status: 200, description: 'Wallet info varies by role' })
  async getMyWallet(@Request() req) {
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    const role = req.user?.role || req.user?.roles || 'user';

    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    if (role === 'admin') {
      return this.walletService.getAdminWallet();
    }

    if (role === 'field_owner') {
      return this.walletService.getFieldOwnerWallet(userId);
    }

    // default: regular user
    return this.walletService.getUserWallet(userId);
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
   * [V2] Get field owner wallet for current authenticated user
   * Returns pendingBalance (money waiting for bank transfer)
   * Uses JWT token to get userId
   * NOTE: This route must be BEFORE /field-owner/:userId to avoid route conflict
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('field-owner')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get field owner wallet for current user' })
  @ApiResponse({ status: 200, description: 'Field owner wallet with pendingBalance' })
  async getCurrentFieldOwnerWallet(@Request() req) {
    const userId = req.user?.userId || req.user?._id || req.user?.id;

    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    return this.walletService.getFieldOwnerWallet(userId);
  }

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

  /**
   * [V2 NEW] Create withdrawal request for Field Owner or Coach
   * Creates a pending withdrawal request that requires admin approval
   * Requires authentication and field_owner or coach role
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('field-owner/withdraw')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create withdrawal request (requires admin approval)' })
  @ApiResponse({ status: 200, description: 'Withdrawal request created successfully' })
  async createWithdrawalRequest(
    @Request() req,
    @Body() dto: CreateWithdrawalRequestDto,
  ) {
    const userId = req.user?.userId || req.user?._id || req.user?.id;
    const role = req.user?.role || req.user?.roles || 'user';

    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    // Determine user role
    let userRole: 'field_owner' | 'coach';
    if (role === 'field_owner') {
      userRole = 'field_owner';
    } else if (role === 'coach') {
      userRole = 'coach';
    } else {
      throw new BadRequestException('Chỉ field-owner hoặc coach mới có thể tạo yêu cầu rút tiền');
    }

    const request = await this.paymentHandlerService.createWithdrawalRequest(
      userId,
      userRole,
      dto.amount,
      dto.bankAccount,
      dto.bankName,
    ) as WithdrawalRequestDocument;

    // Return minimal data, interceptor will wrap in { success: true, data: ... }
    // We can't easily return custom message + data structure with standard interceptor unless we use a custom decorator or response object
    // For now, let's return the data directly. If message is needed, we might need to adjust the interceptor or return type.
    // However, the frontend currently expects response.data.data.

    // To match current frontend expectations (which might look for message), we can stick to returning an object 
    // IF we disable the interceptor for this route OR if we accept double wrapping but handle it in FE.
    // BUT the best practice is consistent API.

    // Let's look at how other endpoints do it.
    // Most endpoints return the entity directly.

    // If I return JUST the object, the interceptor makes it { success: true, data: OBJECT }.
    // The frontend usage `response.data?.data` (thunk) will get OBJECT.

    // The previous code returned:
    // { success: true, message: '...', data: { ... } }
    // Interceptor wrapped it:
    // { success: true, data: { success: true, message: '...', data: { ... } } }

    // If I change it to return:
    // { requestId: ..., status: ..., ... }
    // Interceptor wraps:
    // { success: true, data: { requestId: ... } }

    // Frontend `withdrawFieldOwnerBalance` thunk expects:
    // return response.data?.data ?? ...
    // It returns response.data.data which is { requestId: ... }
    // AND it constructs a success message manually:
    // message: "Yêu cầu rút tiền đã được gửi, đang chờ admin duyệt"

    // So returning just the data object is safe for the thunk.

    return {
      requestId: (request._id as Types.ObjectId).toString(),
      status: request.status,
      amount: request.amount,
      createdAt: request.createdAt,
    };
  }

  /**
   * [V2 NEW] Get user's withdrawal requests
   * Returns list of withdrawal requests for the authenticated user
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('field-owner/withdrawal-requests')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get user withdrawal requests' })
  @ApiResponse({ status: 200, description: 'List of user withdrawal requests' })
  async getUserWithdrawalRequests(@Request() req) {
    const userId = req.user?.userId || req.user?._id || req.user?.id;

    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }

    const requests = await this.walletService.getUserWithdrawalRequests(userId);
    return requests;
  }

  /**
   * Lấy thông tin ví theo userId
   * NOTE: Must be defined after specific routes like 'field-owner', 'me', etc.
   */
  @Get(':userId')
  getWallet(@Param('userId') userId: string) {
    return this.walletService.getWalletByUserId(userId);
  }
}

