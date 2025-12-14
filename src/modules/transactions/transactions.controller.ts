import { Controller, Get, Post, Body, Query, Param, Req, BadRequestException, NotFoundException, Delete, Patch, HttpCode, Res, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam, ApiBody, ApiBearerAuth } from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import * as crypto from 'crypto';
import * as qs from 'qs';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthGuard } from '@nestjs/passport';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';
import { PayOSService } from './payos.service';
import { CreateCoachVerificationDto } from './dto/coach-verification.dto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';
import {
    CreatePayOSUrlDto,
    PayOSCallbackDto,
    PayOSPaymentLinkResponseDto,
    PayOSTransactionQueryResponseDto,
    PayOSCancelResponseDto,
    CancelPayOSTransactionDto,
} from './dto/payos.dto';
import { Inject, forwardRef } from '@nestjs/common';
import { FieldOwnerService } from '../field-owner/field-owner.service';
import { Response } from 'express';
import { CleanupService } from '../../service/cleanup.service';

@ApiTags('Transactions')
@Controller('transactions')
export class TransactionsController {

  constructor(
        private readonly transactionsService: TransactionsService,
        private readonly cleanupService: CleanupService,
        private readonly payosService: PayOSService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
        @Inject(forwardRef(() => FieldOwnerService))
        private readonly fieldOwnerService: FieldOwnerService,
        @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
    ) { }

