/**
 * VNPay Service
 * Handles all VNPay payment operations
 * Based on official VNPay Node.js demo
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import * as qs from 'qs';
import axios from 'axios';
import {
  createVNPayPaymentUrl,
  verifyVNPaySignature,
  sortObject,
  formatVNPayDate,
  generateVNPayRequestId,
  getVNPayResponseDescription,
  VNPayResponseCode,
} from './utils/vnpay.utils';
import {
  CreateVNPayUrlDto,
  QueryTransactionDto,
  RefundTransactionDto,
  VNPayQueryDRResponseDto,
  VNPayRefundResponseDto,
} from './dto/vnpay.dto';

@Injectable()
export class VNPayService {
  private readonly logger = new Logger(VNPayService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Get VNPay configuration from environment
   */
  private getVNPayConfig() {
    const vnp_TmnCode = this.configService.get<string>('vnp_TmnCode');
    const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
    const vnp_Url = this.configService.get<string>('vnp_Url');
    const vnp_Api = this.configService.get<string>('vnp_Api');
    const vnp_ReturnUrl = this.configService.get<string>('vnp_ReturnUrl');

    // Check and log missing configurations
    const missingConfigs: string[] = [];
    if (!vnp_TmnCode) missingConfigs.push('vnp_TmnCode');
    if (!vnp_HashSecret) missingConfigs.push('vnp_HashSecret');
    if (!vnp_Url) missingConfigs.push('vnp_Url');

    if (missingConfigs.length > 0) {
      this.logger.error(`[VNPay Config] ❌ Missing required environment variables: ${missingConfigs.join(', ')}`);
      this.logger.error(`[VNPay Config] Please check your .env file and ensure these variables are set:`);
      missingConfigs.forEach(key => {
        this.logger.error(`[VNPay Config]   - ${key}`);
      });
      throw new BadRequestException(`Payment system is not configured. Missing: ${missingConfigs.join(', ')}`);
    }

    // Log configuration status (without exposing secrets)
    // At this point, we know all required configs exist (checked above)
    this.logger.debug(`[VNPay Config] ✅ Configuration loaded`);
    this.logger.debug(`[VNPay Config]   - TMN Code: ${vnp_TmnCode!.substring(0, 4)}****`);
    this.logger.debug(`[VNPay Config]   - Hash Secret: ${vnp_HashSecret!.length} chars`);
    this.logger.debug(`[VNPay Config]   - URL: ${vnp_Url}`);
    this.logger.debug(`[VNPay Config]   - API: ${vnp_Api || 'default'}`);
    this.logger.debug(`[VNPay Config]   - Return URL: ${vnp_ReturnUrl || 'default'}`);

    return {
      vnp_TmnCode: vnp_TmnCode!.trim(),
      vnp_HashSecret: vnp_HashSecret!.trim(),
      vnp_Url: vnp_Url!.trim(),
      vnp_Api: vnp_Api?.trim() || 'https://sandbox.vnpayment.vn/merchant_webapi/api/transaction',
      vnp_ReturnUrl: vnp_ReturnUrl?.trim() || 'http://localhost:5173/transactions/vnpay/return',
    };
  }

  /**
   * Create VNPay payment URL
   * Based on vnpay_nodejs/routes/order.js - create_payment_url
   * 
   * @param dto - Payment parameters
   * @param ipAddr - Client IP address
   * @returns VNPay payment URL
   */
  createPaymentUrl(dto: CreateVNPayUrlDto, ipAddr: string): string {
    try {
      const config = this.getVNPayConfig();

      this.logger.log(`[Create Payment URL] Order: ${dto.orderId}, Amount: ${dto.amount} VND`);

      const paymentUrl = createVNPayPaymentUrl(
        {
          vnp_TmnCode: config.vnp_TmnCode,
          vnp_HashSecret: config.vnp_HashSecret,
          vnp_Url: config.vnp_Url,
          vnp_ReturnUrl: dto.returnUrl || config.vnp_ReturnUrl,
        },
        {
          amount: dto.amount,
          orderId: dto.orderId,
          orderInfo: `Thanh toan don hang ${dto.orderId}`,
          ipAddr,
          bankCode: dto.bankCode,
          locale: dto.locale,
        }
      );

      this.logger.log(`[Create Payment URL] ✅ URL created successfully`);
      this.logger.debug(`[Create Payment URL] URL: ${paymentUrl.substring(0, 150)}...`);

      return paymentUrl;
    } catch (error) {
      this.logger.error(`[Create Payment URL] ❌ Error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify VNPay callback signature
   * Used by both IPN and Return URL handlers
   * Uses same signature verification as vnpay_nodejs
   * 
   * @param query - Query parameters from VNPay (already decoded by Express)
   * @returns Verification result with extracted data
   */
  verifyCallback(query: Record<string, any>): {
    isValid: boolean;
    data: {
      orderId: string;
      amount: number;
      responseCode: string;
      transactionNo?: string;
      bankTranNo?: string;
      bankCode?: string;
      cardType?: string;
      payDate?: string;
    };
  } {
    try {
      const config = this.getVNPayConfig();

      const secureHash = query.vnp_SecureHash;
      // Use verifyVNPaySignature which handles encoding correctly
      const isValid = verifyVNPaySignature(query, config.vnp_HashSecret, secureHash);

      const data = {
        orderId: query.vnp_TxnRef,
        amount: query.vnp_Amount ? parseInt(query.vnp_Amount) / 100 : 0,
        responseCode: query.vnp_ResponseCode,
        transactionNo: query.vnp_TransactionNo,
        bankTranNo: query.vnp_BankTranNo,
        bankCode: query.vnp_BankCode,
        cardType: query.vnp_CardType,
        payDate: query.vnp_PayDate,
      };

      this.logger.log(`[Verify Callback] Order: ${data.orderId}, Valid: ${isValid}`);
      this.logger.debug(`[Verify Callback] Response code: ${data.responseCode}`);

      return { isValid, data };
    } catch (error) {
      this.logger.error(`[Verify Callback] ❌ Error: ${error.message}`);
      return {
        isValid: false,
        data: {
          orderId: '',
          amount: 0,
          responseCode: '99',
        },
      };
    }
  }

  /**
   * Query transaction status from VNPay
   * Based on vnpay_nodejs/routes/order.js - querydr
   * 
   * @param dto - Query parameters
   * @param ipAddr - Client IP address
   * @returns VNPay API response
   */
  async queryTransaction(
    dto: QueryTransactionDto,
    ipAddr: string
  ): Promise<VNPayQueryDRResponseDto> {
    try {
      const config = this.getVNPayConfig();

      this.logger.log(`[Query DR] Order: ${dto.orderId}, TransDate: ${dto.transactionDate}`);

      const date = new Date();
      const vnp_RequestId = generateVNPayRequestId();
      const vnp_Version = '2.1.0';
      const vnp_Command = 'querydr';
      const vnp_TmnCode = config.vnp_TmnCode;
      const vnp_TxnRef = dto.orderId;
      const vnp_OrderInfo = `Truy van GD ma:${vnp_TxnRef}`;
      const vnp_TransactionDate = dto.transactionDate;
      const vnp_CreateDate = formatVNPayDate(date);
      const vnp_IpAddr = ipAddr;

      // Create signature data (specific format for Query DR)
      const data = [
        vnp_RequestId,
        vnp_Version,
        vnp_Command,
        vnp_TmnCode,
        vnp_TxnRef,
        vnp_TransactionDate,
        vnp_CreateDate,
        vnp_IpAddr,
        vnp_OrderInfo,
      ].join('|');

      const hmac = crypto.createHmac('sha512', config.vnp_HashSecret);
      const vnp_SecureHash = hmac.update(Buffer.from(data, 'utf-8')).digest('hex');

      const requestBody = {
        vnp_RequestId,
        vnp_Version,
        vnp_Command,
        vnp_TmnCode,
        vnp_TxnRef,
        vnp_OrderInfo,
        vnp_TransactionDate,
        vnp_CreateDate,
        vnp_IpAddr,
        vnp_SecureHash,
      };

      this.logger.debug(`[Query DR] Request body: ${JSON.stringify(requestBody)}`);

      // Call VNPay API
      const response = await axios.post(config.vnp_Api, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      this.logger.log(`[Query DR] ✅ Response received`);
      this.logger.debug(`[Query DR] Response: ${JSON.stringify(response.data)}`);

      return response.data as VNPayQueryDRResponseDto;
    } catch (error) {
      this.logger.error(`[Query DR] ❌ Error: ${error.message}`);
      throw new BadRequestException('Failed to query transaction from VNPay');
    }
  }

  /**
   * Process refund transaction via VNPay API
   * Based on vnpay_nodejs/routes/order.js - refund
   * 
   * @param dto - Refund parameters
   * @param ipAddr - Client IP address
   * @returns VNPay API response
   */
  async processRefund(
    dto: RefundTransactionDto,
    ipAddr: string
  ): Promise<VNPayRefundResponseDto> {
    try {
      const config = this.getVNPayConfig();

      this.logger.log(`[Refund] Order: ${dto.orderId}, Amount: ${dto.amount} VND`);

      const date = new Date();
      const vnp_RequestId = generateVNPayRequestId();
      const vnp_Version = '2.1.0';
      const vnp_Command = 'refund';
      const vnp_TmnCode = config.vnp_TmnCode;
      const vnp_TransactionType = dto.transactionType; // 02: Full, 03: Partial
      const vnp_TxnRef = dto.orderId;
      const vnp_Amount = dto.amount * 100; // Convert to smallest unit
      const vnp_OrderInfo = `Hoan tien GD ma:${vnp_TxnRef}`;
      const vnp_TransactionNo = '0'; // Set to 0 if not known
      const vnp_TransactionDate = dto.transactionDate;
      const vnp_CreateBy = dto.createdBy;
      const vnp_CreateDate = formatVNPayDate(date);
      const vnp_IpAddr = ipAddr;

      // Create signature data (specific format for Refund)
      const data = [
        vnp_RequestId,
        vnp_Version,
        vnp_Command,
        vnp_TmnCode,
        vnp_TransactionType,
        vnp_TxnRef,
        vnp_Amount,
        vnp_TransactionNo,
        vnp_TransactionDate,
        vnp_CreateBy,
        vnp_CreateDate,
        vnp_IpAddr,
        vnp_OrderInfo,
      ].join('|');

      const hmac = crypto.createHmac('sha512', config.vnp_HashSecret);
      const vnp_SecureHash = hmac.update(Buffer.from(data, 'utf-8')).digest('hex');

      const requestBody = {
        vnp_RequestId,
        vnp_Version,
        vnp_Command,
        vnp_TmnCode,
        vnp_TransactionType,
        vnp_TxnRef,
        vnp_Amount: vnp_Amount.toString(),
        vnp_TransactionNo,
        vnp_CreateBy,
        vnp_OrderInfo,
        vnp_TransactionDate,
        vnp_CreateDate,
        vnp_IpAddr,
        vnp_SecureHash,
      };

      this.logger.debug(`[Refund] Request body: ${JSON.stringify(requestBody)}`);

      // Call VNPay API
      const response = await axios.post(config.vnp_Api, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      this.logger.log(`[Refund] ✅ Response received`);
      this.logger.debug(`[Refund] Response: ${JSON.stringify(response.data)}`);

      return response.data as VNPayRefundResponseDto;
    } catch (error) {
      this.logger.error(`[Refund] ❌ Error: ${error.message}`);
      throw new BadRequestException('Failed to process refund with VNPay');
    }
  }

  /**
   * Get response description for VNPay response code
   */
  getResponseDescription(code: string): string {
    return getVNPayResponseDescription(code);
  }

  /**
   * Check if response code indicates success
   */
  isSuccessCode(code: string): boolean {
    return code === VNPayResponseCode.SUCCESS;
  }
}

