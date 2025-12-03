# PAYOS NON-BOOKING PAYMENT GUIDE

**Ngày tạo:** 2025-12-03 13:08:41  
**Dự án:** SportZone Backend  
**Mục đích:** Hướng dẫn sử dụng PayOS cho các thanh toán ngoài booking

---

## 📋 TỔNG QUAN

Guide này hướng dẫn cách tích hợp PayOS cho các loại thanh toán **ngoài booking** trong hệ thống SportZone, bao gồm:
- Subscription fees (phí đăng ký)
- Tournament registration (đăng ký giải đấu)
- Coach fees (phí huấn luyện viên)
- Premium features (tính năng premium)
- Field owner verification (xác minh chủ sân) - ✅ Đã implement
- Và các loại thanh toán khác

---

## 🏗️ KIẾN TRÚC HIỆN TẠI

### 1. **PayOSService** (`src/modules/transactions/payos.service.ts`)

Service chính để tương tác với PayOS API:

**Methods:**
- `createPaymentUrl(dto: CreatePayOSUrlDto)` - Tạo payment link
- `verifyCallback(data, signature)` - Verify webhook signature
- `queryTransaction(orderCode)` - Query transaction status
- `cancelTransaction(orderCode, reason?)` - Cancel transaction

### 2. **Transaction Entity** (`src/modules/transactions/entities/transaction.entity.ts`)

Hỗ trợ nhiều loại transaction:
- `PAYMENT` - Thanh toán thông thường
- `REFUND_FULL` / `REFUND_PARTIAL` - Hoàn tiền
- `PAYOUT` - Chi trả cho coach/field owner
- `FEE` - Phí hệ thống
- `ADJUSTMENT` - Điều chỉnh thủ công

### 3. **Endpoints** (`src/modules/transactions/transactions.controller.ts`)

- `POST /transactions/payos/create-payment` - Tạo payment link
- `POST /transactions/payos/webhook` - Webhook handler
- `GET /transactions/payos/return` - Return URL handler
- `GET /transactions/payos/query/:orderCode` - Query transaction
- `POST /transactions/payos/cancel/:orderCode` - Cancel transaction

---

## 📝 CÁC BƯỚC TRIỂN KHAI

### Bước 1: Tạo Transaction Record

Trước khi tạo PayOS payment link, bạn cần tạo transaction record trong database:

```typescript
import { TransactionsService } from '../transactions/transactions.service';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { TransactionType } from '../transactions/entities/transaction.entity';
import { generatePayOSOrderCode } from '../transactions/utils/payos.utils';

// 1. Generate PayOS order code
const orderCode = generatePayOSOrderCode();

// 2. Create transaction record
const transaction = await this.transactionsService.createPayment({
  bookingId: null, // Set null nếu không phải booking
  userId: userId,
  amount: amount,
  method: PaymentMethod.PAYOS,
  paymentNote: 'Subscription fee payment',
  externalTransactionId: orderCode.toString(), // ✅ CRITICAL: Store PayOS orderCode
});

// Transaction ID sẽ được dùng làm orderId khi tạo PayOS link
```

### Bước 2: Tạo PayOS Payment Link

Sử dụng transaction ID vừa tạo để tạo PayOS payment link:

```typescript
import { PayOSService } from '../transactions/payos.service';
import { CreatePayOSUrlDto } from '../transactions/dto/payos.dto';

const payosService = new PayOSService(configService);

const dto: CreatePayOSUrlDto = {
  orderId: transaction._id.toString(), // Transaction ID
  amount: amount,
  description: 'Subscription fee', // Max 25 characters
  items: [
    {
      name: 'Premium Subscription',
      quantity: 1,
      price: amount,
    },
  ],
  buyerName: user.fullName,
  buyerEmail: user.email,
  buyerPhone: user.phone,
  returnUrl: 'https://your-domain.com/payment/success',
  cancelUrl: 'https://your-domain.com/payment/cancel',
  expiredAt: 15, // Minutes (5-60, default: 15)
  orderCode: orderCode, // ✅ Use the orderCode from transaction
};

const paymentLink = await payosService.createPaymentUrl(dto);

// Response:
// {
//   paymentLinkId: 'abc123',
//   checkoutUrl: 'https://pay.payos.vn/web/abc123',
//   qrCodeUrl: 'https://pay.payos.vn/qr/abc123',
//   orderCode: 123456789,
//   amount: 200000,
//   status: 'PENDING'
// }
```

