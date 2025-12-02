import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import {
    createPayOSSignature,
    verifyPayOSSignature,
    generatePayOSOrderCode,
    getPayOSResponseDescription,
    isValidPayOSOrderCode,
    formatPayOSAmount,
    validatePayOSWebhookData,
} from './utils/payos.utils';
import {
    CreatePayOSUrlDto,
    PayOSCallbackDto,
    QueryPayOSTransactionDto,
    CancelPayOSTransactionDto,
    PayOSPaymentLinkResponseDto,
    PayOSTransactionQueryResponseDto,
    PayOSCancelResponseDto,
} from './dto/payos.dto';

@Injectable()
export class PayOSService {
    private readonly logger = new Logger(PayOSService.name);
    private readonly PAYOS_API_URL = 'https://api-merchant.payos.vn/v2';

    constructor(private readonly configService: ConfigService) { }

    /**
     * Get PayOS configuration from environment
     */
    private getPayOSConfig() {
        const clientId = this.configService.get<string>('PAYOS_CLIENT_ID');
        const apiKey = this.configService.get<string>('PAYOS_API_KEY');
        const checksumKey = this.configService.get<string>('PAYOS_CHECKSUM_KEY');
        const returnUrl = this.configService.get<string>('PAYOS_RETURN_URL');
        const cancelUrl = this.configService.get<string>('PAYOS_CANCEL_URL');

        // Check missing configurations
        const missingConfigs: string[] = [];
        if (!clientId) missingConfigs.push('PAYOS_CLIENT_ID');
        if (!apiKey) missingConfigs.push('PAYOS_API_KEY');
        if (!checksumKey) missingConfigs.push('PAYOS_CHECKSUM_KEY');

        if (missingConfigs.length > 0) {
            this.logger.error(`[PayOS Config] âŒ Missing required environment variables: ${missingConfigs.join(', ')}`);
            throw new BadRequestException(`PayOS is not configured. Missing: ${missingConfigs.join(', ')}`);
        }

        // Log configuration status (without exposing secrets)
        this.logger.debug(`[PayOS Config] âœ… Configuration loaded`);
        this.logger.debug(`[PayOS Config]   - Client ID: ${clientId!.substring(0, 4)}****`);
        this.logger.debug(`[PayOS Config]   - API Key: ${apiKey!.length} chars`);
        this.logger.debug(`[PayOS Config]   - Checksum Key: ${checksumKey!.length} chars`);
        this.logger.debug(`[PayOS Config]   - Checksum Key (first 4): ${checksumKey!.substring(0, 4)}...`);
        this.logger.debug(`[PayOS Config]   - Checksum Key (last 4): ...${checksumKey!.substring(checksumKey!.length - 4)}`);
        this.logger.debug(`[PayOS Config]   - Checksum Key has whitespace: ${checksumKey!.trim() !== checksumKey}`);
        this.logger.debug(`[PayOS Config]   - Return URL: ${returnUrl || 'default'}`);
        this.logger.debug(`[PayOS Config]   - Cancel URL: ${cancelUrl || 'default'}`);

        return {
            clientId: clientId!.trim(),
            apiKey: apiKey!.trim(),
            checksumKey: checksumKey!.trim(),
            returnUrl: returnUrl?.trim() || 'http://localhost:5173/transactions/payos/return',
            cancelUrl: cancelUrl?.trim() || 'http://localhost:5173/transactions/payos/cancel',
        };
    }

    /**
     * Get API headers for PayOS requests
     */
    private getHeaders(config: ReturnType<typeof this.getPayOSConfig>) {
        return {
            'x-client-id': config.clientId,
            'x-api-key': config.apiKey,
            'Content-Type': 'application/json',
        };
    }

