# Complete Implementation Checklist - Fix VNPay Payment Flow

## 📊 Current Status Analysis

### Database Evidence:
```json
// Booking - ✅ Created but waiting
{
  "_id": "6904dd2a6289f3cf36b1dbe3",
  "status": "confirmed",  // ✅ Already confirmed
  "payment": "6904dd2a6289f3cf36b1dbe6"
}

// Payment - ❌ Stuck at pending
{
  "_id": "6904dd2a6289f3cf36b1dbe6", 
  "status": "pending",    // ❌ Never updated
  "booking": "6904dd2a6289f3cf36b1dbe3"
}
```

### Problem:
- Frontend polling 24 times (48 seconds) but payment never verified
- Payment status stuck at "pending" forever
- No connection between VNPay callback and payment update

## 🎯 Solution Overview

### Backend Changes:
1. ✅ Add event listeners in BookingsService
2. ✅ Add `/payments/verify-vnpay` endpoint
3. ✅ Emit events on payment success/failure

### Frontend Changes:
1. ✅ Create new VNPay return page
2. ✅ Call verify endpoint immediately on return
3. ✅ Reduce polling from 24 to 5 attempts
4. ✅ Better UX with loading states

---

## 📋 BACKEND CHECKLIST

### ✅ Step 1: Update `bookings.service.ts`

**File:** `src/bookings/bookings.service.ts`

#### 1.1 Add Event Listeners to Constructor

Find the constructor (around line 50-63):
```typescript
constructor(
  @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
  // ... other injections
  private readonly emailService: EmailService,
) { }
```

**Add AFTER the closing brace `}`:**
```typescript
constructor(
  // ... existing parameters
) {
  // NEW: Setup payment event listeners
  this.setupPaymentEventListeners();
}

/**
 * Setup payment event listeners
 * CRITICAL: Updates booking status when payment completes
 */
private setupPaymentEventListeners() {
  this.eventEmitter.on('payment.success', this.handlePaymentSuccess.bind(this));
  this.eventEmitter.on('payment.failed', this.handlePaymentFailed.bind(this));
  this.logger.log('Payment event listeners registered');
}
```

#### 1.2 Add Event Handler Methods

**Add at the END of the class (before the closing `}`):**

```typescript
/**
 * Handle payment success event
 */
private async handlePaymentSuccess(event: any) {
  try {
    this.logger.log(`[Payment Success] Processing for booking ${event.bookingId}`);
    
    if (!Types.ObjectId.isValid(event.bookingId)) {
      this.logger.error(`[Payment Success] Invalid booking ID`);
      return;
    }

    const booking = await this.bookingModel.findById(event.bookingId);
    if (!booking) {
      this.logger.error(`[Payment Success] Booking not found`);
      return;
    }

    if (booking.status === BookingStatus.CONFIRMED) {
      this.logger.warn(`[Payment Success] Already confirmed`);
      return;
    }

    booking.status = BookingStatus.CONFIRMED;
    booking.payment = new Types.ObjectId(event.paymentId);
    await booking.save();

    this.logger.log(`[Payment Success] ✅ Booking ${event.bookingId} confirmed`);
    
  } catch (error) {
    this.logger.error('[Payment Success] Error', error);
  }
}

/**
 * Handle payment failed event
 */
private async handlePaymentFailed(event: any) {
  try {
    this.logger.log(`[Payment Failed] Processing for booking ${event.bookingId}`);
    
    if (!Types.ObjectId.isValid(event.bookingId)) {
      return;
    }

    const booking = await this.bookingModel.findById(event.bookingId);
    if (!booking || booking.status === BookingStatus.CANCELLED) {
      return;
    }

    booking.status = BookingStatus.CANCELLED;
    booking.cancellationReason = event.reason || 'Payment failed';
    await booking.save();

    // Release schedule slots
    const schedule = await this.scheduleModel.findOne({
      field: booking.field,
      date: booking.date
    });

    if (schedule) {
      schedule.bookedSlots = schedule.bookedSlots.filter(slot => 
        !(slot.startTime === booking.startTime && slot.endTime === booking.endTime)
      );
      await schedule.save();
    }

    this.logger.log(`[Payment Failed] ⚠️ Booking ${event.bookingId} cancelled`);
    
  } catch (error) {
    this.logger.error('[Payment Failed] Error', error);
  }
}
```

**Save the file.**

---

