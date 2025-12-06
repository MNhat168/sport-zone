# Luồng xác thực tài khoản ngân hàng cho Coach (10k)

Mục tiêu: Coach chuyển 10.000₫ để xác thực tài khoản ngân hàng. Hệ thống ghi nhận Transaction và sau khi thanh toán thành công sẽ đánh dấu `coach.bankVerified = true`.

## Endpoint Backend

1) Tạo transaction xác thực (JWT)
- POST `/transactions/coach-verification`
- Body:
```
{
  "bankAccountNumber": "9704xxxxxxxx1234",
  "bankName": "Techcombank",
  "method": 7,          // PaymentMethod.VNPAY (ví dụ)
  "amount": 10000       // optional, mặc định 10000
}
```
- Response:
```
{
  "transactionId": "<txId>",
  "amount": 10000,
  "method": 7,
  "metadata": {
    "purpose": "ACCOUNT_VERIFICATION",
    "targetRole": "coach",
    "coachId": "<coachProfileId>",
    "bankAccount": "...",
    "bankName": "..."
  },
  "note": "Dùng transactionId để tạo link thanh toán"
}
```

2) Tạo link thanh toán VNPay (tái sử dụng)
- GET `/transactions/create-vnpay-url?amount=10000&orderId=<transactionId>`
- Redirect người dùng tới VNPay để thanh toán.

## Xử lý webhook/payment.success
- Khi nhận `payment.success` cho transaction **không gắn booking** và `metadata.purpose = 'ACCOUNT_VERIFICATION'`, backend sẽ:
  - Đánh dấu coach: `bankVerified = true`, `bankVerifiedAt = now()`.

## Schema thay đổi
- `CoachProfile` bổ sung:
  - `bankVerified: boolean` (default: false)
  - `bankVerifiedAt?: Date`

## Gợi ý FE
- Nút "Xác thực tài khoản":
  - Gọi POST `/transactions/coach-verification` → lấy `transactionId`
  - Gọi GET `/transactions/create-vnpay-url` → mở cổng thanh toán
  - Sau khi thanh toán, hiển thị trạng thái "Đã xác thực" (có thể poll API user/coach profile).
