# Phân Tích Vấn Đề Payment Flow

## 🔴 Vấn Đề Chính

Frontend polling 24 lần mà payment status vẫn `pending` sau khi VNPay callback.

## 🔍 Root Cause Analysis

### 1. **Flow Hiện Tại**

```
User thanh toán → VNPay redirect với params 
→ FE nhận returnUrl: /vnpay_return?amount=200000&orderId=6904dd2a6289f3cf36b1dbe3
→ FE polling booking status → Status vẫn pending
```

### 2. **Vấn Đề Được Xác Định**

#### ❌ **CRITICAL: VNPay IPN endpoint KHÔNG được gọi**

Từ code `payments.controller.ts`, endpoint `vnpay-ipn` chỉ được kích hoạt khi:
- VNPay gửi IPN (Instant Payment Notification) đến backend
- IPN là **server-to-server** callback từ VNPay

**Nhưng:**
- returnUrl (`/vnpay_return`) là **browser redirect** cho user
- IPN URL phải được config riêng trong VNPay dashboard
- Nếu IPN URL chưa được setup → VNPay KHÔNG bao giờ gọi endpoint → Payment status KHÔNG bao giờ được update

#### ❌ **Thiếu Event Listener để update Booking status**

Từ `payments.controller.ts` (line 119-130):
```typescript
// Emit payment success event
this.eventEmitter.emit('payment.success', {
  paymentId: (updated._id as any).toString(),
  bookingId: (updated.booking as any)?.toString?.() || updated.booking,
  ...
});
```

**Nhưng:**
- Không có listener nào trong `BookingsService` để lắng nghe event này
- Payment được update nhưng Booking vẫn `pending`

## 🎯 Giải Pháp

### Solution 1: Setup VNPay IPN (RECOMMENDED)

#### A. Config VNPay Dashboard
1. Đăng nhập VNPay merchant portal
2. Vào **Settings → API Configuration**
3. Set IPN URL: `https://your-domain.com/api/payments/vnpay-ipn`
4. Ensure HTTPS và domain accessible từ VNPay servers

#### B. Thêm Event Listener trong BookingsService

**File: `bookings.service.ts`**

Thêm vào constructor:
```typescript
@Injectable()
export class BookingsService {
  constructor(
    // ... existing injections
  ) {
    // Listen to payment events
    this.eventEmitter.on('payment.success', this.handlePaymentSuccess.bind(this));
    this.eventEmitter.on('payment.failed', this.handlePaymentFailed.bind(this));
  }

  /**
   * Handle payment success event
   */
  private async handlePaymentSuccess(event: {
    paymentId: string;
    bookingId: string;
    userId: string;
    amount: number;
  }) {
    try {
      this.logger.log(`Processing payment success for booking ${event.bookingId}`);
      
      const booking = await this.bookingModel.findById(event.bookingId);
      if (!booking) {
        this.logger.error(`Booking ${event.bookingId} not found`);
        return;
      }

      // Update booking status to confirmed
      booking.status = BookingStatus.CONFIRMED;
      booking.payment = new Types.ObjectId(event.paymentId);
      await booking.save();

      this.logger.log(`Booking ${event.bookingId} confirmed after payment success`);

      // Optional: Send confirmation email
      await this.emailService.sendBookingConfirmation(booking);
      
    } catch (error) {
      this.logger.error('Error handling payment success', error);
    }
  }

  /**
   * Handle payment failed event
   */
  private async handlePaymentFailed(event: {
    paymentId: string;
    bookingId: string;
    reason: string;
  }) {
    try {
      this.logger.log(`Processing payment failure for booking ${event.bookingId}`);
      
      const booking = await this.bookingModel.findById(event.bookingId);
      if (!booking) {
        this.logger.error(`Booking ${event.bookingId} not found`);
        return;
      }

      // Cancel booking due to payment failure
      booking.status = BookingStatus.CANCELLED;
      booking.cancellationReason = `Payment failed: ${event.reason}`;
      await booking.save();

      // Release schedule slots
      await this.releaseBookingSlots(booking);

      this.logger.log(`Booking ${event.bookingId} cancelled due to payment failure`);
      
    } catch (error) {
      this.logger.error('Error handling payment failure', error);
    }
  }

  /**
   * Release schedule slots when booking is cancelled
   */
  private async releaseBookingSlots(booking: Booking) {
    try {
      const schedule = await this.scheduleModel.findOne({
        field: booking.field,
        date: booking.date
      });

      if (schedule) {
        schedule.bookedSlots = schedule.bookedSlots.filter(slot => 
          !(slot.startTime === booking.startTime && slot.endTime === booking.endTime)
        );
        await schedule.save();
        this.logger.log(`Released slots for booking ${booking._id}`);
      }
    } catch (error) {
      this.logger.error('Error releasing booking slots', error);
    }
  }
}
```

### Solution 2: Alternative - Check Payment in returnUrl

Nếu không thể setup IPN ngay, tạo endpoint để FE check payment:

**File: `payments.controller.ts`**

