import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Payment, PaymentStatus } from './entities/payment.entity';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';

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
}