    /**
     * Create PayOS payment URL
     * 
     * @param dto - Payment parameters
     * @returns Payment link response with checkout URL
     */
    async createPaymentUrl(dto: CreatePayOSUrlDto): Promise<PayOSPaymentLinkResponseDto> {
        try {
            const config = this.getPayOSConfig();

            this.logger.log(`[Create Payment URL] Order: ${dto.orderId}, Amount: ${dto.amount} VND`);

            // ✅ FIX: Use orderCode from DTO if provided, otherwise generate new one
            let orderCode: number;
            if (dto.orderCode) {
                orderCode = dto.orderCode;
                this.logger.log(`[Create Payment URL] Using provided orderCode: ${orderCode}`);
            } else {
                orderCode = generatePayOSOrderCode();
                this.logger.log(`[Create Payment URL] Generated new orderCode: ${orderCode}`);
            }

            // Calculate total from items
            const calculatedAmount = dto.items.reduce((sum, item) => sum + (item.quantity * item.price), 0);
            if (calculatedAmount !== dto.amount) {
                this.logger.warn(`[Create Payment URL] Amount mismatch: expected ${dto.amount}, calculated ${calculatedAmount}`);
            }

            // Prepare payment data
            const expiredAt = dto.expiredAt ? Math.floor(Date.now() / 1000) + dto.expiredAt * 60 : undefined;

            const basePayload = {
                orderCode,
                amount: formatPayOSAmount(dto.amount),
                description: dto.description,
                returnUrl: dto.returnUrl || config.returnUrl,
                cancelUrl: dto.cancelUrl || config.cancelUrl,
            };

            const signature = createPayOSSignature(basePayload, config.checksumKey);

            const paymentData: any = {
                ...basePayload,
                items: dto.items.map((item) => ({
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price,
                })),
                signature,
            };

            if (dto.buyerName) paymentData.buyerName = dto.buyerName;
            if (dto.buyerEmail) paymentData.buyerEmail = dto.buyerEmail;
            if (dto.buyerPhone) paymentData.buyerPhone = dto.buyerPhone;
            if (expiredAt) paymentData.expiredAt = expiredAt;

            this.logger.debug(`[Create Payment URL] Signature payload: ${JSON.stringify({ ...basePayload, signature: '***' })}`);
            this.logger.debug(`[Create Payment URL] Request data: ${JSON.stringify({ ...paymentData, signature: '***' })}`);
            const response = await axios.post(
                `${this.PAYOS_API_URL}/payment-requests`,
                paymentData,
                {
                    headers: this.getHeaders(config),
                    timeout: 30000,
                }
            );

            if (response.data.code !== '00') {
                const errorMsg = response.data.desc || response.data.message || 'Unknown error';
                this.logger.error(`[Create Payment URL] PayOS API error: ${errorMsg}`);
                this.logger.debug(`[Create Payment URL] PayOS response: ${JSON.stringify(response.data)}`);
                throw new BadRequestException(`PayOS error: ${errorMsg}`);
            }

            const result = response.data.data;

            this.logger.log(`[Create Payment URL] âœ… Payment link created successfully`);
            this.logger.debug(`[Create Payment URL] Payment Link ID: ${result.paymentLinkId}`);

            return {
                paymentLinkId: result.paymentLinkId,
                checkoutUrl: result.checkoutUrl,
                qrCodeUrl: result.qrCode || '',
                orderCode: result.orderCode,
                amount: result.amount,
                status: result.status || 'PENDING',
            };
        } catch (error) {
            const errorMessage = this.extractErrorMessage(error);
            this.logger.error(`[Create Payment URL] âŒ Error: ${errorMessage}`);

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.data) {
                    const responseData = axiosError.response.data as any;
                    this.logger.error(`[Create Payment URL] PayOS API Response: ${JSON.stringify(responseData)}`);

                    // Return detailed error message from PayOS
                    if (responseData.desc || responseData.message) {
                        throw new BadRequestException(`PayOS error: ${responseData.desc || responseData.message}`);
                    }
                }
            }

            // If it's already a BadRequestException, re-throw it
            if (error instanceof BadRequestException) {
                throw error;
            }

