# 📘 PayOS API Integration Guide for Frontend

## 🔄 **THAY ĐỔI MỚI (Latest Updates)**

### ✅ **Signature Verification Fix**
- **Vấn đề đã sửa**: Webhook signature verification đã được sửa để xử lý đúng format từ PayOS
- **Format mới**: PayOS gửi webhook với format `{ "data": {...}, "signature": "..." }` (signature ở root level)
- **Status**: ✅ Đã fix và test thành công

---

## 📍 **API Endpoints**

### Base URL
```
http://localhost:3000/transactions
```

---

## 1️⃣ **Create PayOS Payment Link**

### Endpoint
```
POST /transactions/payos/create-payment
```

### Request Headers
```
Content-Type: application/json
Authorization: Bearer <token> (nếu có)
```

### Request Body
```json
{
  "orderId": "675abc123def456",           // Required: Payment ID hoặc Booking ID
  "amount": 200000,                        // Required: Số tiền (VND), min: 1000
  "description": "Thanh toan dat san",    // Required: Mô tả thanh toán
  "items": [                                // Required: Danh sách items
    {
      "name": "Đặt sân bóng đá",
      "quantity": 1,
      "price": 200000
    }
  ],
  "buyerName": "Nguyen Van A",             // Optional
  "buyerEmail": "buyer@example.com",       // Optional
  "buyerPhone": "0123456789",              // Optional
  "returnUrl": "http://localhost:5173/transactions/payos/return",  // Optional
  "cancelUrl": "http://localhost:5173/transactions/payos/cancel",   // Optional
  "expiredAt": 15                          // Optional: Thời gian hết hạn (phút), min: 5, max: 60, default: 15
}
```

### Response (Success - 201)
```json
{
  "paymentLinkId": "abc123def456",
  "checkoutUrl": "https://pay.payos.vn/web/abc123def456",
  "qrCodeUrl": "https://pay.payos.vn/qr/abc123def456",
  "orderCode": 123456789,
  "amount": 200000,
  "status": "PENDING"
}
```

### Response (Error - 400)
```json
{
  "statusCode": 400,
  "message": "Invalid amount. Minimum is 1,000 VND and maximum is 1,000,000,000 VND",
  "error": "Bad Request"
}
```

### Validation Rules
- `orderId`: Required, phải là valid MongoDB ObjectId format
- `amount`: Required, min: 1000 VND, max: 1,000,000,000 VND
- `description`: Required, string không rỗng
- `items`: Required, array không rỗng
- `items[].name`: Required, string
- `items[].quantity`: Required, number >= 1
- `items[].price`: Required, number >= 1000
- `returnUrl` / `cancelUrl`: Optional, phải thuộc allowed domains (nếu có)
- `expiredAt`: Optional, 5-60 phút

### Frontend Usage
```typescript
// Example: Create payment link
const createPayOSPayment = async (bookingId: string, amount: number) => {
  const response = await fetch('http://localhost:3000/transactions/payos/create-payment', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // 'Authorization': `Bearer ${token}` // Nếu có auth
    },
    body: JSON.stringify({
      orderId: bookingId,
      amount: amount,
      description: `Thanh toan dat san - Booking ${bookingId}`,
      items: [
        {
          name: 'Đặt sân bóng đá',
          quantity: 1,
          price: amount
        }
      ],
      buyerName: user.name,
      buyerEmail: user.email,
      buyerPhone: user.phone,
      returnUrl: `${window.location.origin}/transactions/payos/return`,
      cancelUrl: `${window.location.origin}/transactions/payos/cancel`,
      expiredAt: 15
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to create payment');
  }

  const data = await response.json();
  
  // Redirect user to PayOS checkout
  window.location.href = data.checkoutUrl;
  
  return data;
};
```

---

## 2️⃣ **PayOS Return URL Handler**

### Endpoint
```
GET /transactions/payos/return
```

### Query Parameters (từ PayOS redirect)
```
?orderCode=123456789&status=SUCCESS
```

### Response (Success - 200)
```json
{
  "success": true,
  "paymentStatus": "succeeded",        // "succeeded" | "failed" | "pending" | "cancelled"
  "bookingId": "675abc123def456",
  "message": "Payment successful",
  "orderCode": 123456789,
  "reference": "FT21348762543",
  "amount": 200000
}
```

### Response (Failed - 200)
```json
{
  "success": false,
  "paymentStatus": "failed",
  "bookingId": "",
  "message": "Payment failed",
  "reason": "Transaction not found",
  "amount": 200000
}
```

### Payment Status Values
- `succeeded`: Thanh toán thành công (PAID)
- `failed`: Thanh toán thất bại (EXPIRED)
- `pending`: Đang chờ xử lý (PENDING, PROCESSING)
- `cancelled`: Đã hủy (CANCELLED)

