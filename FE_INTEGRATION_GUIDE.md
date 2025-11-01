# 🔄 Hướng Dẫn Cập Nhật Frontend - VNPay Payment Flow

## 📋 Tóm Tắt Thay Đổi Backend

### ✅ Đã Update

1. **Thêm endpoint `/payments/verify-vnpay`** - Xác minh thanh toán ngay khi user return từ VNPay
2. **Event-driven booking confirmation** - Booking tự động confirm khi payment success
3. **Improved logging** - Dễ debug hơn với console logs chi tiết

---

## 🎯 Flow Mới (Thay Đổi Quan Trọng)

### **TRƯỚC ĐÂY (Lỗi):**
```
User thanh toán → VNPay redirect → FE polling 24 lần → Vẫn pending ❌
```

### **BÂY GIỜ (Đúng):**
```
User thanh toán → VNPay redirect → FE gọi /verify-vnpay → Payment updated → Booking auto-confirmed ✅
```

---

## 🔧 Thay Đổi Cần Thiết Ở Frontend

### 1. Thêm API Endpoint Mới

**File: `src/features/payment/paymentAPI.ts`**

```typescript
export const VERIFY_VNPAY_API = `${BASE_URL}/payments/verify-vnpay`;
```

---

### 2. Tạo Verification Thunk

**File: `src/features/payment/paymentThunk.ts`**

```typescript
import { createAsyncThunk } from '@reduxjs/toolkit';
import axiosPrivate from '../../utils/axios';
import { VERIFY_VNPAY_API } from './paymentAPI';

export interface VNPayVerificationResult {
  success: boolean;
  paymentStatus: 'succeeded' | 'failed' | 'pending';
  bookingId: string;
  message: string;
  reason?: string;
}

/**
 * Verify VNPay payment after redirect
 * NEW: Gọi endpoint này ngay khi user return từ VNPay
 */
export const verifyVNPayPayment = createAsyncThunk<
  VNPayVerificationResult,
  string, // Query string từ VNPay redirect (window.location.search)
  { rejectValue: { message: string; status: string } }
>(
  'payment/verifyVNPayPayment',
  async (queryString, thunkAPI) => {
    try {
      console.log('[Payment Thunk] Verifying VNPay payment');
      
      // Remove leading '?' nếu có
      const cleanQuery = queryString.startsWith('?') ? queryString.slice(1) : queryString;
      
      const response = await axiosPrivate.get(
        `${VERIFY_VNPAY_API}?${cleanQuery}`
      );
      
      console.log('[Payment Thunk] ✅ Verification successful:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('[Payment Thunk] ❌ Verification error:', error);
      const errorResponse = {
        message: error.response?.data?.message || error.message || 'Failed to verify payment',
        status: error.response?.status?.toString() || '500',
      };
      return thunkAPI.rejectWithValue(errorResponse);
    }
  }
);
```

---

### 3. Update Payment Slice

**File: `src/features/payment/paymentSlice.ts`**

```typescript
import { verifyVNPayPayment } from './paymentThunk';

// Trong extraReducers:
builder
  // ... existing cases
  
  // Verify VNPay Payment (NEW)
  .addCase(verifyVNPayPayment.pending, (state) => {
    state.loading = true;
    state.error = null;
  })
  .addCase(verifyVNPayPayment.fulfilled, (state, action) => {
    state.loading = false;
    console.log('[Payment Slice] Payment verified:', action.payload);
    // Optionally update payment state nếu cần
  })
  .addCase(verifyVNPayPayment.rejected, (state, action) => {
    state.loading = false;
    state.error = action.payload || { message: 'Verification failed', status: '500' };
  });
```

---

### 4. Update VNPay Return Page

**File: `src/pages/vnpay-return-page.tsx` (hoặc tương tự)**

