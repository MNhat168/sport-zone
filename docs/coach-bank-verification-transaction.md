## Ghi nhận Transaction khi Coach xác thực tài khoản ngân hàng

Tài liệu này mô tả **chuẩn lưu `Transaction`** cho trường hợp **Coach chuyển 10k cho hệ thống** để xác thực tài khoản ngân hàng.

Giả định:

- Flow payment + kiểm tra tài khoản (webhook/callback) **đã code sẵn và chạy được**.
- Bạn chỉ cần thống nhất **Transaction lưu như thế nào cho đúng & dễ debug**.

---

## 1. Nguyên tắc chung

Trường hợp **coach verify tài khoản**:

- **Không gắn với Booking** → `booking` để `undefined` / không set.
- **`user` là coach** (userId của coach).
- **`direction = 'in'`** → tiền đi từ coach → hệ thống.
- **`amount = 10000`** (hoặc số tiền bạn dùng cho verify).
- **`status`**:
  - `PENDING` khi mới tạo / chờ gateway.
  - `SUCCEEDED` sau khi gateway/webhook báo thành công.
- **`method`**: gateway bạn đang dùng (`PAYOS`, `VNPAY`, ...).
- **`type`**:
  - Để đơn giản, giữ là `TransactionType.PAYMENT`.
  - Nếu sau này cần tách riêng, có thể thêm `VERIFICATION`, nhưng **không bắt buộc**.
- **`metadata`** dùng để “gắn nhãn” cho dễ lọc & đọc log.

---

## 2. Cấu trúc Transaction gợi ý cho verify Coach

Ví dụ object `Transaction` khi tạo **payment 10k verify coach**:

```ts
{
  // Không có booking vì đây không phải giao dịch cho 1 booking cụ thể
  booking: undefined,

  // Ai đang trả 10k
  user: coachUserId,

  // Tiền đi từ coach -> hệ thống
  direction: 'in', // tiền IN vào hệ thống

  // Loại giao dịch: thanh toán vào hệ thống
  type: TransactionType.PAYMENT,

  // Số tiền khách trả để verify
  amount: 10000,

  // Cổng thanh toán
  method: PaymentMethod.PAYOS, // hoặc VNPAY / ...

  // Trạng thái ban đầu
  status: TransactionStatus.PENDING,

  // Ngữ cảnh thêm để sau này dễ query/debug
  metadata: {
    purpose: 'ACCOUNT_VERIFICATION', // đánh dấu đây là verify
    targetRole: 'coach',             // coach (khác với field_owner)
    coachId,                         // id profile coach nếu khác user

    // optional: info ngân hàng dùng khi hiển thị log / audit
    bankAccount: bankAccountNumber,
    bankName,
  },
}
```

Sau khi gateway/webhook báo **thành công**, bạn chỉ cần:

```ts
transaction.status = TransactionStatus.SUCCEEDED;
transaction.processedAt = new Date();
await transaction.save();

// Đồng thời mark coach đã verify bank
coach.bankVerified = true;
coach.bankVerifiedAt = new Date();
await coach.save();
```

---

## 3. Lợi ích của cách ghi này

- **Dễ lọc / báo cáo**:
  - Tất cả giao dịch verify coach:
    - `type = PAYMENT`
    - `metadata.purpose = 'ACCOUNT_VERIFICATION'`
    - `metadata.targetRole = 'coach'`
- **Không làm phức tạp enum `TransactionType`**:
  - Không cần thêm `VERIFICATION` nếu chưa thật sự cần.
- **Audit 1 coach rất dễ**:
  - Query `transactions` theo `user = coachUserId` và `metadata.purpose = 'ACCOUNT_VERIFICATION'`.
- **Tương thích với field owner**:
  - Field owner verify có thể dùng **cùng pattern**, chỉ khác:
    - `targetRole: 'field_owner'`.
    - Thêm `fieldOwnerId` hoặc `fieldId` trong `metadata`.

---

## 4. Mẫu pseudo-code tạo Transaction cho verify Coach

Ví dụ trong một service (NestJS pseudo-code), khi bạn đã có **paymentId** / trước khi tạo link PayOS:

```ts
async createCoachBankVerificationTransaction(
  coachUserId: string,
  coachProfileId: string,
  bankAccountNumber: string,
  bankName: string,
  method: PaymentMethod, // PAYOS / VNPAY / ...
): Promise<Transaction> {
  const tx = new this.transactionModel({
    booking: undefined,               // Không liên kết booking
    user: new Types.ObjectId(coachUserId),
    direction: 'in',
    type: TransactionType.PAYMENT,
    amount: 10000,
    method,
    status: TransactionStatus.PENDING,
    metadata: {
      purpose: 'ACCOUNT_VERIFICATION',
      targetRole: 'coach',
      coachId: coachProfileId,
      bankAccount: bankAccountNumber,
      bankName,
    },
  });

  await tx.save();
  return tx;
}
```

Sau đó bạn có thể:

- Dùng `tx._id` hoặc `tx.externalTransactionId` để map với giao dịch PayOS/VNPAY.
- Khi webhook trả kết quả:
  - Tìm lại `Transaction` theo `externalTransactionId` hoặc `_id`.
  - Cập nhật `status` + set `coach.bankVerified = true`.