### Frontend Usage
```typescript
// Example: Handle return from PayOS
// File: /transactions/payos/return.tsx hoặc component tương tự

import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';

const PayOSReturnPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const orderCode = searchParams.get('orderCode');
    const status = searchParams.get('status');

    if (!orderCode) {
      setResult({
        success: false,
        message: 'Missing order code'
      });
      setLoading(false);
      return;
    }

    // Call backend to verify payment
    fetch(`http://localhost:3000/transactions/payos/return?orderCode=${orderCode}&status=${status}`)
      .then(res => res.json())
      .then(data => {
        setResult(data);
        setLoading(false);

        // Redirect based on result
        if (data.success) {
          // Redirect to success page
          setTimeout(() => {
            navigate(`/bookings/${data.bookingId}?payment=success`);
          }, 2000);
        } else {
          // Redirect to failure page
          setTimeout(() => {
            navigate(`/bookings/${data.bookingId}?payment=failed`);
          }, 2000);
        }
      })
      .catch(error => {
        console.error('Error verifying payment:', error);
        setResult({
          success: false,
          message: 'Error verifying payment'
        });
        setLoading(false);
      });
  }, [searchParams, navigate]);

  if (loading) {
    return <div>Đang xác thực thanh toán...</div>;
  }

  return (
    <div>
      {result?.success ? (
        <div>
          <h2>✅ Thanh toán thành công!</h2>
          <p>{result.message}</p>
          <p>Mã đơn hàng: {result.orderCode}</p>
          <p>Số tiền: {result.amount.toLocaleString('vi-VN')} VND</p>
        </div>
      ) : (
        <div>
          <h2>❌ Thanh toán thất bại</h2>
          <p>{result?.message || 'Có lỗi xảy ra'}</p>
          {result?.reason && <p>Lý do: {result.reason}</p>}
        </div>
      )}
    </div>
  );
};

export default PayOSReturnPage;
```

---

## 3️⃣ **Query PayOS Transaction Status**

### Endpoint
```
GET /transactions/payos/query/:orderCode
```

### Path Parameters
- `orderCode`: PayOS order code (number)

### Response (Success - 200)
```json
{
  "orderCode": 123456789,
  "amount": 200000,
  "description": "Thanh toan dat san",
  "status": "PAID",                    // "PENDING" | "PROCESSING" | "PAID" | "CANCELLED" | "EXPIRED"
  "accountNumber": "12345678",
  "reference": "FT21348762543",
  "transactionDateTime": "2024-11-02 14:30:00",
  "createdAt": 1699000000,
  "cancelledAt": null
}
```

### Response (Error - 400/404)
```json
{
  "statusCode": 400,
  "message": "Transaction not found",
  "error": "Bad Request"
}
```

### Frontend Usage
```typescript
// Example: Query transaction status
const queryPayOSTransaction = async (orderCode: number) => {
  const response = await fetch(`http://localhost:3000/transactions/payos/query/${orderCode}`);
  
  if (!response.ok) {
    throw new Error('Failed to query transaction');
  }
  
  return await response.json();
};