```typescript
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { verifyVNPayPayment } from '../features/payment/paymentThunk';
import { AppDispatch } from '../store';

const VNPayReturnPage = () => {
  const navigate = useNavigate();
  const dispatch = useDispatch<AppDispatch>();
  
  const [status, setStatus] = useState<'verifying' | 'success' | 'failed' | 'polling'>('verifying');
  const [message, setMessage] = useState('');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [pollAttempt, setPollAttempt] = useState(0);

  useEffect(() => {
    const handleVerification = async () => {
      try {
        // Lấy toàn bộ query params từ VNPay
        const queryString = window.location.search;
        console.log('[VNPay Return] Starting verification with params:', queryString);

        // Gọi verify endpoint
        const result = await dispatch(verifyVNPayPayment(queryString)).unwrap();

        console.log('[VNPay Return] ✅ Verification result:', result);

        setBookingId(result.bookingId);

        if (result.success && result.paymentStatus === 'succeeded') {
          setStatus('polling');
          setMessage('Thanh toán thành công! Đang xác nhận booking...');
          
          // Start polling booking status (5 attempts max)
          pollBookingStatus(result.bookingId);
        } else {
          setStatus('failed');
          setMessage(result.message || 'Thanh toán thất bại');
        }
      } catch (error: any) {
        console.error('[VNPay Return] Verification error:', error);
        setStatus('failed');
        setMessage(error.message || 'Không thể xác minh thanh toán');
      }
    };

    handleVerification();
  }, [dispatch]);

  const pollBookingStatus = async (bookingId: string) => {
    const maxAttempts = 5;
    let attempts = 0;

    const poll = async () => {
      attempts++;
      setPollAttempt(attempts);

      try {
        // Gọi API get booking status
        // Thay bằng API của bạn
        const response = await fetch(`/api/bookings/${bookingId}`);
        const booking = await response.json();

        console.log(`[VNPay Return] Polling attempt ${attempts}/${maxAttempts}:`, booking);

        // Check booking status
        if (booking.status === 'confirmed') {
          setStatus('success');
          setMessage('Đặt sân thành công!');
          
          // Redirect sau 2 giây
          setTimeout(() => {
            navigate(`/bookings/${bookingId}`);
          }, 2000);
          return;
        }

        // Nếu chưa confirmed và chưa hết attempts → tiếp tục poll
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000); // Poll mỗi 2 giây
        } else {
          // Timeout
          setStatus('failed');
          setMessage('Đã hết thời gian chờ. Vui lòng kiểm tra lịch sử đặt sân.');
        }
      } catch (error) {
        console.error('[VNPay Return] Polling error:', error);
        
        if (attempts < maxAttempts) {
          setTimeout(poll, 2000);
        } else {
          setStatus('failed');
          setMessage('Không thể xác nhận trạng thái booking.');
        }
      }
    };

    // Bắt đầu poll sau 1 giây
    setTimeout(poll, 1000);
  };

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      {status === 'verifying' && (
        <div>
          <h2>Đang xác minh thanh toán...</h2>
          <p>Vui lòng đợi trong giây lát</p>
        </div>
      )}

      {status === 'polling' && (
        <div>
          <h2>Thanh toán thành công! ✅</h2>
          <p>{message}</p>
          <p>Đang xác nhận booking (lần thử: {pollAttempt}/5)...</p>
        </div>
      )}

      {status === 'success' && (
        <div>
          <h2>Thành công! 🎉</h2>
          <p>{message}</p>
          <p>Đang chuyển hướng...</p>
        </div>
      )}

      {status === 'failed' && (
        <div>
          <h2>Thất bại ❌</h2>
          <p>{message}</p>
          <button onClick={() => navigate('/bookings')}>
            Xem lịch sử đặt sân
          </button>
        </div>
      )}
    </div>
  );
};

export default VNPayReturnPage;
```

---

### 5. Update Router

**File: `src/App.tsx` hoặc router config**

```typescript
import VNPayReturnPage from './pages/vnpay-return-page';

// Thêm route
<Route path="/vnpay-return" element={<VNPayReturnPage />} />
```

---

## 📡 API Endpoint Chi Tiết

### `GET /payments/verify-vnpay`

**Mục đích:** Xác minh thanh toán VNPay ngay khi user return

**Query Parameters:** (Tất cả params từ VNPay redirect)
- `vnp_TxnRef`: Order ID (booking ID hoặc payment ID)
- `vnp_ResponseCode`: Response code từ VNPay ('00' = success)
- `vnp_SecureHash`: Secure hash để verify
- `vnp_TransactionNo`: Transaction ID (nếu có)
- ... và các params khác từ VNPay