    /**
     * Tạo transaction xác thực tài khoản ngân hàng cho coach (10k)
     */
    @Post('coach-verification')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Coach - tạo transaction xác thực tài khoản ngân hàng (10k)' })
    @ApiResponse({ status: 201, description: 'Tạo transaction thành công' })
    async createCoachVerification(
      @Req() req: Request & { user?: any },
      @Body() dto: CreateCoachVerificationDto,
    ) {
      const coachUserId = (req as any).user?.userId || (req as any).user?._id;
      if (!coachUserId) throw new BadRequestException('Missing user');

      const profile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(coachUserId) }).lean();
      if (!profile) throw new NotFoundException('Coach profile not found');

      const tx = await this.transactionsService.createCoachBankVerificationTransaction({
        coachUserId: String(coachUserId),
        coachProfileId: String(profile._id),
        bankAccountNumber: dto.bankAccountNumber,
        bankName: dto.bankName,
        method: dto.method,
        amount: dto.amount,
      });

      // Trả về transactionId để FE gọi create-vnpay-url / tạo link thanh toán
      return {
        transactionId: (tx._id as any).toString(),
        amount: tx.amount,
        method: tx.method,
        metadata: tx.metadata,
        note: 'Dùng transactionId này để tạo link thanh toán (VD: GET /transactions/create-vnpay-url?amount=10000&orderId=<transactionId>)'
      };
    }

    /**
     * VNPay IPN (Instant Payment Notification) - Server-to-Server callback
     * CRITICAL: This endpoint must be configured in VNPay merchant portal
     * URL: https://your-domain.com/api/payments/vnpay-ipn
     * Improved version using VNPayService
     */
    @Get('vnpay-ipn')
    @ApiOperation({
        summary: 'VNPay IPN callback (Internal)',
        description: 'Server-to-server callback from VNPay. Must be configured in VNPay portal. Uses official VNPay implementation.'
    })
    @ApiResponse({ status: 200, description: 'IPN processed successfully', type: VNPayIPNResponseDto })
    async handleVNPayCallback(@Query() query: any): Promise<VNPayIPNResponseDto> {
        try {
            // Step 1: Verify signature using VNPayService
            const verificationResult = this.vnpayService.verifyCallback(query);

            if (!verificationResult.isValid) {
                console.error('[VNPay IPN] ❌ Invalid signature');
                return { RspCode: '97', Message: 'Invalid signature' };
            }

            const { orderId, responseCode, transactionNo, bankTranNo, bankCode, cardType, payDate, amount } = verificationResult.data;

            console.log('[VNPay IPN] ✅ Signature valid');
            console.log('[VNPay IPN] Processing payment:', { orderId, responseCode, transactionNo });

            // Step 2: Find payment
            if (!orderId) {
                console.warn('[VNPay IPN] ⚠️ Missing orderId, acknowledging');
                return { RspCode: '00', Message: 'No orderId, acknowledged' };
            }

            // Try to find payment by ID or booking ID
            let payment = await this.transactionsService.getPaymentById(orderId);
            if (!payment) {
                payment = await this.transactionsService.getPaymentByBookingId(orderId);
            }

            if (!payment) {
                console.warn('[VNPay IPN] ⚠️ Payment not found:', orderId);
                return { RspCode: '01', Message: 'Order not found' };
            }

            // Step 3: Check idempotency
            if (payment.status === TransactionStatus.SUCCEEDED || payment.status === TransactionStatus.FAILED) {
                console.log('[VNPay IPN] ℹ️ Payment already processed:', payment.status);
                return { RspCode: '02', Message: 'Order already confirmed' };
            }

            // Step 4: Process payment based on response code
            // Note: VNPay transaction IDs are stored in vnpayTransactionNo/externalTransactionId

            if (responseCode === '00') {
                // Payment successful
                const vnpayData = {
                    vnp_TransactionNo: transactionNo,
                    vnp_BankTranNo: bankTranNo,
                    vnp_BankCode: bankCode,
                    vnp_CardType: cardType,
                    vnp_ResponseCode: responseCode,
                    vnp_PayDate: payDate,
                };

                const updated = await this.transactionsService.updatePaymentStatus(
                    (payment._id as any).toString(),
                    TransactionStatus.SUCCEEDED,
                    undefined,
                    vnpayData,
                );

                // Emit success event - Ensure all IDs are strings
                const bookingIdStr = updated.booking 
                    ? (typeof updated.booking === 'string' 
                        ? updated.booking 
                        : (updated.booking as any)?._id 
                            ? String((updated.booking as any)._id)
                            : String(updated.booking))
                    : undefined;
                
                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                this.eventEmitter.emit('payment.success', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStr,
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: updated.externalTransactionId || updated.vnpayTransactionNo || undefined,
                });

                console.log('[VNPay IPN] ✅ Payment succeeded:', orderId);
                return { RspCode: '00', Message: 'Confirm Success' };
            } else {
                // Payment failed
                const vnpayData = {
                    vnp_TransactionNo: transactionNo,
                    vnp_BankTranNo: bankTranNo,
                    vnp_BankCode: bankCode,
                    vnp_CardType: cardType,
                    vnp_ResponseCode: responseCode,
                    vnp_PayDate: payDate,
                };

                const updated = await this.transactionsService.updatePaymentStatus(
                    (payment._id as any).toString(),
                    TransactionStatus.FAILED,
                    undefined,
                    vnpayData,
                );

                // Emit failed event - Ensure all IDs are strings
                const bookingIdStrFailed = updated.booking 
                    ? (typeof updated.booking === 'string' 
                        ? updated.booking 
                        : (updated.booking as any)?._id 
                            ? String((updated.booking as any)._id)
                            : String(updated.booking))
                    : undefined;
                
                const userIdStrFailed = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                const description = this.vnpayService.getResponseDescription(responseCode);
                this.eventEmitter.emit('payment.failed', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStrFailed,
                    userId: userIdStrFailed,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: updated.externalTransactionId || updated.vnpayTransactionNo || undefined,
                    reason: `VNPay ${responseCode}: ${description}`,
                });

                console.log('[VNPay IPN] ❌ Payment failed:', orderId, responseCode);
                return { RspCode: '00', Message: 'Confirm Success' };
            }
        } catch (error) {
            console.error('[VNPay IPN] ❌ Error processing callback:', error);
            // Always acknowledge to VNPay to prevent retries
            return { RspCode: '00', Message: 'Processed with internal error' };
        }
    }

    /**
     * Verify VNPay return from frontend
     * Called by frontend after user is redirected from VNPay
     * This provides immediate feedback while waiting for IPN
     */
    @Get('verify-vnpay')
    @ApiOperation({
        summary: 'Xác minh thanh toán VNPay',
        description: 'Verify VNPay payment from frontend redirect. Use this to update UI immediately.'
    })
    @ApiQuery({ name: 'vnp_SecureHash', description: 'VNPay secure hash' })
    @ApiQuery({ name: 'vnp_TxnRef', description: 'Order ID (booking ID)' })
    @ApiQuery({ name: 'vnp_ResponseCode', description: 'Response code from VNPay' })
    @ApiResponse({
        status: 200,
        description: 'Payment verified successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                paymentStatus: { type: 'string', enum: ['succeeded', 'failed'] },
                bookingId: { type: 'string' },
                message: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid signature or missing parameters' })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    async verifyVNPayReturn(@Query() query: any) {
        console.log('[Verify VNPay] Received query params:', Object.keys(query));
        
        const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
        if (!vnp_HashSecret) {
            console.error('[Verify VNPay] ❌ Missing vnp_HashSecret in configuration');
            throw new BadRequestException('Payment configuration error: Missing vnp_HashSecret');
        }

        // Trim whitespace from hash secret
        const hashSecret = vnp_HashSecret.trim();

        const vnp_SecureHash = query.vnp_SecureHash;
        if (!vnp_SecureHash) {
            console.error('[Verify VNPay] ❌ Missing vnp_SecureHash in query params');
            throw new BadRequestException('Missing vnp_SecureHash parameter');
        }

        const queryWithoutHash = { ...query };
        delete queryWithoutHash.vnp_SecureHash;
        delete queryWithoutHash.vnp_SecureHashType;

        // CRITICAL: VNPay uses sortObject then qs.stringify with encode: false
        // We need to match vnpay_nodejs/routes/order.js vnpay_return handler EXACTLY
        // Step 1: Use sortObject to encode keys and values like VNPay does
        const sorted = sortObject(queryWithoutHash);
        
        console.log('[Verify VNPay] Sorted params (first 200 chars):', JSON.stringify(sorted).substring(0, 200));
        
        // Step 2: Use qs.stringify with encode: false (same as VNPay)
        const signData = qs.stringify(sorted, { encode: false });
        
        console.log('[Verify VNPay] Sign data (full):', signData);
        console.log('[Verify VNPay] Sign data length:', signData.length);
        
        const hmac = crypto.createHmac('sha512', hashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

        console.log('[Verify VNPay] Signature check:', {
            received: vnp_SecureHash.substring(0, 20) + '...',
            calculated: signed.substring(0, 20) + '...',
            match: signed === vnp_SecureHash,
            receivedFull: vnp_SecureHash,
            calculatedFull: signed
        });

        if (signed !== vnp_SecureHash) {
            console.error('[Verify VNPay] ❌ Invalid signature');
            console.error('[Verify VNPay] Hash secret length:', hashSecret.length);
            console.error('[Verify VNPay] Hash secret preview:', hashSecret.substring(0, 10) + '...');
            console.error('[Verify VNPay] Sign data:', signData);
            throw new BadRequestException('Invalid signature. Please check VNPay parameters.');
        }

        const responseCode: string | undefined = query.vnp_ResponseCode;
        const orderId: string | undefined = query.vnp_TxnRef;
        // Note: VNPay transaction IDs are stored in vnpayTransactionNo/externalTransactionId
        const vnpayTransactionId: string | undefined = query.vnp_TransactionNo || query.vnp_BankTranNo;

        console.log('[Verify VNPay] Extracted params:', {
            responseCode,
            orderId,
            vnpayTransactionId,
            hasAllParams: !!(responseCode !== undefined && orderId)
        });

        if (!orderId) {
            console.error('[Verify VNPay] ❌ Missing vnp_TxnRef (orderId) in query params');
            throw new BadRequestException('Missing order ID (vnp_TxnRef). Please ensure VNPay redirect includes this parameter.');
        }

        // Get payment
        let payment = await this.transactionsService.getPaymentById(orderId);
        if (!payment) {
            payment = await this.transactionsService.getPaymentByBookingId(orderId);
        }

        if (!payment) {
            throw new NotFoundException('Payment not found');
        }

        // Check if already processed (by IPN)
        if (payment.status !== TransactionStatus.PENDING) {
            console.log('[Verify VNPay] Payment already processed by IPN:', payment.status);
            // Convert to string to ensure comparison works correctly
            const paymentStatusStr = String(payment.status);
            const isSucceeded = paymentStatusStr === TransactionStatus.SUCCEEDED ||
                                 paymentStatusStr === 'succeeded';
            
            console.log('[Verify VNPay] Status check:', {
                paymentStatus: paymentStatusStr,
                isSucceeded,
                enumSucceeded: TransactionStatus.SUCCEEDED
            });
            
            // Ensure bookingId is a string
            const bookingIdStr = payment.booking 
                ? (typeof payment.booking === 'string' 
                    ? payment.booking 
                    : (payment.booking as any)?._id 
                        ? String((payment.booking as any)._id)
                        : String(payment.booking))
                : undefined;
            
            return {
                success: isSucceeded,
                paymentStatus: payment.status,
                bookingId: bookingIdStr || String(payment.booking),
                message: 'Payment already processed'
            };
        }

        // Update payment status if still pending
        if (responseCode === '00') {
            // Payment success - extract VNPay data
            const vnpayData = {
                vnp_TransactionNo: query.vnp_TransactionNo,
                vnp_BankTranNo: query.vnp_BankTranNo,
                vnp_BankCode: query.vnp_BankCode,
                vnp_CardType: query.vnp_CardType,
                vnp_ResponseCode: query.vnp_ResponseCode,
                vnp_TransactionStatus: query.vnp_TransactionStatus,
            };

            const updated = await this.transactionsService.updatePaymentStatus(
                (payment._id as any).toString(),
                TransactionStatus.SUCCEEDED,
                undefined,
                vnpayData,
            );

            console.log('[Verify VNPay] ✅ Payment succeeded');

            // Emit success event - Ensure all IDs are strings
            const bookingIdStr = updated.booking 
                ? (typeof updated.booking === 'string' 
                    ? updated.booking 
                    : (updated.booking as any)?._id 
                        ? String((updated.booking as any)._id)
                        : String(updated.booking))
                : undefined;
            
            const userIdStr = updated.user
                ? (typeof updated.user === 'string'
                    ? updated.user
                    : (updated.user as any)?._id
                        ? String((updated.user as any)._id)
                        : String(updated.user))
                : undefined;

            this.eventEmitter.emit('payment.success', {
                paymentId: String(updated._id),
                bookingId: bookingIdStr,
                userId: userIdStr,
                amount: updated.amount,
                method: updated.method,
                transactionId: updated.externalTransactionId || updated.vnpayTransactionNo || undefined,
            });

            // Ensure bookingId is a string
            const bookingIdSuccessStr = updated.booking 
                ? (typeof updated.booking === 'string' 
                    ? updated.booking 
                    : (updated.booking as any)?._id 
                        ? String((updated.booking as any)._id)
                        : String(updated.booking))
                : undefined;

            console.log('[Verify VNPay] Response data:', {
                success: true,
                paymentStatus: 'succeeded',
                bookingId: bookingIdSuccessStr,
                bookingIdType: typeof bookingIdSuccessStr,
                originalBooking: updated.booking
            });

            return {
                success: true,
                paymentStatus: 'succeeded',
                bookingId: bookingIdSuccessStr || String(updated.booking),
                message: 'Payment successful'
            };
        } else {
            // Payment failed - get error description and extract VNPay data
            const errorDescription = this.transactionsService.getVNPayErrorDescription(responseCode || '99');
            
            const vnpayData = {
                vnp_TransactionNo: query.vnp_TransactionNo,
                vnp_BankTranNo: query.vnp_BankTranNo,
                vnp_BankCode: query.vnp_BankCode,
                vnp_CardType: query.vnp_CardType,
                vnp_ResponseCode: query.vnp_ResponseCode,
                vnp_TransactionStatus: query.vnp_TransactionStatus,
            };

            const updated = await this.transactionsService.updatePaymentStatus(
                (payment._id as any).toString(),
                TransactionStatus.FAILED,
                undefined,
                vnpayData,
            );

            console.log('[Verify VNPay] ⚠️ Payment failed:', responseCode, errorDescription);

            // Log payment error for tracking
            await this.transactionsService.logPaymentError(
                (updated._id as any).toString(),
                responseCode || '99',
                errorDescription,
                {
                    transactionId: vnpayTransactionId,
                    vnpayParams: {
                        vnp_TxnRef: orderId,
                        vnp_ResponseCode: responseCode,
                        vnp_TransactionStatus: query.vnp_TransactionStatus,
                    }
                }
            );

            // Emit failed event - Ensure all IDs are strings
            const bookingIdStrFailed2 = updated.booking 
                ? (typeof updated.booking === 'string' 
                    ? updated.booking 
                    : (updated.booking as any)?._id 
                        ? String((updated.booking as any)._id)
                        : String(updated.booking))
                : undefined;
            
            const userIdStrFailed2 = updated.user
                ? (typeof updated.user === 'string'
                    ? updated.user
                    : (updated.user as any)?._id
                        ? String((updated.user as any)._id)
                        : String(updated.user))
                : undefined;

            this.eventEmitter.emit('payment.failed', {
                paymentId: String(updated._id),
                bookingId: bookingIdStrFailed2,
                userId: userIdStrFailed2,
                amount: updated.amount,
                method: updated.method,
                transactionId: updated.externalTransactionId || updated.vnpayTransactionNo || undefined,
                reason: `VNPay response ${responseCode}: ${errorDescription}`,
            });

            return {
                success: false,
                paymentStatus: 'failed',
                bookingId: updated.booking,
                reason: errorDescription,
                message: 'Payment failed'
            };
        }
    }

    /**
     * Query transaction status from VNPay
     * Based on vnpay_nodejs querydr endpoint
     * Use this to check transaction status directly from VNPay
     */
    @Post('vnpay-query-transaction')
    @ApiOperation({
        summary: 'Query transaction từ VNPay',
        description: 'Query transaction status directly from VNPay API. Useful for checking payment status.'
    })
    @ApiBody({ type: QueryTransactionDto })
    @ApiResponse({ status: 200, description: 'Transaction query result' })
    async queryVNPayTransaction(
        @Body() dto: QueryTransactionDto,
        @Req() req: Request,
    ) {
        // Extract IP address
        const forwarded = req.headers['x-forwarded-for'];
        let ipAddr: string = (typeof req.ip === 'string' && req.ip.length > 0)
            ? req.ip
            : (req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : '0.0.0.0');
        if (Array.isArray(forwarded)) {
            if (forwarded.length > 0 && typeof forwarded[0] === 'string') {
                ipAddr = forwarded[0];
            }
        } else if (typeof forwarded === 'string' && forwarded.length > 0) {
            ipAddr = forwarded;
        }

        if (ipAddr.startsWith('::ffff:')) {
            ipAddr = ipAddr.substring(7);
        }

        try {
            const result = await this.vnpayService.queryTransaction(dto, ipAddr);
            return {
                success: true,
                data: result,
            };
        } catch (error) {
            throw new BadRequestException(error.message || 'Failed to query transaction');
        }
    }

    /**
     * Process refund via VNPay API
     * Based on vnpay_nodejs refund endpoint
     * Calls VNPay API to process refund transaction
     */
    @Post('vnpay-refund')
    @ApiOperation({
        summary: 'Hoàn tiền qua VNPay API',
        description: 'Process refund transaction via VNPay API. Requires admin authorization.'
    })
    @ApiBody({ type: RefundTransactionDto })
    @ApiResponse({ status: 200, description: 'Refund processed successfully' })
    async processVNPayRefund(
        @Body() dto: RefundTransactionDto,
        @Req() req: Request,
    ) {
        // Extract IP address
        const forwarded = req.headers['x-forwarded-for'];
        let ipAddr: string = (typeof req.ip === 'string' && req.ip.length > 0)
            ? req.ip
            : (req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : '0.0.0.0');
        if (Array.isArray(forwarded)) {
            if (forwarded.length > 0 && typeof forwarded[0] === 'string') {
                ipAddr = forwarded[0];
            }
        } else if (typeof forwarded === 'string' && forwarded.length > 0) {
            ipAddr = forwarded;
        }

        if (ipAddr.startsWith('::ffff:')) {
            ipAddr = ipAddr.substring(7);
        }

        try {
            // Call VNPay API to process refund
            const vnpayResult = await this.vnpayService.processRefund(dto, ipAddr);

            // If VNPay refund successful, update local payment status
            if (vnpayResult.vnp_ResponseCode === '00') {
                // Find the payment
                let payment = await this.transactionsService.getPaymentById(dto.orderId);
                if (!payment) {
                    payment = await this.transactionsService.getPaymentByBookingId(dto.orderId);
                }

                if (payment) {
                    // Process refund in local system
                    const refundResult = await this.transactionsService.processRefund(
                        (payment._id as any).toString(),
                        dto.amount,
                        dto.reason || 'VNPay API refund',
                        `VNPay refund processed. Response: ${vnpayResult.vnp_Message}`,
                        dto.createdBy,
                    );

                    return {
                        success: true,
                        message: 'Refund processed successfully',
                        vnpayResponse: vnpayResult,
                        localRefund: refundResult,
                    };
                }
            }

            return {
                success: vnpayResult.vnp_ResponseCode === '00',
                message: vnpayResult.vnp_Message,
                vnpayResponse: vnpayResult,
            };
        } catch (error) {
            throw new BadRequestException(error.message || 'Failed to process refund');
        }
    }

    /**
     * Create VNPay QR Code payment URL
     * For QR code payment, we use the same VNPay URL but frontend will display it as QR
     */
    @Post('create-vnpay-qr')
    @ApiOperation({
        summary: 'Tạo mã QR thanh toán VNPay',
        description: 'Generate VNPay payment URL for QR code display'
    })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string', description: 'Payment ID', example: '6904dd2a6289f3cf36b1dbe3' },
                amount: { type: 'number', description: 'Số tiền thanh toán (VND)', example: 200000 }
            },
            required: ['paymentId', 'amount']
        }
    })
    @ApiResponse({
        status: 200,
        description: 'QR code data được tạo thành công',
        schema: {
            type: 'object',
            properties: {
                qrCodeUrl: { type: 'string', description: 'VNPay payment URL for QR display' },
                qrDataUrl: { type: 'string', description: 'Data URL for QR code image (optional)' },
                paymentId: { type: 'string', description: 'Payment ID' },
                amount: { type: 'number', description: 'Payment amount' },
                expiresAt: { type: 'string', description: 'QR expiration time (ISO 8601)' },
                expiresIn: { type: 'number', description: 'Seconds until expiration' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid paymentId or amount' })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    async createVNPayQRCode(
        @Body() body: { paymentId: string; amount: number },
        @Req() req: Request
    ) {
        const { paymentId, amount } = body;

        if (!paymentId || !amount || amount <= 0) {
            throw new BadRequestException('Invalid paymentId or amount');
        }

        // Verify payment exists
        const payment = await this.transactionsService.getPaymentById(paymentId);
        if (!payment) {
            throw new NotFoundException('Payment not found');
        }

        // Get IP address
        const forwarded = req.headers['x-forwarded-for'];
        let ipAddr: string = (typeof req.ip === 'string' && req.ip.length > 0)
            ? req.ip
            : (req.socket && typeof req.socket.remoteAddress === 'string' ? req.socket.remoteAddress : '0.0.0.0');
        if (Array.isArray(forwarded)) {
            if (forwarded.length > 0 && typeof forwarded[0] === 'string') {
                ipAddr = forwarded[0];
            }
        } else if (typeof forwarded === 'string' && forwarded.length > 0) {
            ipAddr = forwarded;
        }

        // Create VNPay URL (same as regular payment)
        const qrCodeUrl = this.transactionsService.createVNPayUrl(amount, paymentId, ipAddr);

        // Calculate expiration (15 minutes from now)
        const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
        const expiresIn = 15 * 60; // 900 seconds

        return {
            qrCodeUrl,
            qrDataUrl: qrCodeUrl, // Frontend can generate QR from this URL
            paymentId,
            amount,
            expiresAt: expiresAt.toISOString(),
            expiresIn
        };
    }

    /**
     * Get payment status by ID
     * Used for polling payment status during QR code payment
     */
    @Get(':paymentId/status')
    @ApiOperation({
        summary: 'Lấy trạng thái thanh toán',
        description: 'Get current payment status for polling during QR payment'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID', example: '6904dd2a6289f3cf36b1dbe3' })
    @ApiResponse({
        status: 200,
        description: 'Payment status retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                status: { type: 'string', enum: ['pending', 'succeeded', 'failed', 'refunded'] },
                bookingId: { type: 'string' },
                amount: { type: 'number' },
                transactionId: { type: 'string' },
                createdAt: { type: 'string' },
                updatedAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    async getPaymentStatus(@Param('paymentId') paymentId: string) {
        const payment = await this.transactionsService.getPaymentById(paymentId);
        
        if (!payment) {
            throw new NotFoundException('Payment not found');
        }

        return {
            paymentId: (payment._id as any).toString(),
            status: payment.status,
            bookingId: (payment.booking as any)?.toString?.() || payment.booking,
            amount: payment.amount,
            transactionId: payment.externalTransactionId || payment.vnpayTransactionNo || null,
            createdAt: payment.createdAt,
            updatedAt: payment.updatedAt
        };
    }

    /**
     * Cancel a payment manually
     * Used when user wants to cancel payment before it completes
     */
    @Delete(':paymentId/cancel')
    @ApiOperation({
        summary: 'Hủy thanh toán',
        description: 'Manually cancel a pending payment'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to cancel' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                reason: { 
                    type: 'string', 
                    description: 'Reason for cancellation',
                    example: 'User cancelled payment'
                }
            }
        }
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Payment cancelled successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Payment cannot be cancelled' })
    async cancelPayment(
        @Param('paymentId') paymentId: string,
        @Body('reason') reason?: string
    ) {
        try {
            await this.cleanupService.cancelPaymentManually(
                paymentId,
                reason || 'User cancelled payment'
            );

            return {
                success: true,
                message: 'Payment cancelled successfully',
                paymentId
            };
        } catch (error) {
            if (error.message.includes('not found')) {
                throw new NotFoundException(error.message);
            }
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Get remaining time for a payment
     * Used by frontend to show countdown timer
     */
    @Get(':paymentId/remaining-time')
    @ApiOperation({
        summary: 'Lấy thời gian còn lại của thanh toán',
        description: 'Get remaining time before payment expires'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({ 
        status: 200, 
        description: 'Remaining time retrieved',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                remainingSeconds: { type: 'number', description: 'Seconds until expiration' },
                isExpiringSoon: { type: 'boolean', description: 'True if less than 2 minutes left' },
                expiresAt: { type: 'string', description: 'ISO timestamp of expiration' }
            }
        }
    })
    async getPaymentRemainingTime(@Param('paymentId') paymentId: string) {
        const remainingSeconds = await this.cleanupService.getPaymentRemainingTime(paymentId);
        const isExpiringSoon = await this.cleanupService.isPaymentExpiringSoon(paymentId);
        const expiresAt = await this.cleanupService.getEffectiveExpirationTime(paymentId);

        return {
            paymentId,
            remainingSeconds,
            isExpiringSoon,
            expiresAt: expiresAt?.toISOString() || null
        };
    }

    /**
     * Extend payment expiration time
     * Allows user to get more time to complete payment
     */
    @Patch(':paymentId/extend')
    @ApiOperation({
        summary: 'Gia hạn thời gian thanh toán',
        description: 'Extend payment expiration time by 5 minutes (max 2 extensions)'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to extend' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                additionalMinutes: { 
                    type: 'number', 
                    description: 'Additional minutes to add (default: 5)',
                    example: 5,
                    minimum: 1,
                    maximum: 10
                }
            }
        },
        required: false
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Payment time extended successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' },
                additionalMinutes: { type: 'number' },
                newExpiresAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Cannot extend payment (max extensions reached or not pending)' })
    async extendPaymentTime(
        @Param('paymentId') paymentId: string,
        @Body('additionalMinutes') additionalMinutes?: number
    ) {
        try {
            const minutes = additionalMinutes && additionalMinutes > 0 && additionalMinutes <= 10 
                ? additionalMinutes 
                : 5;

            await this.cleanupService.extendPaymentTime(paymentId, minutes);
            
            const newExpiresAt = await this.cleanupService.getEffectiveExpirationTime(paymentId);

            return {
                success: true,
                message: `Payment time extended by ${minutes} minutes`,
                paymentId,
                additionalMinutes: minutes,
                newExpiresAt: newExpiresAt?.toISOString() || null
            };
        } catch (error) {
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Refund a payment
     * Process refund for a successful payment
     */
    @Post(':paymentId/refund')
    @ApiOperation({
        summary: 'Hoàn tiền thanh toán',
        description: 'Process refund for a successful payment. Can be full or partial refund.'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID to refund' })
    @ApiBody({
        schema: {
            type: 'object',
            properties: {
                amount: { 
                    type: 'number', 
                    description: 'Refund amount (VND). If not provided, full refund.',
                    example: 200000,
                    minimum: 1
                },
                reason: { 
                    type: 'string', 
                    description: 'Reason for refund',
                    example: 'Customer request'
                },
                refundNote: {
                    type: 'string',
                    description: 'Additional notes for refund',
                    example: 'Refund processed by admin'
                }
            },
            required: ['reason']
        }
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Refund processed successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean' },
                message: { type: 'string' },
                paymentId: { type: 'string' },
                refundAmount: { type: 'number' },
                originalAmount: { type: 'number' },
                transactionId: { type: 'string' },
                refundedAt: { type: 'string' }
            }
        }
    })
    @ApiResponse({ status: 404, description: 'Payment not found' })
    @ApiResponse({ status: 400, description: 'Payment cannot be refunded (not succeeded or already refunded)' })
    async refundPayment(
        @Param('paymentId') paymentId: string,
        @Body() body: { amount?: number; reason: string; refundNote?: string }
    ) {
        try {
            const result = await this.transactionsService.processRefund(
                paymentId,
                body.amount,
                body.reason,
                body.refundNote
            );

            // Emit refund event
            this.eventEmitter.emit('payment.refunded', {
                paymentId: result.paymentId,
                bookingId: result.bookingId,
                refundAmount: result.refundAmount,
                originalAmount: result.originalAmount,
                reason: body.reason,
                refundPaymentId: result.refundPaymentId,
            });

            return {
                success: true,
                message: 'Refund processed successfully',
                paymentId: result.paymentId,
                refundAmount: result.refundAmount,
                originalAmount: result.originalAmount,
                refundPaymentId: result.refundPaymentId,
                refundedAt: result.refundedAt
            };
        } catch (error) {
            if (error instanceof NotFoundException) {
                throw error;
            }
            throw new BadRequestException(error.message);
        }
    }

    /**
     * Get transaction history for a user
     * Returns detailed transaction records with VNPay data, refunds, etc.
     */
    @Get('transactions/history/:userId')
    @ApiOperation({
        summary: 'Lịch sử giao dịch chi tiết của user',
        description: 'Get detailed transaction history including VNPay data, refunds, and full audit trail'
    })
    @ApiParam({ name: 'userId', description: 'User ID' })
    @ApiQuery({ 
        name: 'type', 
        description: 'Filter by transaction type',
        required: false,
        enum: ['payment', 'refund_full', 'refund_partial', 'reversal', 'adjustment']
    })
    @ApiQuery({ 
        name: 'status', 
        description: 'Filter by transaction status',
        required: false,
        enum: ['pending', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded']
    })
    @ApiQuery({ 
        name: 'startDate', 
        description: 'Start date (ISO format)',
        required: false,
        example: '2025-01-01T00:00:00Z'
    })
    @ApiQuery({ 
        name: 'endDate', 
        description: 'End date (ISO format)',
        required: false,
        example: '2025-12-31T23:59:59Z'
    })
    @ApiQuery({ 
        name: 'limit', 
        description: 'Number of records to return',
        required: false,
        example: 20
    })
    @ApiQuery({ 
        name: 'offset', 
        description: 'Number of records to skip',
        required: false,
        example: 0
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Transaction history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                transactions: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            _id: { type: 'string' },
                            payment: { type: 'object' },
                            booking: { type: 'object' },
                            userId: { type: 'string' },
                            type: { type: 'string' },
                            status: { type: 'string' },
                            amount: { type: 'number' },
                            method: { type: 'string' },
                            vnpayTransactionNo: { type: 'string' },
                            vnpayBankCode: { type: 'string' },
                            vnpayCardType: { type: 'string' },
                            relatedTransaction: { type: 'string' },
                            refundReason: { type: 'string' },
                            createdAt: { type: 'string' },
                            completedAt: { type: 'string' }
                        }
                    }
                },
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid query parameters' })
    async getTransactionHistory(
        @Param('userId') userId: string,
        @Query('type') type?: string,
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ) {
        const limitNum = limit && limit > 0 ? Math.min(limit, 100) : 20;
        const offsetNum = offset && offset >= 0 ? offset : 0;

        const options: any = {
            limit: limitNum,
            skip: offsetNum
        };

        if (type) options.type = type;
        if (status) options.status = status;
        if (startDate) options.startDate = new Date(startDate);
        if (endDate) options.endDate = new Date(endDate);

        const result = await this.transactionsService.getTransactionHistory(
            userId,
            options
        );

        return result;
    }

    /**
     * Get transaction details by ID
     */
    @Get('transactions/:transactionId')
    @ApiOperation({
        summary: 'Chi tiết giao dịch',
        description: 'Get detailed information about a specific transaction'
    })
    @ApiParam({ name: 'transactionId', description: 'Transaction ID' })
    @ApiResponse({ 
        status: 200, 
        description: 'Transaction details retrieved successfully'
    })
    @ApiResponse({ status: 404, description: 'Transaction not found' })
    async getTransactionById(@Param('transactionId') transactionId: string) {
        const transaction = await this.transactionsService.getTransactionById(transactionId);
        
        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        return transaction;
    }

    /**
     * Get transaction by booking ID
     */
    @Get('booking/:bookingId')
    @ApiOperation({
        summary: 'Lấy transaction theo booking ID',
        description: 'Get transaction by booking ID'
    })
    @ApiParam({ name: 'bookingId', description: 'Booking ID' })
    @ApiResponse({
        status: 200,
        description: 'Transaction retrieved successfully'
    })
    @ApiResponse({ status: 404, description: 'Transaction not found' })
    async getTransactionByBookingId(@Param('bookingId') bookingId: string) {
        const transaction = await this.transactionsService.getPaymentByBookingId(bookingId);
        
        if (!transaction) {
            throw new NotFoundException('Transaction not found for this booking');
        }

        return transaction;
    }

    /**
     * Get all transactions for a payment
     */
    @Get('transactions/payment/:paymentId')
    @ApiOperation({
        summary: 'Tất cả giao dịch của một payment',
        description: 'Get all transaction records related to a payment (including refunds)'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({ 
        status: 200, 
        description: 'Payment transactions retrieved successfully'
    })
    async getPaymentTransactions(@Param('paymentId') paymentId: string) {
        const transactions = await this.transactionsService.getPaymentTransactions(paymentId);
        
        return {
            paymentId,
            transactions,
            count: transactions.length
        };
    }

    /**
     * Get refund statistics for a payment
     */
    @Get('transactions/payment/:paymentId/refund-stats')
    @ApiOperation({
        summary: 'Thống kê refund của payment',
        description: 'Get refund statistics including total refunded and refund count'
    })
    @ApiParam({ name: 'paymentId', description: 'Payment ID' })
    @ApiResponse({ 
        status: 200, 
        description: 'Refund stats retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                paymentId: { type: 'string' },
                totalRefunded: { type: 'number' },
                refundCount: { type: 'number' },
                originalAmount: { type: 'number' },
                remainingAmount: { type: 'number' }
            }
        }
    })
    async getRefundStats(@Param('paymentId') paymentId: string) {
        const stats = await this.transactionsService.getRefundStats(paymentId);
        return stats;
    }

    /**
     * Get payment history with transactions
     * Retrieve complete payment history including all transactions and refunds
     */
    @Get('history/:userId')
    @ApiOperation({
        summary: 'Lịch sử thanh toán của user',
        description: 'Get complete payment history for a user including transactions and refunds'
    })
    @ApiParam({ name: 'userId', description: 'User ID' })
    @ApiQuery({ 
        name: 'status', 
        description: 'Filter by payment status',
        required: false,
        enum: ['pending', 'succeeded', 'failed', 'refunded']
    })
    @ApiQuery({ 
        name: 'limit', 
        description: 'Number of records to return',
        required: false,
        example: 10
    })
    @ApiQuery({ 
        name: 'offset', 
        description: 'Number of records to skip',
        required: false,
        example: 0
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Payment history retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                payments: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            paymentId: { type: 'string' },
                            bookingId: { type: 'string' },
                            amount: { type: 'number' },
                            status: { type: 'string' },
                            method: { type: 'string' },
                            transactionId: { type: 'string' },
                            createdAt: { type: 'string' },
                            refundedAt: { type: 'string' },
                            refundAmount: { type: 'number' }
                        }
                    }
                },
                total: { type: 'number' },
                limit: { type: 'number' },
                offset: { type: 'number' }
            }
        }
    })
    async getPaymentHistory(
        @Param('userId') userId: string,
        @Query('status') status?: TransactionStatus,
        @Query('limit') limit?: number,
        @Query('offset') offset?: number
    ) {
        const limitNum = limit && limit > 0 ? Math.min(limit, 100) : 10;
        const offsetNum = offset && offset >= 0 ? offset : 0;

        const result = await this.transactionsService.getPaymentHistory(
            userId,
            status,
            limitNum,
            offsetNum
        );

        return result;
    }

    // ============================================
    // PAYOS ENDPOINTS
    // ============================================

    /**
     * Create PayOS payment URL
     */
    @Post('payos/create-payment')
    @ApiOperation({
        summary: 'Tạo URL thanh toán PayOS',
        description: 'Create PayOS payment link for booking'
    })
    @ApiBody({ type: CreatePayOSUrlDto })
    @ApiResponse({ status: 201, description: 'Payment link created successfully', type: PayOSPaymentLinkResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid request data' })
    async createPayOSPayment(@Body() dto: CreatePayOSUrlDto): Promise<PayOSPaymentLinkResponseDto> {
        console.log(`[Create PayOS Payment] Received orderId: ${dto.orderId}`);
        
        // ✅ CRITICAL: dto.orderId is the PAYMENT ID (transaction ID), not booking ID
        // Lookup transaction by payment ID to get externalTransactionId (PayOS orderCode)
        const transaction = await this.transactionsService.getPaymentById(dto.orderId);
        
        if (!transaction) {
            console.log(`[Create PayOS Payment] Transaction not found by ID, trying booking ID...`);
            // If not found by transaction ID, try finding by booking ID
            const transactionByBooking = await this.transactionsService.getPaymentByBookingId(dto.orderId);
            if (!transactionByBooking) {
                console.error(`[Create PayOS Payment] Transaction not found with either transaction ID or booking ID: ${dto.orderId}`);
                throw new NotFoundException(`Transaction not found with ID: ${dto.orderId}. Please check if the transaction/booking exists.`);
            }
            console.log(`[Create PayOS Payment] Found transaction by booking ID: ${(transactionByBooking._id as any).toString()}`);
            // Use the transaction found by booking ID
            return this.createPaymentLinkWithTransaction(dto, transactionByBooking);
        }
        
        console.log(`[Create PayOS Payment] Found transaction by ID: ${(transaction._id as any).toString()}`);
        return this.createPaymentLinkWithTransaction(dto, transaction);
    }

    /**
     * Helper method to create PayOS payment link with transaction
     */
    private async createPaymentLinkWithTransaction(dto: CreatePayOSUrlDto, transaction: any): Promise<PayOSPaymentLinkResponseDto> {
        // ✅ If transaction has externalTransactionId, use it as PayOS orderCode
        // Otherwise, generate a new one (fallback for backward compatibility)
        let orderCodeToUse: number;
        
        if (transaction.externalTransactionId) {
            orderCodeToUse = Number(transaction.externalTransactionId);
            console.log(`[Create PayOS Payment] Using existing orderCode from transaction: ${orderCodeToUse}`);
        } else {
            // Fallback: generate new orderCode and update transaction
            const { generatePayOSOrderCode } = await import('./utils/payos.utils');
            orderCodeToUse = generatePayOSOrderCode();
            
            // Update transaction with new orderCode
            await this.transactionsService.updatePaymentStatus(
                (transaction._id as any).toString(),
                transaction.status, // Keep current status
                undefined,
                { payosOrderCode: orderCodeToUse }
            );
            
            console.log(`[Create PayOS Payment] Generated new orderCode: ${orderCodeToUse}`);
        }
        
        // ✅ Create payment link with the orderCode
        // Pass orderCode to PayOSService so it uses the same orderCode
        const result = await this.payosService.createPaymentUrl({
            ...dto,
            orderCode: orderCodeToUse, // ✅ FIX: Pass orderCode from transaction
        });
        
        return result;
    }

    /**
     * PayOS Webhook Handler
     * Server-to-server callback from PayOS
     */
    @Post('payos/webhook')
    @HttpCode(200)
    @ApiOperation({
        summary: 'PayOS Webhook (Internal)',
        description: 'Server-to-server webhook from PayOS. Must be configured in PayOS portal.'
    })
    @ApiResponse({ status: 200, description: 'Webhook processed' })
    async handlePayOSWebhook(@Body() body: any) {
        try {
            console.log('[PayOS Webhook] Received webhook');
            console.log('[PayOS Webhook] Raw body:', JSON.stringify(body, null, 2));

            // PayOS sends: { "data": {...}, "signature": "..." }
            const receivedSignature = body.signature;
            const webhookData = body.data;

            if (!receivedSignature) {
                console.warn('[PayOS Webhook] ❌ Missing signature');
                return {
                    code: '97',
                    desc: 'Missing signature',
                };
            }

            if (!webhookData) {
                console.warn('[PayOS Webhook] ❌ Missing data');
                return {
                    code: '99',
                    desc: 'Invalid webhook data',
                };
            }

            console.log('[PayOS Webhook] Data:', JSON.stringify(webhookData, null, 2));
            console.log('[PayOS Webhook] Signature (first 8):', receivedSignature.substring(0, 8) + '...');

            // Verify signature
            // Use webhookData directly as PayOS signs all fields in data object
            const verificationResult = this.payosService.verifyCallback(webhookData, receivedSignature);

            if (!verificationResult.isValid) {
                console.warn(`[PayOS Webhook] ❌ Invalid signature for order ${webhookData.orderCode}`);
                return {
                    code: '97',
                    desc: 'Invalid signature',
                };
            }

            console.log(`[PayOS Webhook] ✅ Signature verified for order ${webhookData.orderCode}`);
            console.log(`[PayOS Webhook] Description received: "${webhookData.description}"`);

            // Check if this is a bank account verification payment
            // Payment creation uses prefix 'BANKACCVERIFY' (no underscore - PayOS strips special chars)
            const isVerificationPayment = webhookData.description?.startsWith('BANKACCVERIFY');
            
            if (isVerificationPayment) {
                console.log(`[PayOS Webhook] 🔍 Detected bank account verification payment for orderCode: ${webhookData.orderCode}`);
                console.log(`[PayOS Webhook] Webhook status: ${webhookData.status}`);
                console.log(`[PayOS Webhook] Counter account number: ${webhookData.counterAccountNumber || webhookData.accountNumber || 'NOT PROVIDED'}`);
                console.log(`[PayOS Webhook] Counter account name: ${webhookData.counterAccountName || 'NOT PROVIDED'}`);
                
                // Extract bankAccountId from description if available (future extension)
                // Example format: "BANK_ACC_VERIFY - {accountNumber} - {bankAccountId}"
                let bankAccountId: string | null = null;
                if (webhookData.description) {
                    const parts = webhookData.description.split(' - ');
                    if (parts.length >= 3) {
                        bankAccountId = parts[2];
                    }
                }

                // Process verification webhook (update BankAccount AND Transaction)
                try {
                    await this.fieldOwnerService.processVerificationWebhook(
                        webhookData.orderCode,
                        {
                            counterAccountNumber: webhookData.counterAccountNumber || webhookData.accountNumber,
                            counterAccountName: webhookData.counterAccountName,
                            amount: webhookData.amount,
                            status: webhookData.status || 'PAID',
                            reference: webhookData.reference,
                            transactionDateTime: webhookData.transactionDateTime,
                        },
                    );
                    console.log(`[PayOS Webhook] ✅ Bank account verification processed for orderCode: ${webhookData.orderCode}`);
                } catch (verificationError) {
                    console.error(`[PayOS Webhook] ❌ Error processing bank account verification:`, verificationError);
                    // Even if it fails, we return success to PayOS to avoid retries if it's a logic error
                    // But ideally we should check if it's a retry-able error
                }

                // Verification payments are handled entirely by FieldOwnerService
                return {
                    code: '00',
                    desc: 'Verification payment processed',
                };
            } else {
                console.log(`[PayOS Webhook] ℹ️ Not a verification payment (description: "${webhookData.description}")`);
            }

            // Find transaction by externalTransactionId (PayOS order code)
            const transaction = await this.transactionsService.getPaymentByExternalId(
                String(webhookData.orderCode)
            );

            if (!transaction) {
                // For verification payments, it's OK if transaction doesn't exist
                if (isVerificationPayment) {
                    console.log(`[PayOS Webhook] ℹ️ Verification payment processed (no transaction record needed)`);
                    return {
                        code: '00',
                        desc: 'Verification payment processed',
                    };
                }
                
                console.warn(`[PayOS Webhook] Transaction not found for orderCode: ${webhookData.orderCode}`);
                return {
                    code: '01',
                    desc: 'Transaction not found',
                };
            }

            // Check if already processed
            if (transaction.status === TransactionStatus.SUCCEEDED || transaction.status === TransactionStatus.FAILED) {
                console.log(`[PayOS Webhook] ℹ️ Transaction already processed: ${transaction.status}`);
                return {
                    code: '02',
                    desc: 'Transaction already processed',
                };
            }

            // Determine status from PayOS
            const payosStatus = webhookData.status || 'PAID';
            let newStatus: TransactionStatus;
            
            if (payosStatus === 'PAID') {
                newStatus = TransactionStatus.SUCCEEDED;
            } else if (payosStatus === 'CANCELLED' || payosStatus === 'EXPIRED') {
                newStatus = TransactionStatus.FAILED;
            } else {
                newStatus = TransactionStatus.PROCESSING;
            }

            // Update transaction
            const updated = await this.transactionsService.updatePaymentStatus(
                (transaction._id as any).toString(),
                newStatus,
                undefined,
                {
                    payosOrderCode: webhookData.orderCode,
                    payosReference: webhookData.reference,
                    payosAccountNumber: webhookData.accountNumber,
                    payosTransactionDateTime: webhookData.transactionDateTime,
                }
            );

            // Emit payment.failed event if transaction was cancelled or expired
            // This triggers cleanup (cancel booking and release slots) via CleanupService
            if (newStatus === TransactionStatus.FAILED) {
                const bookingIdStr = updated.booking 
                    ? (typeof updated.booking === 'string' 
                        ? updated.booking 
                        : (updated.booking as any)?._id 
                            ? String((updated.booking as any)._id)
                            : String(updated.booking))
                    : undefined;
                
                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                const reason = payosStatus === 'CANCELLED' 
                    ? 'PayOS transaction cancelled' 
                    : 'PayOS transaction expired';

                this.eventEmitter.emit('payment.failed', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStr,
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: webhookData.reference || String(webhookData.orderCode),
                    reason,
                });

                console.log(`[PayOS Webhook] ❌ Payment failed (${payosStatus}), emitted payment.failed event`);
            }

            // ✅ CRITICAL: Verify transaction was actually updated to SUCCEEDED before emitting event
            // This ensures transaction status is committed before booking is updated
            if (newStatus === TransactionStatus.SUCCEEDED) {
                // Double-check transaction status to ensure it's actually succeeded
                const verifiedTransaction = await this.transactionsService.getPaymentById(
                    (updated._id as any).toString()
                );
                
                if (!verifiedTransaction) {
                    console.error(`[PayOS Webhook] ❌ Transaction ${updated._id} not found after update`);
                    return {
                        code: '99',
                        desc: 'Transaction verification failed',
                    };
                }
                
                if (verifiedTransaction.status !== TransactionStatus.SUCCEEDED) {
                    console.error(
                        `[PayOS Webhook] ❌ Transaction ${updated._id} status mismatch: ` +
                        `expected SUCCEEDED, got ${verifiedTransaction.status}`
                    );
                    return {
                        code: '99',
                        desc: 'Transaction status verification failed',
                    };
                }
                
                console.log(`[PayOS Webhook] ✅ Transaction ${updated._id} verified as SUCCEEDED, emitting event`);
                
                const bookingIdStr = updated.booking
                    ? (typeof updated.booking === 'string'
                        ? updated.booking
                        : (updated.booking as any)?._id
                            ? String((updated.booking as any)._id)
                            : String(updated.booking))
                    : undefined;

                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                // Only emit event after transaction is verified as SUCCEEDED
                this.eventEmitter.emit('payment.success', {
                    paymentId: String(updated._id),
                    bookingId: bookingIdStr,
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: webhookData.reference,
                });
            }

            console.log(`[PayOS Webhook] ✅ Transaction updated: ${newStatus}`);

            return {
                code: '00',
                desc: 'Success',
            };
        } catch (error) {
            console.error(`[PayOS Webhook] ❌ Error: ${error.message}`);
            return {
                code: '99',
                desc: 'System error',
            };
        }
    }

    /**
     * PayOS Return URL Handler
     * Called when user returns from PayOS payment page
     * ✅ CRITICAL: Updates transaction status and emits payment events (similar to webhook)
     */
    @Get('payos/return')
    @ApiOperation({
        summary: 'PayOS Return URL',
        description: 'Handle return from PayOS payment page. Updates transaction status and triggers booking confirmation.'
    })
    @ApiQuery({ name: 'orderCode', description: 'PayOS order code', required: false })
    @ApiQuery({ name: 'status', description: 'Payment status', required: false })
    @ApiResponse({ status: 200, description: 'Payment verification result' })
    async handlePayOSReturn(@Query() query: any) {
        try {
            const orderCode = query.orderCode ? Number(query.orderCode) : null;
            const status = query.status;

            if (!orderCode) {
                return {
                    success: false,
                    paymentStatus: 'failed',
                    bookingId: '',
                    message: 'Missing order code',
                    amount: 0,
                };
            }

            console.log(`[PayOS Return] Processing return for orderCode: ${orderCode}`);

            // Query transaction from PayOS
            const payosTransaction = await this.payosService.queryTransaction(orderCode);

            // Find local transaction
            const transaction = await this.transactionsService.getPaymentByExternalId(String(orderCode));

            if (!transaction) {
                console.warn(`[PayOS Return] Transaction not found for orderCode: ${orderCode}`);
                return {
                    success: false,
                    paymentStatus: 'failed',
                    bookingId: '',
                    message: 'Transaction not found',
                    reason: 'Transaction not found in system',
                    amount: payosTransaction.amount,
                };
            }

            // Map PayOS status to our TransactionStatus enum
            let newStatus: TransactionStatus;
            let paymentStatus: 'succeeded' | 'failed' | 'pending' | 'cancelled';
            
            if (payosTransaction.status === 'PAID') {
                newStatus = TransactionStatus.SUCCEEDED;
                paymentStatus = 'succeeded';
            } else if (payosTransaction.status === 'CANCELLED' || payosTransaction.status === 'EXPIRED') {
                newStatus = TransactionStatus.FAILED;
                paymentStatus = 'failed';
            } else if (payosTransaction.status === 'PENDING' || payosTransaction.status === 'PROCESSING') {
                newStatus = TransactionStatus.PROCESSING;
                paymentStatus = 'pending';
            } else {
                newStatus = TransactionStatus.FAILED;
                paymentStatus = 'cancelled';
            }

            // ✅ CRITICAL: Only update if status has changed and transaction is not already finalized
            if (transaction.status !== TransactionStatus.SUCCEEDED && transaction.status !== TransactionStatus.FAILED) {
                console.log(`[PayOS Return] Updating transaction ${transaction._id} from ${transaction.status} to ${newStatus}`);
                
                // Update transaction status (similar to webhook)
                const updated = await this.transactionsService.updatePaymentStatus(
                    (transaction._id as any).toString(),
                    newStatus,
                    undefined,
                    {
                        payosOrderCode: payosTransaction.orderCode,
                        payosReference: payosTransaction.reference,
                        payosAccountNumber: payosTransaction.accountNumber,
                        payosTransactionDateTime: payosTransaction.transactionDateTime,
                    }
                );

                // Emit payment.failed event if transaction was cancelled or expired
                if (newStatus === TransactionStatus.FAILED) {
                    const bookingIdStr = updated.booking 
                        ? (typeof updated.booking === 'string' 
                            ? updated.booking 
                            : (updated.booking as any)?._id 
                                ? String((updated.booking as any)._id)
                                : String(updated.booking))
                        : undefined;
                    
                    const userIdStr = updated.user
                        ? (typeof updated.user === 'string'
                            ? updated.user
                            : (updated.user as any)?._id
                                ? String((updated.user as any)._id)
                                : String(updated.user))
                        : undefined;

                    const reason = payosTransaction.status === 'CANCELLED' 
                        ? 'PayOS transaction cancelled' 
                        : 'PayOS transaction expired';

                    this.eventEmitter.emit('payment.failed', {
                        paymentId: String(updated._id),
                        bookingId: bookingIdStr,
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference || String(payosTransaction.orderCode),
                        reason,
                    });

                    console.log(`[PayOS Return] ❌ Payment failed (${payosTransaction.status}), emitted payment.failed event`);
                }

                // ✅ CRITICAL: Emit payment.success event if payment succeeded
                if (newStatus === TransactionStatus.SUCCEEDED) {
                    // Double-check transaction status to ensure it's actually succeeded
                    const verifiedTransaction = await this.transactionsService.getPaymentById(
                        (updated._id as any).toString()
                    );
                    
                    if (!verifiedTransaction) {
                        console.error(`[PayOS Return] ❌ Transaction ${updated._id} not found after update`);
                    } else if (verifiedTransaction.status !== TransactionStatus.SUCCEEDED) {
                        console.error(
                            `[PayOS Return] ❌ Transaction ${updated._id} status mismatch: ` +
                            `expected SUCCEEDED, got ${verifiedTransaction.status}`
                        );
                    } else {
                        console.log(`[PayOS Return] ✅ Transaction ${updated._id} verified as SUCCEEDED, emitting event`);
                        
                        const bookingIdStr = updated.booking
                            ? (typeof updated.booking === 'string'
                                ? updated.booking
                                : (updated.booking as any)?._id
                                    ? String((updated.booking as any)._id)
                                    : String(updated.booking))
                            : undefined;

                        const userIdStr = updated.user
                            ? (typeof updated.user === 'string'
                                ? updated.user
                                : (updated.user as any)?._id
                                    ? String((updated.user as any)._id)
                                    : String(updated.user))
                            : undefined;

                        // Emit payment.success event to trigger booking confirmation
                        this.eventEmitter.emit('payment.success', {
                            paymentId: String(updated._id),
                            bookingId: bookingIdStr,
                            userId: userIdStr,
                            amount: updated.amount,
                            method: updated.method,
                            transactionId: payosTransaction.reference,
                        });

                        console.log(`[PayOS Return] ✅ Payment success event emitted for booking ${bookingIdStr}`);
                    }
                }
            } else {
                console.log(`[PayOS Return] ℹ️ Transaction ${transaction._id} already processed: ${transaction.status}`);
            }

            const bookingId = transaction.booking
                ? (typeof transaction.booking === 'string'
                    ? transaction.booking
                    : (transaction.booking as any)?._id
                        ? String((transaction.booking as any)._id)
                        : String(transaction.booking))
                : '';

            return {
                success: paymentStatus === 'succeeded',
                paymentStatus,
                bookingId,
                message: paymentStatus === 'succeeded' ? 'Payment successful' : 'Payment failed',
                orderCode: payosTransaction.orderCode,
                reference: payosTransaction.reference,
                amount: payosTransaction.amount,
            };
        } catch (error) {
            console.error('[PayOS Return] Error:', error);
            return {
                success: false,
                paymentStatus: 'failed',
                bookingId: '',
                message: 'Error verifying payment',
                reason: error.message,
                amount: 0,
            };
        }
    }

    /**
     * Query PayOS Transaction Status
     */
    @Get('payos/query/:orderCode')
    @ApiOperation({
        summary: 'Query PayOS transaction status',
        description: 'Query transaction status directly from PayOS API'
    })
    @ApiParam({ name: 'orderCode', description: 'PayOS order code', example: '123456789' })
    @ApiResponse({ status: 200, description: 'Transaction query result', type: PayOSTransactionQueryResponseDto })
    @ApiResponse({ status: 400, description: 'Invalid order code or transaction not found' })
    async queryPayOSTransaction(@Param('orderCode') orderCode: string): Promise<PayOSTransactionQueryResponseDto> {
        const orderCodeNum = Number(orderCode);
        if (isNaN(orderCodeNum)) {
            throw new BadRequestException('Invalid order code format');
        }
        return await this.payosService.queryTransaction(orderCodeNum);
    }

    /**
     * Cancel PayOS Transaction
     */
    @Post('payos/cancel/:orderCode')
    @ApiOperation({
        summary: 'Cancel PayOS transaction',
        description: 'Cancel a PayOS payment transaction'
    })
    @ApiParam({ name: 'orderCode', description: 'PayOS order code', example: '123456789' })
    @ApiBody({ type: CancelPayOSTransactionDto, required: false })
    @ApiResponse({ status: 200, description: 'Transaction cancelled successfully', type: PayOSCancelResponseDto })
    @ApiResponse({ status: 400, description: 'Cannot cancel transaction' })
    async cancelPayOSTransaction(
        @Param('orderCode') orderCode: string,
        @Body() dto?: CancelPayOSTransactionDto
    ): Promise<PayOSCancelResponseDto> {
        const orderCodeNum = Number(orderCode);
        if (isNaN(orderCodeNum)) {
            throw new BadRequestException('Invalid order code format');
        }
        return await this.payosService.cancelTransaction(orderCodeNum, dto?.cancellationReason);
    }

    /**
 * Tournament-specific PayOS return URL
 * Handles return from tournament payment and redirects to tournament page
 */
@Get('payos/tournament-return/:tournamentId')
@ApiOperation({
    summary: 'Tournament PayOS Return URL',
    description: 'Handle return from tournament payment and redirect to tournament page with status'
})
@ApiParam({ name: 'tournamentId', description: 'Tournament ID' })
@ApiQuery({ name: 'orderCode', description: 'PayOS order code', required: false })
@ApiQuery({ name: 'status', description: 'Payment status', required: false })
async handleTournamentPaymentReturn(
    @Param('tournamentId') tournamentId: string,
    @Query() query: any,
    @Res() res: Response
) {
    try {
        const orderCode = query.orderCode ? Number(query.orderCode) : null;
        const status = query.status;
        
        // Get frontend URL from config
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
        
        if (!orderCode) {
            // Redirect to tournament page with error
            return res.redirect(`${frontendUrl}/tournaments/${tournamentId}?payment=error&reason=missing_order_code`);
        }

        console.log(`[Tournament Payment Return] Processing return for orderCode: ${orderCode}, tournament: ${tournamentId}`);

        // Query transaction from PayOS
        const payosTransaction = await this.payosService.queryTransaction(orderCode);

        // Find local transaction
        const transaction = await this.transactionsService.getPaymentByExternalId(String(orderCode));

        if (!transaction) {
            console.warn(`[Tournament Payment Return] Transaction not found for orderCode: ${orderCode}`);
            return res.redirect(`${frontendUrl}/tournaments/${tournamentId}?payment=error&reason=transaction_not_found`);
        }

        // Map PayOS status to our TransactionStatus enum
        let newStatus: TransactionStatus;
        let paymentStatus: 'success' | 'failed' | 'pending' | 'cancelled';
        
        if (payosTransaction.status === 'PAID') {
            newStatus = TransactionStatus.SUCCEEDED;
            paymentStatus = 'success';
        } else if (payosTransaction.status === 'CANCELLED' || payosTransaction.status === 'EXPIRED') {
            newStatus = TransactionStatus.FAILED;
            paymentStatus = 'failed';
        } else if (payosTransaction.status === 'PENDING' || payosTransaction.status === 'PROCESSING') {
            newStatus = TransactionStatus.PROCESSING;
            paymentStatus = 'pending';
        } else {
            newStatus = TransactionStatus.FAILED;
            paymentStatus = 'cancelled';
        }

        // Update transaction status if not already finalized
        if (transaction.status !== TransactionStatus.SUCCEEDED && transaction.status !== TransactionStatus.FAILED) {
            console.log(`[Tournament Payment Return] Updating transaction ${transaction._id} from ${transaction.status} to ${newStatus}`);
            
            const updated = await this.transactionsService.updatePaymentStatus(
                (transaction._id as any).toString(),
                newStatus,
                undefined,
                {
                    payosOrderCode: payosTransaction.orderCode,
                    payosReference: payosTransaction.reference,
                    payosAccountNumber: payosTransaction.accountNumber,
                    payosTransactionDateTime: payosTransaction.transactionDateTime,
                }
            );

            // Emit payment events based on status
            if (newStatus === TransactionStatus.FAILED) {
                const bookingIdStr = updated.booking 
                    ? (typeof updated.booking === 'string' 
                        ? updated.booking 
                        : (updated.booking as any)?._id 
                            ? String((updated.booking as any)._id)
                            : String(updated.booking))
                    : undefined;
                
                const userIdStr = updated.user
                    ? (typeof updated.user === 'string'
                        ? updated.user
                        : (updated.user as any)?._id
                            ? String((updated.user as any)._id)
                            : String(updated.user))
                    : undefined;

                const reason = payosTransaction.status === 'CANCELLED' 
                    ? 'PayOS transaction cancelled' 
                    : 'PayOS transaction expired';

                this.eventEmitter.emit('payment.failed', {
                    paymentId: String(updated._id),
                    tournamentId: tournamentId,
                    userId: userIdStr,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: payosTransaction.reference || String(payosTransaction.orderCode),
                    reason,
                });
            } else if (newStatus === TransactionStatus.SUCCEEDED) {
                // Double-check transaction status
                const verifiedTransaction = await this.transactionsService.getPaymentById(
                    (updated._id as any).toString()
                );
                
                if (verifiedTransaction && verifiedTransaction.status === TransactionStatus.SUCCEEDED) {
                    const bookingIdStr = updated.booking
                        ? (typeof updated.booking === 'string'
                            ? updated.booking
                            : (updated.booking as any)?._id
                                ? String((updated.booking as any)._id)
                                : String(updated.booking))
                        : undefined;

                    const userIdStr = updated.user
                        ? (typeof updated.user === 'string'
                            ? updated.user
                            : (updated.user as any)?._id
                                ? String((updated.user as any)._id)
                                : String(updated.user))
                        : undefined;

                    // Emit payment.success event for tournament
                    this.eventEmitter.emit('payment.success', {
                        paymentId: String(updated._id),
                        tournamentId: tournamentId,
                        userId: userIdStr,
                        amount: updated.amount,
                        method: updated.method,
                        transactionId: payosTransaction.reference,
                    });
                }
            }
        }

        // Redirect to tournament page with payment status
        return res.redirect(
            `${frontendUrl}/tournaments/${tournamentId}?payment=${paymentStatus}&orderCode=${orderCode}`
        );

    } catch (error) {
        console.error('[Tournament Payment Return] Error:', error);
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') || 'http://localhost:5173';
        return res.redirect(
            `${frontendUrl}/tournaments/${tournamentId}?payment=error&reason=system_error`
        );
    }
}
}

