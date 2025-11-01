import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import * as crypto from 'crypto';
import * as qs from 'qs';

export interface CreatePaymentData {
  bookingId: string;
  userId: string;
  amount: number;
  method: PaymentMethod;
  paymentNote?: string;
  transactionId?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @InjectModel(Payment.name) private readonly paymentModel: Model<Payment>,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Tạo payment record mới
   */
  async createPayment(data: CreatePaymentData): Promise<Payment> {
    try {
      const payment = new this.paymentModel({
        booking: new Types.ObjectId(data.bookingId),
        paidBy: new Types.ObjectId(data.userId),
        amount: data.amount,
        method: data.method,
        status: PaymentStatus.PENDING,
        paymentNote: data.paymentNote || null,
        transactionId: data.transactionId || null,
      });

      const savedPayment = await payment.save();
      this.logger.log(`Created payment ${savedPayment._id} for booking ${data.bookingId}`);
      
      return savedPayment;
    } catch (error) {
      this.logger.error('Error creating payment', error);
      throw new BadRequestException('Failed to create payment');
    }
  }

  /**
   * Cập nhật trạng thái payment
   */
  async updatePaymentStatus(
    paymentId: string, 
    status: PaymentStatus,
    transactionId?: string,
    receiptUrl?: string
  ): Promise<Payment> {
    const payment = await this.paymentModel.findByIdAndUpdate(
      paymentId,
      {
        status,
        ...(transactionId && { transactionId }),
        ...(receiptUrl && { receiptUrl }),
      },
      { new: true }
    );

    if (!payment) {
      throw new NotFoundException(`Payment with ID ${paymentId} not found`);
    }

    this.logger.log(`Updated payment ${paymentId} status to ${status}`);
    return payment;
  }

  /**
   * Lấy payment theo booking ID
   */
  async getPaymentByBookingId(bookingId: string): Promise<Payment | null> {
    return this.paymentModel
      .findOne({ booking: new Types.ObjectId(bookingId) })
      .populate('paidBy', 'fullName email')
      .exec();
  }

  /**
   * Lấy payment theo ID
   */
  async getPaymentById(paymentId: string): Promise<Payment | null> {
    return this.paymentModel
      .findById(paymentId)
      .populate('booking')
      .populate('paidBy', 'fullName email')
      .exec();
  }


  createVNPayUrl(amount: number, orderId: string, ipAddr: string, returnUrlOverride?: string): string {
    const vnp_TmnCode = this.configService.get<string>('vnp_TmnCode');
    const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
    const vnp_Url = this.configService.get<string>('vnp_Url');
    
    // Hardcode returnUrl - không dùng env
    const DEFAULT_RETURN_URL = 'http://localhost:3000/api/reservations/vnpay_return';
    const vnp_ReturnUrl =  DEFAULT_RETURN_URL;

    if (!vnp_TmnCode || !vnp_HashSecret || !vnp_Url) {
      this.logger.error('VNPay configuration is missing. Please check environment variables.');
      throw new BadRequestException('Payment configuration error');
    }
    
    // Trim whitespace from config values to prevent signature errors
    const tmnCode = vnp_TmnCode.trim();
    const hashSecret = vnp_HashSecret.trim();
    const vnpayUrl = vnp_Url.trim();
    
    this.logger.debug(`[VNPay Config] TMN Code: ${tmnCode}`);
    this.logger.debug(`[VNPay Config] Hash Secret Length: ${hashSecret.length}`);
    this.logger.debug(`[VNPay Config] URL: ${vnpayUrl}`);
    
    const date = new Date();
    const createDate = `${date.getFullYear()}${(date.getMonth() + 1)
      .toString()
      .padStart(2, '0')}${date.getDate().toString().padStart(2, '0')}${date
        .getHours()
        .toString()
        .padStart(2, '0')}${date.getMinutes().toString().padStart(2, '0')}${date
          .getSeconds()
          .toString()
          .padStart(2, '0')}`;

    const vnp_Params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: tmnCode,
      vnp_Locale: 'vn',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: orderId,
      vnp_OrderInfo: `Thanh toan don hang ${orderId}`,
      vnp_OrderType: 'other',
      vnp_Amount: (amount * 100).toString(),
      vnp_ReturnUrl: vnp_ReturnUrl,
      vnp_IpAddr: ipAddr,
      vnp_CreateDate: createDate,
    };

    // Sort parameters alphabetically
    const sorted = Object.keys(vnp_Params)
      .sort()
      .reduce((acc, key) => {
        acc[key] = vnp_Params[key];
        return acc;
      }, {} as Record<string, string>);

    // Create sign data - DO NOT encode
    const signData = qs.stringify(sorted, { encode: false });
    
    // Create HMAC SHA512 signature
    const hmac = crypto.createHmac('sha512', hashSecret);
    const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

    sorted['vnp_SecureHash'] = signed;

    // Build final URL - DO NOT encode
    const finalUrl = `${vnpayUrl}?${qs.stringify(sorted, { encode: false })}`;
    
    // Debug logging
    this.logger.log(`[VNPay URL] Created payment URL for order ${orderId}`);
    this.logger.debug(`[VNPay URL] Sign data: ${signData}`);
    this.logger.debug(`[VNPay URL] Signature: ${signed}`);
    this.logger.debug(`[VNPay URL] Final URL (first 150 chars): ${finalUrl.substring(0, 150)}...`);
    
    return finalUrl;
  }
}