// Polling example
const pollTransactionStatus = async (orderCode: number, maxAttempts = 30) => {
  for (let i = 0; i < maxAttempts; i++) {
    const transaction = await queryPayOSTransaction(orderCode);
    
    if (transaction.status === 'PAID') {
      return { success: true, transaction };
    }
    
    if (transaction.status === 'CANCELLED' || transaction.status === 'EXPIRED') {
      return { success: false, transaction };
    }
    
    // Wait 2 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  return { success: false, message: 'Timeout' };
};
```

---

## 4️⃣ **Cancel PayOS Transaction**

### Endpoint
```
POST /transactions/payos/cancel/:orderCode
```

### Path Parameters
- `orderCode`: PayOS order code (number)

### Request Body (Optional)
```json
{
  "cancellationReason": "Customer requested cancellation"
}
```

### Response (Success - 200)
```json
{
  "orderCode": 123456789,
  "status": "CANCELLED",
  "message": "Transaction cancelled successfully"
}
```

### Response (Error - 400)
```json
{
  "statusCode": 400,
  "message": "Transaction cannot be cancelled (may already be completed or cancelled)",
  "error": "Bad Request"
}
```

### Frontend Usage
```typescript
// Example: Cancel transaction
const cancelPayOSTransaction = async (orderCode: number, reason?: string) => {
  const response = await fetch(`http://localhost:3000/transactions/payos/cancel/${orderCode}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      cancellationReason: reason
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || 'Failed to cancel transaction');
  }

  return await response.json();
};
```

---

## 5️⃣ **PayOS Webhook (Internal - Backend Only)**

### Endpoint
```
POST /transactions/payos/webhook
```

**⚠️ LƯU Ý**: Endpoint này chỉ dành cho PayOS server gọi, Frontend KHÔNG cần gọi endpoint này.

### Webhook Format (từ PayOS)
```json
{
  "data": {
    "orderCode": 123456789,
    "amount": 200000,
    "description": "Thanh toan dat san",
    "accountNumber": "12345678",
    "reference": "FT21348762543",
    "transactionDateTime": "2024-11-02 14:30:00"
  },
  "signature": "901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752"
}
```

### Response Codes
- `00`: Success
- `01`: Transaction not found
- `97`: Invalid signature / Missing signature
- `98`: Amount mismatch / Invalid payload
- `99`: System error / Invalid webhook data

---

## 🔄 **Payment Flow**

### 1. Create Payment Flow
```
Frontend → POST /payos/create-payment
         ← { checkoutUrl, qrCodeUrl, orderCode }
Frontend → Redirect user to checkoutUrl
User → PayOS payment page
User → Complete payment
PayOS → Redirect to returnUrl
Frontend → GET /payos/return?orderCode=...&status=...
         ← { success, paymentStatus, bookingId, ... }
```

### 2. Polling Flow (Alternative)
```
Frontend → POST /payos/create-payment
         ← { checkoutUrl, orderCode }
Frontend → Redirect user to checkoutUrl
Frontend → Start polling GET /payos/query/:orderCode
         ← { status: "PENDING" | "PAID" | "CANCELLED" }
Frontend → Stop polling when status is final
```

---

## 📊 **Error Handling**

### Common Error Codes

| Code | Message | Description | Frontend Action |
|------|---------|-------------|-----------------|
| 400 | Invalid amount | Số tiền không hợp lệ | Show error, validate input |
| 400 | Invalid order ID format | Order ID sai format | Check orderId format |
| 400 | Transaction not found | Không tìm thấy transaction | Check orderCode |
| 400 | Transaction cannot be cancelled | Không thể hủy (đã completed) | Show message, disable cancel button |
| 400 | Invalid return URL domain | Return URL không được phép | Check allowed domains |

### Error Response Format
```json
{
  "statusCode": 400,
  "message": "Error message here",
  "error": "Bad Request"
}
```

### Frontend Error Handling Example
```typescript
const handlePaymentError = (error: any) => {
  if (error.statusCode === 400) {
    // Validation error
    showToast(error.message, 'error');
  } else if (error.statusCode === 401) {
    // Unauthorized
    redirectToLogin();
  } else if (error.statusCode >= 500) {
    // Server error
    showToast('Lỗi hệ thống, vui lòng thử lại sau', 'error');
  } else {
    // Unknown error
    showToast('Có lỗi xảy ra', 'error');
  }
};
```

---

## 🔐 **Security Notes**

1. **Signature Verification**: Backend tự động verify signature từ PayOS, Frontend không cần xử lý
2. **Return URL Validation**: Chỉ accept return URLs từ allowed domains
3. **Amount Validation**: Backend validate amount trước khi tạo payment link
4. **Order ID Validation**: Backend validate orderId format (MongoDB ObjectId)

---

## 📝 **TypeScript Types (Recommended)**

```typescript
// PayOS Types
interface CreatePayOSPaymentRequest {
  orderId: string;
  amount: number;
  description: string;
  items: Array<{
    name: string;
    quantity: number;
    price: number;
  }>;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  returnUrl?: string;
  cancelUrl?: string;
  expiredAt?: number;
}

interface PayOSPaymentLinkResponse {
  paymentLinkId: string;
  checkoutUrl: string;
  qrCodeUrl: string;
  orderCode: number;
  amount: number;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
}

interface PayOSVerificationResult {
  success: boolean;
  paymentStatus: 'succeeded' | 'failed' | 'pending' | 'cancelled';
  bookingId: string;
  message: string;
  reason?: string;
  orderCode?: number;
  reference?: string;
  amount: number;
}

interface PayOSTransactionQuery {
  orderCode: number;
  amount: number;
  description: string;
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'CANCELLED' | 'EXPIRED';
  accountNumber?: string;
  reference?: string;
  transactionDateTime?: string;
  createdAt: number;
  cancelledAt?: number;
}

interface PayOSCancelResponse {
  orderCode: number;
  status: 'CANCELLED';
  message: string;
}
```

---

## 🧪 **Testing**

### Test Payment Link Creation
```bash
curl -X POST http://localhost:3000/transactions/payos/create-payment \
  -H "Content-Type: application/json" \
  -d '{
    "orderId": "675abc123def456",
    "amount": 200000,
    "description": "Test payment",
    "items": [{
      "name": "Test item",
      "quantity": 1,
      "price": 200000
    }]
  }'
```

### Test Query Transaction
```bash
curl http://localhost:3000/transactions/payos/query/123456789
```

### Test Cancel Transaction
```bash
curl -X POST http://localhost:3000/transactions/payos/cancel/123456789 \
  -H "Content-Type: application/json" \
  -d '{"cancellationReason": "Test cancellation"}'
```

---

## 📞 **Support**

Nếu có vấn đề hoặc câu hỏi về PayOS integration, liên hệ Backend team.

---

**Last Updated**: 2025-11-09  
**Version**: 1.0.0