### Bước 3: Xử lý Webhook

PayOS sẽ gửi webhook khi payment status thay đổi. Webhook handler đã được implement tại:

`POST /transactions/payos/webhook`

**Webhook sẽ tự động:**
1. Verify signature
2. Tìm transaction theo `externalTransactionId` (orderCode)
3. Update transaction status
4. Emit events (`payment.success` hoặc `payment.failed`)

**Bạn cần:**
- Đăng ký webhook URL trong PayOS portal: `https://your-domain.com/api/transactions/payos/webhook`
- Listen to events để xử lý business logic:

```typescript
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class YourService {
  constructor(private eventEmitter: EventEmitter2) {
    // Listen to payment success
    this.eventEmitter.on('payment.success', async (data) => {
      const { paymentId, userId, amount } = data;
      
      // Xử lý business logic
      // Ví dụ: Activate premium subscription
      await this.activatePremiumSubscription(userId);
    });

    // Listen to payment failed
    this.eventEmitter.on('payment.failed', async (data) => {
      const { paymentId, userId, reason } = data;
      
      // Xử lý khi payment failed
      console.log(`Payment failed: ${reason}`);
    });
  }
}
```

### Bước 4: Xử lý Return URL

Khi user quay lại từ PayOS, frontend sẽ gọi:

`GET /transactions/payos/return?orderCode=123456789&status=PAID`

Return URL handler sẽ:
1. Query transaction từ PayOS
2. Update transaction status
3. Emit events nếu cần
4. Return payment status cho frontend

---

## 💡 VÍ DỤ TRIỂN KHAI

### Ví dụ 1: Subscription Payment

```typescript
@Injectable()
export class SubscriptionService {
  constructor(
    private transactionsService: TransactionsService,
    private payosService: PayOSService,
    private eventEmitter: EventEmitter2,
  ) {}

  async createSubscriptionPayment(userId: string, planId: string) {
    // 1. Get subscription plan details
    const plan = await this.getPlan(planId);
    
    // 2. Generate order code
    const orderCode = generatePayOSOrderCode();
    
    // 3. Create transaction
    const transaction = await this.transactionsService.createPayment({
      bookingId: null, // Not a booking
      userId: userId,
      amount: plan.price,
      method: PaymentMethod.PAYOS,
      paymentNote: `Subscription: ${plan.name}`,
      externalTransactionId: orderCode.toString(),
    });

    // 4. Create PayOS payment link
    const paymentLink = await this.payosService.createPaymentUrl({
      orderId: transaction._id.toString(),
      amount: plan.price,
      description: `Sub ${plan.name}`, // Max 25 chars
      items: [{
        name: plan.name,
        quantity: 1,
        price: plan.price,
      }],
      orderCode: orderCode,
      expiredAt: 15,
    });

    // 5. Listen to payment success event
    this.eventEmitter.once(`payment.success.${transaction._id}`, async (data) => {
      await this.activateSubscription(userId, planId);
    });

    return {
      transactionId: transaction._id.toString(),
      paymentUrl: paymentLink.checkoutUrl,
      qrCode: paymentLink.qrCodeUrl,
    };
  }
}
```

### Ví dụ 2: Tournament Registration