### ✅ Step 2: Update `payments.controller.ts`

**File:** `src/payments/payments.controller.ts`

#### 2.1 Add Import (at the top)

```typescript
import { NotFoundException } from '@nestjs/common'; // Add if not present
```

#### 2.2 Add Verify Endpoint

**Add AFTER `createVNPayUrl` method (around line 50):**

```typescript
/**
 * Verify VNPay return from frontend
 * Called immediately after user returns from VNPay
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

  // Verify signature
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
    console.error('[Verify VNPay] Invalid signature');
    throw new BadRequestException('Invalid signature');
  }

  const responseCode: string | undefined = query.vnp_ResponseCode;
  const orderId: string | undefined = query.vnp_TxnRef;
  const transactionId: string | undefined = query.vnp_TransactionNo || query.vnp_BankTranNo;

  if (!orderId) {
    throw new BadRequestException('Missing order ID');
  }

  console.log('[Verify VNPay] Verifying payment:', { orderId, responseCode, transactionId });

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
    console.log('[Verify VNPay] Payment already processed:', payment.status);
    return {
      success: payment.status === PaymentStatus.SUCCEEDED,
      paymentStatus: payment.status,
      bookingId: payment.booking,
      message: 'Payment already processed'
    };
  }

  // Update payment status
  if (responseCode === '00') {
    const updated = await this.paymentsService.updatePaymentStatus(
      (payment._id as any).toString(),
      PaymentStatus.SUCCEEDED,
      transactionId,
    );

    console.log('[Verify VNPay] ✅ Payment succeeded');

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
    const updated = await this.paymentsService.updatePaymentStatus(
      (payment._id as any).toString(),
      PaymentStatus.FAILED,
      transactionId,
    );

    console.log('[Verify VNPay] ⚠️ Payment failed:', responseCode);

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
```

**Save the file.**

---

### ✅ Step 3: Build & Deploy Backend

```bash
# Build
npm run build

# Restart application
pm2 restart your-app-name

# OR with Docker
docker-compose up -d --build

# Check logs
pm2 logs | grep "Payment event listeners registered"
# Should see: Payment event listeners registered
```

---

## 📋 FRONTEND CHECKLIST

### ✅ Step 1: Update `paymentAPI.ts`

**File:** `src/features/payment/paymentAPI.ts`

Add new endpoint constant:
```typescript
export const VERIFY_VNPAY_API = `${BASE_URL}/payments/verify-vnpay`;
```

Full file should look like:
```typescript
import { BASE_URL } from "../../utils/constant-value/constant";

export const CREATE_VNPAY_URL_API = `${BASE_URL}/payments/create-vnpay-url`;
export const VERIFY_VNPAY_API = `${BASE_URL}/payments/verify-vnpay`; // NEW
export const GET_PAYMENT_BY_BOOKING_API = (bookingId: string) => `${BASE_URL}/payments/booking/${bookingId}`;
export const UPDATE_PAYMENT_STATUS_API = (paymentId: string) => `${BASE_URL}/payments/${paymentId}/status`;
```

---

### ✅ Step 2: Update `paymentThunk.ts`

**File:** `src/features/payment/paymentThunk.ts`

#### 2.1 Add Interface (after imports)

```typescript
/**
 * Verification result from VNPay
 */
export interface VNPayVerificationResult {
    success: boolean;
    paymentStatus: 'succeeded' | 'failed' | 'pending';
    bookingId: string;
    message: string;
    reason?: string;
}
```

#### 2.2 Import VERIFY_VNPAY_API

Update import:
```typescript
import {
    CREATE_VNPAY_URL_API,
    VERIFY_VNPAY_API, // ADD THIS
    GET_PAYMENT_BY_BOOKING_API,
    UPDATE_PAYMENT_STATUS_API,
} from "./paymentAPI";
```

#### 2.3 Add Verification Thunk

Add AFTER `createVNPayUrl`:

