# PAYOS IMPLEMENTATION REPORT

**Ngày tạo:** 2025-12-03 13:08:41  
**Dự án:** SportZone Backend  
**Mục đích:** Báo cáo về implementation PayOS hiện tại trong hệ thống

---

## 📋 TỔNG QUAN

PayOS đã được tích hợp vào hệ thống SportZone để xử lý các thanh toán online. Hiện tại PayOS được sử dụng cho:
1. ✅ **Booking Payments** - Thanh toán đặt sân
2. ✅ **Bank Account Verification** - Xác minh tài khoản ngân hàng của field owner

---

## 🏗️ KIẾN TRÚC IMPLEMENTATION

### 1. **PayOSService** (`src/modules/transactions/payos.service.ts`)

**Chức năng:** Service chính để tương tác với PayOS API v2.

**Methods:**

#### `createPaymentUrl(dto: CreatePayOSUrlDto)`
- Tạo payment link từ PayOS
- Hỗ trợ custom orderCode hoặc auto-generate
- Validate amount và items
- Tạo signature theo PayOS spec

**Flow:**
```88:193:sport-zone/src/modules/transactions/payos.service.ts
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
```

#### `verifyCallback(data, signature)`
- Verify webhook/callback signature
- Hỗ trợ multiple signature formats (backward compatibility)
- Validate webhook data structure

#### `queryTransaction(orderCode)`
- Query transaction status từ PayOS API
- Validate order code format
- Return transaction details

#### `cancelTransaction(orderCode, reason?)`
- Cancel transaction trên PayOS
- Hỗ trợ cancellation reason

---

### 2. **PayOS Utilities** (`src/modules/transactions/utils/payos.utils.ts`)

**Các hàm helper:**

#### `createPayOSSignature(data, checksumKey)`
- Tạo HMAC SHA256 signature
- Sort keys alphabetically
- Format: `key1=value1&key2=value2`

#### `verifyPayOSSignature(data, signature, checksumKey)`
- Verify signature với multiple strategies
- Hỗ trợ backward compatibility
- Try multiple payload formats

#### `generatePayOSOrderCode()`
- Generate unique order code (15 digits)
- Format: `YYMMDDHHMMSS + 3 random digits`
- Đảm bảo trong safe integer range

#### `formatPayOSAmount(amount)`
- Format amount thành positive integer
- Floor để loại bỏ decimals

---

### 3. **Transaction Entity** (`src/modules/transactions/entities/transaction.entity.ts`)

**Fields liên quan PayOS:**

```typescript
// External transaction ID (PayOS orderCode)
@Prop({ type: String, unique: true, sparse: true })
externalTransactionId?: string;

// Metadata có thể chứa PayOS data
@Prop({ type: Object })
metadata?: Record<string, any>;
```

**Transaction Types hỗ trợ:**
- `PAYMENT` - Thanh toán thông thường
- `REFUND_FULL` / `REFUND_PARTIAL` - Hoàn tiền
- `PAYOUT` - Chi trả
- `FEE` - Phí hệ thống
- `ADJUSTMENT` - Điều chỉnh

---

### 4. **Endpoints** (`src/modules/transactions/transactions.controller.ts`)

#### `POST /transactions/payos/create-payment`
**Mục đích:** Tạo PayOS payment link

**Flow:**
1. Nhận `orderId` (transaction ID hoặc booking ID)
2. Tìm transaction trong database
3. Lấy hoặc generate orderCode
4. Tạo PayOS payment link
5. Return checkout URL và QR code

**Đặc điểm:**
- ✅ Hỗ trợ lookup theo transaction ID hoặc booking ID
- ✅ Reuse existing orderCode nếu có
- ✅ Auto-generate orderCode nếu chưa có

#### `POST /transactions/payos/webhook`
**Mục đích:** Server-to-server callback từ PayOS

**Flow:**
1. Verify signature
2. Tìm transaction theo `externalTransactionId` (orderCode)
3. Check idempotency (đã xử lý chưa)
4. Update transaction status
5. Emit events (`payment.success` hoặc `payment.failed`)

**Đặc điểm:**
- ✅ Xử lý bank account verification payments
- ✅ Xử lý booking payments
- ✅ Idempotency check
- ✅ Event emission

#### `GET /transactions/payos/return`
**Mục đích:** Return URL khi user quay lại từ PayOS

**Flow:**
1. Query transaction từ PayOS API
2. Tìm local transaction
3. Update status nếu cần
4. Emit events
5. Return status cho frontend

#### `GET /transactions/payos/query/:orderCode`
**Mục đích:** Query transaction status

#### `POST /transactions/payos/cancel/:orderCode`
**Mục đích:** Cancel transaction

---

## 📍 CÁC VỊ TRÍ SỬ DỤNG

