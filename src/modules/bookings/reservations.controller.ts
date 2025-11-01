import {
  Controller,
  Get,
  Query,
  Logger,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Response } from 'express';
import * as crypto from 'crypto';
import * as qs from 'qs';

/**
 * Reservations Controller for VNPay callbacks
 * Handles payment return URLs from VNPay
 */
@ApiTags('Reservations')
@Controller('api/reservations')
export class ReservationsController {
  private readonly logger = new Logger(ReservationsController.name);

  constructor(
    private readonly configService: ConfigService,
  ) {}

  /**
   * VNPay return callback endpoint
   * This endpoint is called by VNPay after payment processing
   */
  @Get('vnpay_return')
  @ApiOperation({
    summary: 'VNPay payment return callback',
    description: 'Handles VNPay payment return after user completes payment'
  })
  @ApiResponse({
    status: 200,
    description: 'Payment verification result'
  })
  async verifyVNPayReturn(@Query() query: any, @Res() res: Response) {
    try {
      this.logger.log('[VNPay Return] Received callback from VNPay');
      this.logger.debug(`[VNPay Return] Query params: ${JSON.stringify(query)}`);

      const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
      
      if (!vnp_HashSecret) {
        this.logger.error('[VNPay Return] Hash secret not configured');
        return res.redirect(`${this.configService.get('FRONTEND_URL')}/payment/error?message=Configuration error`);
      }

      // Trim whitespace
      const hashSecret = vnp_HashSecret.trim();

      // Extract secure hash from query for verification
      const secureHash = query['vnp_SecureHash'];
      const queryForVerification = { ...query };
      delete queryForVerification['vnp_SecureHash'];
      delete queryForVerification['vnp_SecureHashType'];

      // Sort parameters and create sign data
      const sortedParams = Object.keys(queryForVerification)
        .sort()
        .reduce((acc, key) => {
          acc[key] = queryForVerification[key];
          return acc;
        }, {} as Record<string, string>);

      const signData = qs.stringify(sortedParams, { encode: false });
      
      // Calculate signature
      const hmac = crypto.createHmac('sha512', hashSecret);
      const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

      this.logger.debug(`[VNPay Return] Sign data: ${signData}`);
      this.logger.debug(`[VNPay Return] Calculated signature: ${signed}`);
      this.logger.debug(`[VNPay Return] Received signature: ${secureHash}`);

      if (secureHash === signed) {
        const vnp_ResponseCode = query['vnp_ResponseCode'];
        const vnp_TxnRef = query['vnp_TxnRef']; // Order ID

        this.logger.log(`[VNPay Return] Signature valid for order: ${vnp_TxnRef}`);

        // Redirect to frontend with ALL query params from VNPay
        // Frontend will call /payments/verify-vnpay with these params
        // IMPORTANT: Use encode: false to preserve exact params format
        const frontendUrl = this.configService.get('FRONTEND_URL');
        const queryString = qs.stringify(query, { encode: false });
        
        this.logger.log(`[VNPay Return] Redirecting to frontend with query params`);
        return res.redirect(`${frontendUrl}/payments/vnpay/return?${queryString}`);
        
      } else {
        // Invalid signature
        this.logger.error('[VNPay Return] INVALID SIGNATURE');
        this.logger.error(`[VNPay Return] Expected: ${signed}`);
        this.logger.error(`[VNPay Return] Received: ${secureHash}`);
        
        return res.redirect(
          `${this.configService.get('FRONTEND_URL')}/payment/error?message=Invalid signature`
        );
      }
    } catch (error) {
      this.logger.error(`[VNPay Return] Error: ${error.message}`, error.stack);
      return res.redirect(
        `${this.configService.get('FRONTEND_URL')}/payment/error?message=Server error`
      );
    }
  }
}