            throw new BadRequestException(`Failed to create PayOS payment link: ${errorMessage}`);
        }
    }

    /**
     * Verify PayOS callback/webhook signature
     * 
     * @param data - Callback data from PayOS (WITHOUT signature field)
     * @param receivedSignature - Signature from webhook/return URL
     * @returns Verification result with extracted data
     */
    verifyCallback(
        data: Omit<PayOSCallbackDto, 'signature'>,
        receivedSignature: string
    ): {
        isValid: boolean;
        data: {
            orderCode: number;
            amount: number;
            description: string;
            accountNumber: string;
            reference: string;
            transactionDateTime: string;
        };
    } {
        try {
            const config = this.getPayOSConfig();

            this.logger.log(`[Verify Callback] Order Code: ${data.orderCode}`);

            // Validate webhook data structure
            if (!validatePayOSWebhookData(data)) {
                this.logger.warn(`[Verify Callback] Invalid webhook data structure`);
                return {
                    isValid: false,
                    data: {
                        orderCode: 0,
                        amount: 0,
                        description: '',
                        accountNumber: '',
                        reference: '',
                        transactionDateTime: '',
                    },
                };
            }

            // Verify signature - data does NOT contain signature field
            const isValid = verifyPayOSSignature(data, receivedSignature, config.checksumKey);

            const result = {
                isValid,
                data: {
                    orderCode: data.orderCode,
                    amount: data.amount,
                    description: data.description,
                    accountNumber: data.accountNumber,
                    reference: data.reference,
                    transactionDateTime: data.transactionDateTime,
                },
            };

            if (isValid) {
                this.logger.log(`[Verify Callback] Signature verified for order ${data.orderCode}`);
            } else {
                this.logger.warn(`[Verify Callback] Invalid signature for order ${data.orderCode}`);
            }

            return result;
        } catch (error) {
            this.logger.error(`[Verify Callback] Error: ${error.message}`);
            return {
                isValid: false,
                data: {
                    orderCode: 0,
                    amount: 0,
                    description: '',
                    accountNumber: '',
                    reference: '',
                    transactionDateTime: '',
                },
            };
        }
    }

    /**
     * Query transaction status from PayOS
     * 
     * @param orderCode - Order code to query
     * @returns Transaction details
     */
    async queryTransaction(orderCode: number): Promise<PayOSTransactionQueryResponseDto> {
        try {
            const config = this.getPayOSConfig();

            // Validate order code
            if (!isValidPayOSOrderCode(orderCode)) {
                throw new BadRequestException('Invalid order code format');
            }

            this.logger.log(`[Query Transaction] Order Code: ${orderCode}`);

            // Call PayOS API
            const response = await axios.get(
                `${this.PAYOS_API_URL}/payment-requests/${orderCode}`,
                {
                    headers: this.getHeaders(config),
                    timeout: 30000,
                }
            );

            if (response.data.code !== '00') {
                throw new BadRequestException(`PayOS error: ${response.data.desc || 'Transaction not found'}`);
            }

            const data = response.data.data;

            this.logger.log(`[Query Transaction] âœ… Transaction found - Status: ${data.status}`);

            return {
                orderCode: data.orderCode,
                amount: data.amount,
                description: data.description,
                status: data.status,
                accountNumber: data.accountNumber,
                reference: data.reference,
                transactionDateTime: data.transactionDateTime,
                createdAt: data.createdAt,
                cancelledAt: data.cancelledAt,
            };
        } catch (error) {
            this.logger.error(`[Query Transaction] âŒ Error: ${this.extractErrorMessage(error)}`);

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.status === 404) {
                    throw new BadRequestException('Transaction not found');
                }
            }

            throw new BadRequestException('Failed to query PayOS transaction');
        }
    }

    /**
     * Cancel PayOS transaction
     * 
     * @param orderCode - Order code to cancel
     * @param reason - Cancellation reason (optional)
     * @returns Cancellation response
     */
    async cancelTransaction(
        orderCode: number,
        reason?: string
    ): Promise<PayOSCancelResponseDto> {
        try {
            const config = this.getPayOSConfig();

            // Validate order code
            if (!isValidPayOSOrderCode(orderCode)) {
                throw new BadRequestException('Invalid order code format');
            }

            this.logger.log(`[Cancel Transaction] Order Code: ${orderCode}`);
            if (reason) {
                this.logger.debug(`[Cancel Transaction] Reason: ${reason}`);
            }

            const requestData: any = {
                orderCode,
            };

            if (reason) {
                requestData.cancellationReason = reason;
            }

            // Call PayOS API
            const response = await axios.post(
                `${this.PAYOS_API_URL}/payment-requests/${orderCode}/cancel`,
                requestData,
                {
                    headers: this.getHeaders(config),
                    timeout: 30000,
                }
            );

            if (response.data.code !== '00') {
                throw new BadRequestException(`PayOS error: ${response.data.desc || 'Cannot cancel transaction'}`);
            }

            this.logger.log(`[Cancel Transaction] âœ… Transaction cancelled successfully`);

            return {
                orderCode,
                status: 'CANCELLED',
                message: response.data.desc || 'Transaction cancelled successfully',
            };
        } catch (error) {
            this.logger.error(`[Cancel Transaction] âŒ Error: ${this.extractErrorMessage(error)}`);

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.status === 404) {
                    throw new BadRequestException('Transaction not found');
                }
                if (axiosError.response?.status === 400) {
                    throw new BadRequestException('Transaction cannot be cancelled (may already be completed or cancelled)');
                }
            }

            throw new BadRequestException('Failed to cancel PayOS transaction');
        }
    }

    /**
     * Get response description by code
     * 
     * @param code - PayOS response code
     * @param locale - Language (vi or en)
     * @returns Description text
     */
    getResponseDescription(code: string, locale: 'vi' | 'en' = 'vi'): string {
        return getPayOSResponseDescription(code);
    }


    /**
     * Extract error message from various error types
     */
    private extractErrorMessage(error: any): string {
        if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.data) {
                const data = axiosError.response.data as any;
                return data.desc || data.message || axiosError.message;
            }
            return axiosError.message;
        }
        return error.message || 'Unknown error';
    }
}