### 1. **Booking Payments**

**Location:** `src/modules/bookings/bookings.service.ts`

**Flow:**
1. User tạo booking với `PaymentMethod.PAYOS`
2. Generate orderCode
3. Tạo transaction với `externalTransactionId = orderCode`
4. Tạo PayOS payment link
5. User thanh toán trên PayOS
6. Webhook update transaction status
7. Event `payment.success` trigger booking confirmation

**Code:**
```474:490:sport-zone/src/modules/bookings/bookings.service.ts
        // ✅ CRITICAL: Generate PayOS orderCode if using PayOS payment method
        let externalTransactionId: string | undefined = undefined;
        
        if (bookingData.paymentMethod === PaymentMethod.PAYOS) {
          // Import generatePayOSOrderCode at top of file if not already imported
          const { generatePayOSOrderCode } = await import('../transactions/utils/payos.utils');
          externalTransactionId = generatePayOSOrderCode().toString();
          this.logger.log(`Generated PayOS orderCode: ${externalTransactionId} for booking ${createdBooking._id}`);
        }

        // Create payment transaction
        const paymentTransaction = await this.transactionsService.createPayment(
          {
            bookingId: (createdBooking._id as any).toString(),
            userId: userId,
            amount: totalPrice,
            method: bookingData.paymentMethod || PaymentMethod.CASH,
            paymentNote: bookingData.note || null,
            externalTransactionId, // ✅ Pass PayOS orderCode
          },
          session
        );
```

### 2. **Bank Account Verification**

**Location:** `src/modules/field-owner/field-owner.service.ts`

**Mục đích:** Xác minh tài khoản ngân hàng của field owner bằng cách tạo payment 10,000 VND.

**Flow:**
1. Field owner thêm bank account
2. Tạo PayOS payment link với description `BANKACCVERIFY`
3. Field owner thanh toán 10,000 VND
4. Webhook detect verification payment
5. Update bank account status và lưu account name từ PayOS