```typescript
@Injectable()
export class TournamentService {
  async createTournamentPayment(userId: string, tournamentId: string) {
    const tournament = await this.getTournament(tournamentId);
    const orderCode = generatePayOSOrderCode();
    
    const transaction = await this.transactionsService.createPayment({
      bookingId: null,
      userId: userId,
      amount: tournament.registrationFee,
      method: PaymentMethod.PAYOS,
      paymentNote: `Tournament: ${tournament.name}`,
      externalTransactionId: orderCode.toString(),
    });

    const paymentLink = await this.payosService.createPaymentUrl({
      orderId: transaction._id.toString(),
      amount: tournament.registrationFee,
      description: `Tournament ${tournament.name.substring(0, 15)}`, // Max 25 chars
      items: [{
        name: `Tournament Registration: ${tournament.name}`,
        quantity: 1,
        price: tournament.registrationFee,
      }],
      orderCode: orderCode,
    });

    // Listen to success event
    this.eventEmitter.once(`payment.success.${transaction._id}`, async () => {
      await this.registerUserToTournament(userId, tournamentId);
    });

    return paymentLink;
  }
}
```

### Ví dụ 3: Coach Fee Payment

```typescript
@Injectable()
export class CoachService {
  async createCoachFeePayment(userId: string, coachId: string, sessionCount: number) {
    const coach = await this.getCoach(coachId);
    const totalFee = coach.hourlyRate * sessionCount;
    const orderCode = generatePayOSOrderCode();
    
    const transaction = await this.transactionsService.createPayment({
      bookingId: null,
      userId: userId,
      amount: totalFee,
      method: PaymentMethod.PAYOS,
      paymentNote: `Coach fee: ${coach.name}`,
      externalTransactionId: orderCode.toString(),
    });

    const paymentLink = await this.payosService.createPaymentUrl({
      orderId: transaction._id.toString(),
      amount: totalFee,
      description: `Coach ${coach.name.substring(0, 15)}`, // Max 25 chars
      items: [{
        name: `Coaching sessions (${sessionCount} sessions)`,
        quantity: sessionCount,
        price: coach.hourlyRate,
      }],
      orderCode: orderCode,
    });

    this.eventEmitter.once(`payment.success.${transaction._id}`, async () => {
      await this.bookCoachSessions(userId, coachId, sessionCount);
    });

    return paymentLink;
  }
}
```

---

## 🔧 CẤU HÌNH

### Environment Variables

Đảm bảo các biến môi trường sau được cấu hình:

```env
# PayOS Configuration
PAYOS_CLIENT_ID=your_client_id
PAYOS_API_KEY=your_api_key
PAYOS_CHECKSUM_KEY=your_checksum_key
PAYOS_RETURN_URL=https://your-domain.com/payment/payos/return
PAYOS_CANCEL_URL=https://your-domain.com/payment/payos/cancel
```

### Webhook Configuration

1. Đăng nhập PayOS portal
2. Vào **Settings** → **Webhook**
3. Thêm webhook URL: `https://your-domain.com/api/transactions/payos/webhook`
4. Chọn events: `payment.paid`, `payment.cancelled`, `payment.expired`

---

## ⚠️ LƯU Ý QUAN TRỌNG

### 1. **Order Code Management**

- ✅ **LUÔN** generate order code TRƯỚC khi tạo transaction
- ✅ **LUÔN** lưu order code vào `externalTransactionId` của transaction
- ✅ **LUÔN** pass order code vào `createPaymentUrl()` để đảm bảo consistency

```typescript
// ✅ CORRECT
const orderCode = generatePayOSOrderCode();
const transaction = await this.transactionsService.createPayment({
  externalTransactionId: orderCode.toString(), // Store first
});
const paymentLink = await this.payosService.createPaymentUrl({
  orderCode: orderCode, // Use same code
});

// ❌ WRONG - Don't let PayOS generate new code
const transaction = await this.transactionsService.createPayment({});
const paymentLink = await this.payosService.createPaymentUrl({
  // Missing orderCode - PayOS will generate new one
});
```

### 2. **Description Length**

PayOS description có giới hạn **25 characters**. Nếu vượt quá, PayOS sẽ tự động truncate.