```typescript
/**
 * Verify VNPay payment after redirect
 * NEW: This verifies payment and triggers booking confirmation
 */
export const verifyVNPayPayment = createAsyncThunk<
    VNPayVerificationResult,
    string, // Query string from VNPay redirect
    { rejectValue: ErrorResponse }
>("payment/verifyVNPayPayment", async (queryString, thunkAPI) => {
    try {
        console.log("[Payment Thunk] Verifying VNPay payment");
        
        const response = await axiosPrivate.get(
            `${VERIFY_VNPAY_API}?${queryString}`
        );
        
        console.log("[Payment Thunk] ✅ Verification successful:", response.data);
        return response.data;
    } catch (error: any) {
        console.error("[Payment Thunk] ❌ Verification error:", error);
        const errorResponse: ErrorResponse = {
            message: error.response?.data?.message || error.message || "Failed to verify VNPay payment",
            status: error.response?.status?.toString() || "500",
        };
        return thunkAPI.rejectWithValue(errorResponse);
    }
});
```

---

### ✅ Step 3: Update `paymentSlice.ts`

**File:** `src/features/payment/paymentSlice.ts`

#### 3.1 Import New Thunk

Update import:
```typescript
import {
    createVNPayUrl,
    verifyVNPayPayment, // ADD THIS
    getPaymentByBooking,
    updatePaymentStatus,
} from "./paymentThunk";
```

#### 3.2 Add Reducer Cases

Add AFTER `createVNPayUrl` cases in `extraReducers`:

```typescript
// Verify VNPay Payment (NEW)
builder.addCase(verifyVNPayPayment.pending, (state) => {
    state.loading = true;
    state.error = null;
});
builder.addCase(verifyVNPayPayment.fulfilled, (state, action) => {
    state.loading = false;
    console.log("[Payment Slice] Payment verification successful:", action.payload);
});
builder.addCase(verifyVNPayPayment.rejected, (state, action) => {
    state.loading = false;
    state.error = action.payload || { message: "Failed to verify VNPay payment", status: "500" };
});
```

---

### ✅ Step 4: Update `index.ts` (Export New Thunk)

**File:** `src/features/payment/index.ts`

Should already export all from paymentThunk, but verify:
```typescript
export * from './paymentThunk'; // This should export verifyVNPayPayment
```

---

### ✅ Step 5: Create VNPay Return Page

**File:** `src/pages/vnpay-return-page.tsx` (or your pages directory)

**Copy the entire content from `vnpay-return-page.tsx` file I provided.**

Key sections:
1. ✅ Payment verification on mount
2. ✅ Polling for booking confirmation (5 attempts max)
3. ✅ Loading states (verifying → polling → success/error)
4. ✅ Error handling

---

### ✅ Step 6: Update Router

**File:** `src/App.tsx` or your router configuration file

Add route:

```typescript
import VNPayReturnPage from './pages/vnpay-return-page';

// In your routes
<Route path="/vnpay-return" element={<VNPayReturnPage />} />
```

Or if using React Router v5:
```typescript
<Route path="/vnpay-return" component={VNPayReturnPage} />
```

---

### ✅ Step 7: Update VNPay Return URL (Backend Config)

Ensure backend uses correct return URL:

**File:** Backend `.env`
```bash
VNP_RETURN_URL=http://localhost:5173/vnpay-return  # Development
# VNP_RETURN_URL=https://yourdomain.com/vnpay-return  # Production
```

---

### ✅ Step 8: Build & Deploy Frontend

```bash
# Install dependencies (if needed)
npm install

# Build
npm run build

# Deploy (depends on your hosting)
# Vercel: vercel --prod
# Netlify: netlify deploy --prod
# Or copy dist/ to your server
```

---

## 🧪 TESTING CHECKLIST

### Test 1: Successful Payment ✅

1. [ ] Open app in browser
2. [ ] Navigate to venue booking page
3. [ ] Fill in booking details
4. [ ] Click "Hoàn tất thanh toán"
5. [ ] **Verify:** Redirects to VNPay payment page
6. [ ] Complete payment in VNPay sandbox
7. [ ] **Verify:** Redirects to `/vnpay-return`
8. [ ] **Verify:** Shows "Đang xác minh thanh toán..." (< 1 sec)
9. [ ] **Verify:** Shows "Thanh toán thành công!" 
10. [ ] **Verify:** Shows "Đang xác nhận booking..." with polling counter
11. [ ] **Verify:** Redirects to booking details page
12. [ ] **Check database:**
    - [ ] Booking status: "confirmed"
    - [ ] Payment status: "succeeded"
    - [ ] Payment has transactionId
13. [ ] **Check backend logs:**
    - [ ] `[Verify VNPay] ✅ Payment succeeded`
    - [ ] `[Payment Success] ✅ Booking xxx confirmed`

### Test 2: Failed Payment ❌