**Code:**
```1632:1748:sport-zone/src/modules/field-owner/field-owner.service.ts
  /**
   * Creates a PayOS payment link (10,000 VND) to verify bank account ownership
   * Field owner will pay this amount, and PayOS will return the account name
   * that matches the bank account number
   */
  async createBankAccountVerificationPayment(
    fieldOwnerId: string,
    bankAccountId: string
  ): Promise<{ paymentLink: string; orderCode: number; qrCode?: string }> {
    try {
      // Get field owner and bank account
      const fieldOwner = await this.userModel.findById(fieldOwnerId);
      if (!fieldOwner) {
        throw new NotFoundException('Field owner not found');
      }

      const bankAccount = await this.bankAccountModel.findById(bankAccountId);
      if (!bankAccount) {
        throw new NotFoundException('Bank account not found');
      }

      // Verify ownership
      if (bankAccount.fieldOwner.toString() !== fieldOwnerId) {
        throw new ForbiddenException('Bank account does not belong to this field owner');
      }

      // Check if already verified
      if (bankAccount.isValidatedByPayOS) {
        throw new BadRequestException('Bank account is already verified');
      }

      // Generate PayOS order code
      const orderCode = generatePayOSOrderCode();

      // Get frontend URL for return/cancel URLs
      const frontendUrl = this.configService.get<string>('app.frontendUrl');
      if (!frontendUrl) {
        throw new BadRequestException(
          'app.frontendUrl is not configured. Cannot build PayOS return/cancel URL for bank account verification.',
        );
      }

      // Create transaction record for verification payment
      const verificationTransaction = await this.transactionsService.createPayment({
        bookingId: null, // Not a booking payment
        userId: fieldOwnerId,
        amount: 10000, // 10,000 VND verification fee
        method: PaymentMethod.PAYOS,
        paymentNote: `Bank account verification: ${bankAccount.accountNumber}`,
        externalTransactionId: orderCode.toString(), // Store PayOS orderCode
      });

      // Create PayOS payment link
      // Note: PayOS requires description to be max 25 characters
      const paymentLink = await this.payosService.createPaymentUrl({
        orderId: verificationTransaction._id.toString(),
        amount: 10000,
        description: 'BANKACCVERIFY', // Prefix để webhook detect
        // Format: "BANKACCVERIFY" (no underscore - PayOS may strip special chars)
        items: [
          {
            name: 'Bank Account Verification',
            quantity: 1,
            price: 10000,
          },
        ],
        buyerName: fieldOwner.fullName,
        buyerEmail: fieldOwner.email,
        buyerPhone: fieldOwner.phone,
        returnUrl: `${frontendUrl}/field-owner/bank-accounts/verify/return`,
        cancelUrl: `${frontendUrl}/field-owner/bank-accounts/verify/cancel`,
        orderCode: orderCode, // Use generated orderCode
      });

      // Update bank account with order code for tracking
      await this.bankAccountModel.findByIdAndUpdate(bankAccountId, {
        verificationOrderCode: orderCode,
        verificationTransactionId: verificationTransaction._id.toString(),
      });

      return {
        paymentLink: paymentLink.checkoutUrl,
        orderCode: orderCode,
        qrCode: paymentLink.qrCodeUrl,
      };
    } catch (error) {
      this.logger.error('Error creating bank account verification payment', error);
      throw error;
    }
  }

  /**
   * Process verification webhook from PayOS
   * Updates bank account status based on verification payment result
   */
  async processVerificationWebhook(
    orderCode: number,
    webhookData: {
      counterAccountNumber?: string;
      counterAccountName?: string;
      amount: number;
      status: string;
      reference?: string;
      transactionDateTime?: string;
    }
  ): Promise<void> {
    try {
      // Find bank account by verification order code
      const bankAccount = await this.bankAccountModel.findOne({
        verificationOrderCode: orderCode,
      });

      if (!bankAccount) {
        this.logger.warn(`[Verification Webhook] Bank account not found for orderCode: ${orderCode}`);
        return;
      }

      // Find transaction
      const transaction = await this.transactionsService.getPaymentByExternalId(
        String(orderCode)
      );

      if (transaction) {
        // Update transaction status
        const newStatus = webhookData.status === 'PAID' 
          ? TransactionStatus.SUCCEEDED 
          : TransactionStatus.FAILED;

        await this.transactionsService.updatePaymentStatus(
          (transaction._id as any).toString(),
          newStatus,
          undefined,
          {
            // Update PayOS metadata
            payosOrderCode: orderCode,
            payosAccountNumber: webhookData.counterAccountNumber,
            payosReference: webhookData.reference || 'PayOS Webhook',
            payosTransactionDateTime: webhookData.transactionDateTime,
          }
        );
      }

      // Update bank account based on verification result
      if (webhookData.status === 'PAID') {
        // Verification successful
        // Check if account number matches
        const accountNumberMatches = webhookData.counterAccountNumber === bankAccount.accountNumber;

        if (accountNumberMatches) {
          // Account number matches - verification successful
          bankAccount.isValidatedByPayOS = true;
          bankAccount.accountNameFromPayOS = webhookData.counterAccountName;
        } else {
          // Account number doesn't match - might be wrong account
          // Still mark as validated but log warning
          this.logger.warn(
            `[Verification Webhook] Account number mismatch. ` +
            `Expected: ${bankAccount.accountNumber}, ` +
            `Got: ${webhookData.counterAccountNumber}`
          );
          bankAccount.isValidatedByPayOS = true;
          bankAccount.accountNameFromPayOS = webhookData.counterAccountName;
        }
      } else {
        // Verification failed or cancelled
        bankAccount.isValidatedByPayOS = false;
        bankAccount.accountNameFromPayOS = undefined;
      }

      await bankAccount.save();

      this.logger.log(
        `[Verification Webhook] Bank account ${bankAccount._id} verification status updated: ${bankAccount.isValidatedByPayOS}`
      );
    } catch (error) {
      this.logger.error('Error processing verification webhook', error);
      throw error;
    }
  }
```

---

## ⚠️ VẤN ĐỀ VÀ HẠN CHẾ

### 1. **Order Code Management**

**Vấn đề:** Cần đảm bảo orderCode được quản lý nhất quán.

**Giải pháp hiện tại:**
- ✅ Generate orderCode trước khi tạo transaction
- ✅ Lưu vào `externalTransactionId`
- ✅ Pass vào `createPaymentUrl()`

**Khuyến nghị:**
- Tạo helper function để đảm bảo consistency
- Validate orderCode uniqueness

### 2. **Description Length Limit**

**Vấn đề:** PayOS giới hạn description 25 characters.

**Giải pháp:**
- ✅ Sử dụng prefix ngắn gọn (`BANKACCVERIFY`, `Sub`, `Tournament`)
- ⚠️ Cần truncate nếu vượt quá

**Khuyến nghị:**
- Tạo helper function để format description
- Validate length trước khi gửi

### 3. **Webhook Reliability**

**Vấn đề:** Webhook có thể fail hoặc bị delay.

**Giải pháp hiện tại:**
- ✅ Return URL handler như backup
- ✅ Idempotency check
- ✅ Event emission

**Khuyến nghị:**
- Implement retry mechanism
- Add webhook logging/monitoring

### 4. **Error Handling**

**Vấn đề:** Cần handle errors tốt hơn.

**Giải pháp hiện tại:**
- ✅ Try-catch trong service methods
- ✅ Logging chi tiết
- ✅ Throw BadRequestException với message rõ ràng