```typescript
// ✅ GOOD
description: 'Sub Premium Plan' // 17 chars

// ⚠️ WARNING
description: 'Subscription Premium Plan Monthly' // 35 chars - will be truncated
```

### 3. **Transaction Status Flow**

```
PENDING → PROCESSING → SUCCEEDED
                    ↓
                  FAILED
```

- Transaction bắt đầu với status `PENDING`
- Khi PayOS xác nhận payment, status chuyển sang `SUCCEEDED`
- Nếu payment failed/cancelled, status chuyển sang `FAILED`

### 4. **Idempotency**

Webhook có thể được gọi nhiều lần. Handler đã xử lý idempotency:

```typescript
// Check if already processed
if (transaction.status === TransactionStatus.SUCCEEDED || 
    transaction.status === TransactionStatus.FAILED) {
  return { code: '02', desc: 'Transaction already processed' };
}
```

### 5. **Error Handling**

Luôn handle errors khi tạo payment link:

```typescript
try {
  const paymentLink = await this.payosService.createPaymentUrl(dto);
  return paymentLink;
} catch (error) {
  // Log error
  this.logger.error('Failed to create PayOS payment link', error);
  
  // Update transaction status to FAILED
  await this.transactionsService.updatePaymentStatus(
    transaction._id.toString(),
    TransactionStatus.FAILED,
  );
  
  throw new BadRequestException('Failed to create payment link');
}
```

---

## 📊 TESTING

### Test Payment Flow

1. **Tạo test transaction:**
```typescript
const transaction = await this.transactionsService.createPayment({
  bookingId: null,
  userId: 'test_user_id',
  amount: 10000, // 10,000 VND
  method: PaymentMethod.PAYOS,
  externalTransactionId: generatePayOSOrderCode().toString(),
});
```

2. **Tạo payment link:**
```typescript
const paymentLink = await this.payosService.createPaymentUrl({
  orderId: transaction._id.toString(),
  amount: 10000,
  description: 'Test payment',
  items: [{ name: 'Test', quantity: 1, price: 10000 }],
});
```

3. **Test webhook (local):**
```bash
curl -X POST http://localhost:3000/api/transactions/payos/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "orderCode": 123456789,
      "amount": 10000,
      "description": "Test payment",
      "accountNumber": "12345678",
      "reference": "FT123456",
      "transactionDateTime": "2024-12-03 14:30:00",
      "status": "PAID"
    },
    "signature": "test_signature"
  }'
```

---

## 🔍 DEBUGGING

### Logs

PayOSService có logging chi tiết:

```typescript
// Check logs for:
[Create Payment URL] Order: xxx, Amount: xxx VND
[Create Payment URL] Using provided orderCode: xxx
[PayOS Webhook] Received webhook
[PayOS Webhook] ✅ Signature verified
[PayOS Webhook] Transaction updated: SUCCEEDED
```

### Common Issues

1. **Signature verification failed**
   - Check `PAYOS_CHECKSUM_KEY` trong .env
   - Ensure không có whitespace trong checksum key
   - Verify webhook data structure

2. **Transaction not found**
   - Ensure `externalTransactionId` được lưu đúng
   - Check orderCode matching giữa transaction và PayOS

3. **Payment link expired**
   - Default expiration: 15 minutes
   - Có thể extend bằng cách tạo lại payment link với `expiredAt` lớn hơn

---

## 📚 TÀI LIỆU THAM KHẢO

- [PayOS API Documentation](https://payos.vn/docs)
- [PayOS Webhook Guide](https://payos.vn/docs/webhook)
- Transaction Entity: `src/modules/transactions/entities/transaction.entity.ts`
- PayOS Service: `src/modules/transactions/payos.service.ts`
- PayOS Utils: `src/modules/transactions/utils/payos.utils.ts`

---

**Người tạo:** AI Assistant  
**Ngày:** 2025-12-03 13:08:41