1. [ ] Create new booking
2. [ ] Click "Hoàn tất thanh toán"
3. [ ] In VNPay page, click "Cancel" or "Hủy giao dịch"
4. [ ] **Verify:** Redirects to `/vnpay-return`
5. [ ] **Verify:** Shows error message
6. [ ] **Verify:** Shows "Thanh toán thất bại"
7. [ ] **Check database:**
    - [ ] Booking status: "cancelled"
    - [ ] Payment status: "failed"
8. [ ] **Check backend logs:**
    - [ ] `[Verify VNPay] ⚠️ Payment failed`
    - [ ] `[Payment Failed] ⚠️ Booking xxx cancelled`

### Test 3: Duplicate Verification (Idempotency) ✅

1. [ ] Complete successful payment
2. [ ] Copy the return URL
3. [ ] Navigate to the same URL again
4. [ ] **Verify:** Shows "Payment already processed"
5. [ ] **Verify:** No duplicate booking updates in database

---

## 🎯 SUCCESS CRITERIA

After completing all steps:

### Backend ✅
- [ ] Event listeners registered (check logs)
- [ ] `/payments/verify-vnpay` endpoint working
- [ ] Payment status updates on verification
- [ ] Booking status updates via events
- [ ] Logs show payment processing

### Frontend ✅
- [ ] VNPay return page created
- [ ] Router updated with new route
- [ ] Verification call happens immediately
- [ ] Polling reduced to 5 attempts (10 seconds)
- [ ] Loading states display correctly
- [ ] Error handling works

### User Experience ✅
- [ ] Payment verification: < 1 second
- [ ] Booking confirmation: 2-10 seconds (vs 48 seconds before)
- [ ] Clear feedback at each step
- [ ] No more 24 polling attempts
- [ ] Smooth transitions

### Database ✅
- [ ] Payment status: "succeeded" (not stuck at "pending")
- [ ] Booking status: "confirmed"
- [ ] Transaction ID saved
- [ ] Timestamps updated correctly

---

## 🐛 TROUBLESHOOTING

### Issue: "Payment event listeners registered" not in logs
**Solution:** Restart backend application
```bash
pm2 restart your-app-name
pm2 logs | grep "Payment event"
```

### Issue: "Invalid signature" error
**Solution:** Verify VNP_HASH_SECRET in backend `.env`

### Issue: Payment not found
**Solution:** 
- Check orderId in URL matches bookingId
- Check payment was created before redirect

### Issue: Still polling 24 times
**Solution:**
- Ensure new route `/vnpay-return` is active
- Clear browser cache
- Check router configuration

### Issue: Booking confirmed but payment still pending
**Solution:**
- Check event listeners are registered
- Check backend logs for event emission
- Verify BookingsService constructor calls `setupPaymentEventListeners()`

---

## 📞 SUPPORT & LOGS

### Check Backend Logs:
```bash
# PM2
pm2 logs

# Docker
docker-compose logs -f backend

# Look for:
# ✅ "Payment event listeners registered"
# ✅ "[Verify VNPay] ✅ Payment succeeded"
# ✅ "[Payment Success] ✅ Booking xxx confirmed"
```

### Check Frontend Console:
```javascript
// Look for:
// "[VNPay Return] Starting payment verification..."
// "[VNPay Return] ✅ Verification result: {...}"
// "[VNPay Return] Polling booking status (attempt 1/5)"
// "[VNPay Return] ✅ Booking confirmed!"
```

### Database Check:
```javascript
// MongoDB
db.payments.findOne({ _id: ObjectId("YOUR_PAYMENT_ID") })
// Should see: status: "succeeded"

db.bookings.findOne({ _id: ObjectId("YOUR_BOOKING_ID") })
// Should see: status: "confirmed"
```

---

## ✅ FINAL CHECKLIST

- [ ] Backend event listeners added
- [ ] Backend verify endpoint added
- [ ] Backend deployed & restarted
- [ ] Frontend return page created
- [ ] Frontend API/thunk/slice updated
- [ ] Frontend router updated
- [ ] Frontend deployed
- [ ] Test Case 1 (Success) passed
- [ ] Test Case 2 (Failed) passed
- [ ] Test Case 3 (Idempotency) passed
- [ ] Logs showing correct flow
- [ ] Database showing correct statuses
- [ ] User experience smooth & fast

🎉 **CONGRATULATIONS! Payment flow is now fixed!**