```typescript
/**
 * Verify VNPay return and update payment status
 * Called by frontend after redirect from VNPay
 */
@Get('verify-vnpay')
async verifyVNPayReturn(@Query() query: any) {
  const vnp_HashSecret = this.configService.get<string>('vnp_HashSecret');
  if (!vnp_HashSecret) {
    throw new BadRequestException('Payment configuration error');
  }

  const vnp_SecureHash = query.vnp_SecureHash;
  const queryWithoutHash = { ...query };
  delete queryWithoutHash.vnp_SecureHash;
  delete queryWithoutHash.vnp_SecureHashType;

  const sorted = Object.keys(queryWithoutHash)
    .sort()
    .reduce((acc, key) => {
      acc[key] = queryWithoutHash[key];
      return acc;
    }, {} as Record<string, string>);

  const signData = qs.stringify(sorted, { encode: false });
  const hmac = crypto.createHmac('sha512', vnp_HashSecret);
  const signed = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');

  if (signed !== vnp_SecureHash) {
    throw new BadRequestException('Invalid signature');
  }

  const responseCode: string | undefined = query.vnp_ResponseCode;
  const orderId: string | undefined = query.vnp_TxnRef;
  const transactionId: string | undefined = query.vnp_TransactionNo || query.vnp_BankTranNo;

  if (!orderId) {
    throw new BadRequestException('Missing order ID');
  }

  // Get payment
  let payment = await this.paymentsService.getPaymentById(orderId);
  if (!payment) {
    payment = await this.paymentsService.getPaymentByBookingId(orderId);
  }

  if (!payment) {
    throw new NotFoundException('Payment not found');
  }

  // Update payment status
  if (responseCode === '00') {
    const updated = await this.paymentsService.updatePaymentStatus(
      (payment._id as any).toString(),
      PaymentStatus.SUCCEEDED,
      transactionId,
    );

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
    };
  } else {
    const updated = await this.paymentsService.updatePaymentStatus(
      (payment._id as any).toString(),
      PaymentStatus.FAILED,
      transactionId,
    );

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
      reason: `VNPay response ${responseCode}`,
    };
  }
}
```

**Frontend sử dụng:**
```typescript
// In vnpay-return-page.tsx
useEffect(() => {
  const verifyPayment = async () => {
    try {
      const queryParams = new URLSearchParams(window.location.search);
      const response = await fetch(`/api/payments/verify-vnpay?${queryParams.toString()}`);
      const data = await response.json();
      
      if (data.success) {
        // Payment verified, start polling for booking confirmation
        setPaymentVerified(true);
      } else {
        setError(data.reason);
      }
    } catch (error) {
      setError('Failed to verify payment');
    }
  };

  verifyPayment();
}, []);
```

## 📋 Checklist Triển Khai

### Immediate Actions (Ngay lập tức)

- [ ] **Thêm event listeners trong BookingsService** (Solution 1B)
- [ ] **Tạo endpoint `/payments/verify-vnpay`** (Solution 2)
- [ ] **Test flow với VNPay sandbox**

### Setup VNPay IPN (Quan trọng)

- [ ] **Login VNPay merchant portal**
- [ ] **Configure IPN URL**: `https://your-domain.com/api/payments/vnpay-ipn`
- [ ] **Test IPN với VNPay sandbox**
- [ ] **Verify IPN được gọi thành công**

### Code Changes Required

#### 1. `bookings.service.ts`
```typescript
// Add event listeners in constructor
// Add handlePaymentSuccess method
// Add handlePaymentFailed method
// Add releaseBookingSlots method
```

#### 2. `payments.controller.ts`
```typescript
// Add verifyVNPayReturn endpoint
```

#### 3. Environment Variables
```bash
# Ensure these are set
VNP_TMN_CODE=your_tmn_code
VNP_HASH_SECRET=your_hash_secret
VNP_URL=https://sandbox.vnpayment.vn/paymentv2/vpcpay.html
VNP_RETURN_URL=https://your-domain.com/vnpay-return
# New: IPN endpoint will be auto-discovered by VNPay
```

## 🧪 Testing

### Test Case 1: Successful Payment
1. Create booking → Get payment URL
2. Complete payment in VNPay sandbox
3. Verify IPN được gọi (check logs)
4. Verify booking status = `confirmed`
5. Verify payment status = `succeeded`

### Test Case 2: Failed Payment
1. Create booking → Get payment URL
2. Cancel payment in VNPay
3. Verify IPN được gọi
4. Verify booking status = `cancelled`
5. Verify payment status = `failed`
6. Verify schedule slots được release

### Test Case 3: Duplicate IPN
1. Complete payment
2. Manually trigger IPN again
3. Verify idempotency (không tạo duplicate updates)

## 🎯 Expected Results

After implementing solutions:

1. ✅ VNPay IPN được gọi thành công
2. ✅ Payment status được update ngay lập tức
3. ✅ Booking status được update từ `pending` → `confirmed`
4. ✅ Frontend không cần polling 24 lần
5. ✅ User experience mượt mà hơn

## 📚 References

- [VNPay API Documentation](https://sandbox.vnpayment.vn/apis/docs/)
- [NestJS Event Emitter](https://docs.nestjs.com/techniques/events)
- [Payment Gateway Best Practices](https://stripe.com/docs/payments/payment-intents)