**Khuyến nghị:**
- Create custom PayOS exceptions
- Add error recovery mechanisms

---

## ✅ BEST PRACTICES ĐANG ĐƯỢC ÁP DỤNG

1. ✅ **Order Code Consistency** - Luôn generate và lưu orderCode trước
2. ✅ **Idempotency** - Check transaction status trước khi update
3. ✅ **Event-Driven** - Sử dụng events để decouple business logic
4. ✅ **Logging** - Logging chi tiết cho debugging
5. ✅ **Signature Verification** - Verify tất cả webhooks/callbacks
6. ✅ **Error Handling** - Try-catch và error messages rõ ràng

---

## 🔧 KHUYẾN NGHỊ CẢI THIỆN

### 1. **Tạo PayOS Helper Service**

```typescript
@Injectable()
export class PayOSHelperService {
  async createPaymentWithTransaction(
    userId: string,
    amount: number,
    description: string,
    items: PayOSItemDto[],
    metadata?: Record<string, any>
  ): Promise<{ transaction: Transaction; paymentLink: PayOSPaymentLinkResponseDto }> {
    // Generate orderCode
    const orderCode = generatePayOSOrderCode();
    
    // Create transaction
    const transaction = await this.transactionsService.createPayment({
      bookingId: null,
      userId,
      amount,
      method: PaymentMethod.PAYOS,
      externalTransactionId: orderCode.toString(),
      paymentNote: description,
    });
    
    // Create payment link
    const paymentLink = await this.payosService.createPaymentUrl({
      orderId: transaction._id.toString(),
      amount,
      description: this.formatDescription(description), // Helper to truncate
      items,
      orderCode,
    });
    
    return { transaction, paymentLink };
  }
  
  private formatDescription(description: string): string {
    const MAX_LENGTH = 25;
    return description.length > MAX_LENGTH 
      ? description.substring(0, MAX_LENGTH - 3) + '...'
      : description;
  }
}
```

### 2. **Add Payment Status Polling**

```typescript
@Injectable()
export class PayOSPollingService {
  async pollPaymentStatus(
    transactionId: string,
    maxAttempts: number = 10,
    intervalMs: number = 3000
  ): Promise<TransactionStatus> {
    const transaction = await this.transactionsService.getPaymentById(transactionId);
    
    if (!transaction?.externalTransactionId) {
      throw new BadRequestException('Transaction has no PayOS order code');
    }
    
    for (let i = 0; i < maxAttempts; i++) {
      const payosTransaction = await this.payosService.queryTransaction(
        Number(transaction.externalTransactionId)
      );
      
      if (payosTransaction.status === 'PAID') {
        return TransactionStatus.SUCCEEDED;
      }
      
      if (payosTransaction.status === 'CANCELLED' || payosTransaction.status === 'EXPIRED') {
        return TransactionStatus.FAILED;
      }
      
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    return TransactionStatus.PENDING;
  }
}
```

### 3. **Add Payment Analytics**

```typescript
@Injectable()
export class PayOSAnalyticsService {
  async getPaymentStats(
    startDate: Date,
    endDate: Date
  ): Promise<{
    totalPayments: number;
    totalAmount: number;
    successRate: number;
    averageAmount: number;
  }> {
    const transactions = await this.transactionModel.find({
      method: PaymentMethod.PAYOS,
      createdAt: { $gte: startDate, $lte: endDate },
    });
    
    const totalPayments = transactions.length;
    const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);
    const succeeded = transactions.filter(t => t.status === TransactionStatus.SUCCEEDED).length;
    const successRate = totalPayments > 0 ? (succeeded / totalPayments) * 100 : 0;
    const averageAmount = totalPayments > 0 ? totalAmount / totalPayments : 0;
    
    return {
      totalPayments,
      totalAmount,
      successRate,
      averageAmount,
    };
  }
}
```

---

## 📊 TÓM TẮT

### ✅ Điểm mạnh:
- Implementation đầy đủ và hoàn chỉnh
- Hỗ trợ cả booking và non-booking payments
- Webhook và return URL handlers
- Event-driven architecture
- Error handling và logging tốt

### ⚠️ Điểm cần cải thiện:
- Cần helper service để đơn giản hóa usage
- Cần payment status polling
- Cần analytics/monitoring
- Cần better error recovery

### 🎯 Priority Actions:
1. **HIGH:** Tạo PayOSHelperService để đơn giản hóa usage
2. **MEDIUM:** Add payment status polling
3. **MEDIUM:** Add analytics/monitoring
4. **LOW:** Improve error recovery mechanisms

---

**Người tạo:** AI Assistant  
**Ngày:** 2025-12-03 13:08:41