**Response Success (200):**
```json
{
  "success": true,
  "paymentStatus": "succeeded",
  "bookingId": "6904dd2a6289f3cf36b1dbe3",
  "message": "Payment successful"
}
```

**Response Failed (200):**
```json
{
  "success": false,
  "paymentStatus": "failed",
  "bookingId": "6904dd2a6289f3cf36b1dbe3",
  "reason": "VNPay response code: 24",
  "message": "Payment failed"
}
```

**Response Already Processed:**
```json
{
  "success": true,
  "paymentStatus": "succeeded", // hoặc "failed"
  "bookingId": "6904dd2a6289f3cf36b1dbe3",
  "message": "Payment already processed"
}
```

**Error Responses:**
- `400`: Invalid signature hoặc missing parameters
- `404`: Payment not found

---

## 🎯 Workflow Hoàn Chỉnh

### Step 1: User Click Thanh Toán
```typescript
// Tạo booking
const booking = await createBooking({ ... });

// Lấy payment URL
const { paymentUrl } = await createVNPayUrl({
  amount: booking.totalPrice,
  orderId: booking.payment, // hoặc booking.id
});

// Redirect đến VNPay
window.location.href = paymentUrl;
```

### Step 2: User Thanh Toán Trên VNPay
- User nhập thông tin và hoàn tất thanh toán
- VNPay redirect về: `http://localhost:5173/vnpay-return?vnp_TxnRef=...&vnp_ResponseCode=00&...`

### Step 3: VNPay Return Page
```typescript
// Trong VNPayReturnPage component
useEffect(() => {
  const queryString = window.location.search;
  
  // GỌI NGAY endpoint verify
  dispatch(verifyVNPayPayment(queryString))
    .unwrap()
    .then((result) => {
      if (result.success) {
        // Payment đã được verify → Start polling booking
        pollBookingStatus(result.bookingId);
      } else {
        // Payment failed
        showError(result.message);
      }
    });
}, []);
```

### Step 4: Polling Booking Status
```typescript
// Chỉ cần poll 5 lần (10 giây) thay vì 24 lần (48 giây)
// Booking sẽ tự động confirm qua event từ backend
```

---

## ✅ Checklist Triển Khai

- [ ] Thêm `VERIFY_VNPAY_API` vào `paymentAPI.ts`
- [ ] Tạo `verifyVNPayPayment` thunk trong `paymentThunk.ts`
- [ ] Update `paymentSlice.ts` với reducer cases mới
- [ ] Tạo/update `VNPayReturnPage` component
- [ ] Thêm route `/vnpay-return` vào router
- [ ] Test flow: Create booking → VNPay → Return → Verify → Check booking status
- [ ] Giảm polling từ 24 → 5 attempts
- [ ] Update UI messages rõ ràng hơn

---

## 🐛 Troubleshooting

### Issue: "Invalid signature"
- **Nguyên nhân:** Query params không đầy đủ hoặc bị modify
- **Fix:** Đảm bảo truyền toàn bộ query string từ `window.location.search`

### Issue: "Payment not found"
- **Nguyên nhân:** `orderId` không match với payment hoặc booking ID
- **Fix:** Kiểm tra khi tạo URL VNPay, dùng `paymentId` làm `orderId`

### Issue: Still polling nhiều lần
- **Nguyên nhân:** Chưa gọi `/verify-vnpay` hoặc booking chưa được confirm
- **Fix:** 
  1. Đảm bảo gọi `verifyVNPayPayment` ngay khi component mount
  2. Check backend logs: `[Payment Success] ✅ Booking xxx confirmed`

---

## 📝 Notes

1. **Backend tự động confirm booking** khi payment success → FE chỉ cần poll để check status
2. **Idempotency:** Nếu gọi `/verify-vnpay` nhiều lần, backend sẽ trả về "already processed"
3. **IPN vẫn quan trọng:** Endpoint `/verify-vnpay` là fallback cho FE, nhưng IPN vẫn là nguồn truth chính

---

## 🎉 Kết Quả Mong Đợi

Sau khi implement:
- ✅ Payment verification: < 1 giây
- ✅ Booking confirmation: 2-10 giây (thay vì 48 giây)
- ✅ Polling attempts: 5 lần (thay vì 24 lần)
- ✅ UX mượt mà, feedback rõ ràng ở mỗi bước

