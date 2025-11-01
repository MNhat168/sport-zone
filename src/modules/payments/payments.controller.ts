import { Controller, Get, Query, Req, BadRequestException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import * as crypto from 'crypto';
import * as qs from 'qs';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PaymentStatus } from './entities/payment.entity';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {

    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly configService: ConfigService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    /**
     * Create VNPay payment URL
     */
    @Get('create-vnpay-url')
    @ApiOperation({
        summary: 'Tạo URL thanh toán VNPay',
        description: 'Generate VNPay payment URL for booking'
    })
    @ApiQuery({ name: 'amount', description: 'Số tiền thanh toán (VND)', example: '200000' })
    @ApiQuery({ name: 'orderId', description: 'Booking ID hoặc Payment ID', example: '6904dd2a6289f3cf36b1dbe3' })
    @ApiQuery({ name: 'returnUrl', description: 'URL redirect sau khi thanh toán (optional)', required: false })
    @ApiResponse({ status: 200, description: 'Payment URL được tạo thành công' })
    @ApiResponse({ status: 400, description: 'Invalid amount or orderId' })
    createVNPayUrl(
        @Query('amount') amount: string,
        @Query('orderId') orderId: string,
        @Req() req: Request,
        @Query('returnUrl') returnUrl?: string,
    ) {
        const parsedAmount = Number(amount);
        if (!orderId || !amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
            throw new BadRequestException('Invalid amount or orderId');
        }

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
        const url = this.paymentsService.createVNPayUrl(parsedAmount, orderId, ipAddr, returnUrl);
        return { paymentUrl: url };
    }

    /**
     * VNPay IPN (Instant Payment Notification) - Server-to-Server callback
     * CRITICAL: This endpoint must be configured in VNPay merchant portal
     * URL: https://your-domain.com/api/payments/vnpay-ipn
     */
    @Get('vnpay-ipn')
    @ApiOperation({
        summary: 'VNPay IPN callback (Internal)',
        description: 'Server-to-server callback from VNPay. Must be configured in VNPay portal.'
    })
    @ApiResponse({ status: 200, description: 'IPN processed successfully' })
    async handleVNPayCallback(@Query() query: any) {
        const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
        if (!vnp_HashSecret) {
            throw new BadRequestException('Payment configuration error');
        }
        const vnp_SecureHash = query.vnp_SecureHash;
        delete query.vnp_SecureHash;
        delete query.vnp_SecureHashType;

        const sorted = Object.keys(query)
            .sort()
            .reduce((acc, key) => {
                acc[key] = query[key];
                return acc;
            }, {} as Record<string, string>);

        const signData = qs.stringify(sorted, { encode: false });
        const hmac = crypto.createHmac('sha512', vnp_HashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

        if (signed !== vnp_SecureHash) {
            return { RspCode: '97', Message: 'Invalid signature' };
        }

        // Signature valid → process payment
        const responseCode: string | undefined = query.vnp_ResponseCode;
        const orderId: string | undefined = query.vnp_TxnRef; // our original order id
        const vnp_TransactionNo: string | undefined = query.vnp_TransactionNo;
        const vnp_BankTranNo: string | undefined = query.vnp_BankTranNo;
        const transactionId = vnp_TransactionNo || vnp_BankTranNo || undefined;

        try {
            if (!orderId) {
                // Missing reference - still acknowledge to avoid retries
                return { RspCode: '00', Message: 'No orderId, acknowledged' };
            }

            // Try resolve payment by paymentId first; fallback to bookingId
            let payment = await this.paymentsService.getPaymentById(orderId);
            if (!payment) {
                payment = await this.paymentsService.getPaymentByBookingId(orderId);
            }

            if (!payment) {
                return { RspCode: '00', Message: 'Payment not found, acknowledged' };
            }

            // Idempotency: if already succeeded/failed, acknowledge without changes
            if (payment.status === PaymentStatus.SUCCEEDED || payment.status === PaymentStatus.FAILED) {
                return { RspCode: '00', Message: 'Already processed' };
            }

            if (responseCode === '00') {
                const updated = await this.paymentsService.updatePaymentStatus(
                    (payment._id as any).toString(),
                    PaymentStatus.SUCCEEDED,
                    transactionId,
                );
                // Emit payment success event
                this.eventEmitter.emit('payment.success', {
                    paymentId: (updated._id as any).toString(),
                    bookingId: (updated.booking as any)?.toString?.() || updated.booking,
                    userId: (updated.paidBy as any)?.toString?.() || updated.paidBy,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: updated.transactionId,
                });
            } else {
                const updated = await this.paymentsService.updatePaymentStatus(
                    (payment._id as any).toString(),
                    PaymentStatus.FAILED,
                    transactionId,
                );
                // Emit payment failed event
                this.eventEmitter.emit('payment.failed', {
                    paymentId: (updated._id as any).toString(),
                    bookingId: (updated.booking as any)?.toString?.() || updated.booking,
                    userId: (updated.paidBy as any)?.toString?.() || updated.paidBy,
                    amount: updated.amount,
                    method: updated.method,
                    transactionId: updated.transactionId,
                    reason: `VNPay response ${responseCode}`,
                });
            }
        } catch (e) {
            // Always acknowledge to VNPay to stop retries; log is recommended
            return { RspCode: '00', Message: 'Processed with internal error' };
        }

        return { RspCode: '00', Message: 'Confirm Success' };
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

        // Verify signature
        const sorted = Object.keys(queryWithoutHash)
            .sort()
            .reduce((acc, key) => {
                acc[key] = queryWithoutHash[key];
                return acc;
            }, {} as Record<string, string>);

        const signData = qs.stringify(sorted, { encode: false });
        const hmac = crypto.createHmac('sha512', hashSecret);
        const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

        console.log('[Verify VNPay] Signature check:', {
            received: vnp_SecureHash.substring(0, 20) + '...',
            calculated: signed.substring(0, 20) + '...',
            match: signed === vnp_SecureHash
        });

        if (signed !== vnp_SecureHash) {
            console.error('[Verify VNPay] ❌ Invalid signature');
            console.error('[Verify VNPay] Sign data:', signData);
            throw new BadRequestException('Invalid signature. Please check VNPay parameters.');
        }

        const responseCode: string | undefined = query.vnp_ResponseCode;
        const orderId: string | undefined = query.vnp_TxnRef;
        const transactionId: string | undefined = query.vnp_TransactionNo || query.vnp_BankTranNo;

        console.log('[Verify VNPay] Extracted params:', {
            responseCode,
            orderId,
            transactionId,
            hasAllParams: !!(responseCode !== undefined && orderId)
        });

        if (!orderId) {
            console.error('[Verify VNPay] ❌ Missing vnp_TxnRef (orderId) in query params');
            throw new BadRequestException('Missing order ID (vnp_TxnRef). Please ensure VNPay redirect includes this parameter.');
        }

        // Get payment
        let payment = await this.paymentsService.getPaymentById(orderId);
        if (!payment) {
            payment = await this.paymentsService.getPaymentByBookingId(orderId);
        }

        if (!payment) {
            throw new NotFoundException('Payment not found');
        }

        // Check if already processed (by IPN)
        if (payment.status !== PaymentStatus.PENDING) {
            console.log('[Verify VNPay] Payment already processed by IPN:', payment.status);
            return {
                success: payment.status === PaymentStatus.SUCCEEDED,
                paymentStatus: payment.status,
                bookingId: payment.booking,
                message: 'Payment already processed'
            };
        }

        // Update payment status if still pending
        if (responseCode === '00') {
            // Payment success
            const updated = await this.paymentsService.updatePaymentStatus(
                (payment._id as any).toString(),
                PaymentStatus.SUCCEEDED,
                transactionId,
            );

            console.log('[Verify VNPay] ✅ Payment succeeded');

            // Emit success event
            this.eventEmitter.emit('payment.success', {
                paymentId: (updated._id as any).toString(),
                bookingId: (updated.booking as any)?.toString?.() || updated.booking,
                userId: (updated.paidBy as any)?.toString?.() || updated.paidBy,
                amount: updated.amount,
                method: updated.method,
                transactionId: updated.transactionId,
            });

            return {
                success: true,
                paymentStatus: 'succeeded',
                bookingId: updated.booking,
                message: 'Payment successful'
            };
        } else {
            // Payment failed
            const updated = await this.paymentsService.updatePaymentStatus(
                (payment._id as any).toString(),
                PaymentStatus.FAILED,
                transactionId,
            );

            console.log('[Verify VNPay] ⚠️ Payment failed:', responseCode);

            // Emit failed event
            this.eventEmitter.emit('payment.failed', {
                paymentId: (updated._id as any).toString(),
                bookingId: (updated.booking as any)?.toString?.() || updated.booking,
                userId: (updated.paidBy as any)?.toString?.() || updated.paidBy,
                amount: updated.amount,
                method: updated.method,
                transactionId: updated.transactionId,
                reason: `VNPay response ${responseCode}`,
            });

            return {
                success: false,
                paymentStatus: 'failed',
                bookingId: updated.booking,
                reason: `VNPay response code: ${responseCode}`,
                message: 'Payment failed'
            };
        }
    }
}
