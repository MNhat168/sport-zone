## Kế hoạch refactor Booking Status (field + coach) và impact lên payment

Tài liệu này đề xuất **thiết kế mới cho trạng thái Booking** (field & coach), tách bạch rõ:

- **Trạng thái tổng thể booking** (lifecycle).
- **Trạng thái thanh toán** (payment).
- **Trạng thái duyệt** (owner/coach approval).

Đồng thời phân tích **impact** lên code booking & payment hiện tại.

---

## 1. Trạng thái hiện tại (tóm tắt)

### 1.1. Entity `Booking`

File: `src/modules/bookings/entities/booking.entity.ts`

- `status: BookingStatus` (`pending | confirmed | cancelled | completed`)
  - Dùng chung cho:
    - Field booking.
    - Coach booking.
- `note?: string`
- `noteStatus?: 'pending' | 'accepted' | 'denied'`
  - Dùng cho flow note của field (owner duyệt ghi chú).
- `requestedCoach?: CoachProfile`
- `coachStatus?: 'pending' | 'accepted' | 'declined'`
  - Dùng cho flow **coach accept/decline** booking.
- `transaction?: Transaction`
- `bookingAmount`, `platformFee`, `totalPrice?`, `pricingSnapshot`, ...

### 1.2. Cách dùng `status` hiện tại

#### Field booking (`createFieldBookingLazy`)

- Logic set `status`:
  - Nếu **online payment** (PayOS/VNPay/...) → `status = PENDING`.
  - Nếu **CASH + có note** → `status = PENDING` (chờ owner duyệt note).
  - Nếu **CASH + không note** → `status = CONFIRMED`.

=> `status = pending` đang gánh **2 ý**:

- Chờ thanh toán (online).
- Chờ duyệt note (CASH + note).

#### Coach booking (`coachStatus`)

- `coachStatus`:
  - `'pending'`: chờ coach phản hồi.
  - `'accepted'`: coach đồng ý.
  - `'declined'`: coach từ chối.
- BE hiện tại check:
  - Nếu `coachStatus !== 'pending'` thì không cho accept/decline lần nữa.
- `status` vẫn dùng cho lifecycle tổng thể (pending/confirmed/cancelled/completed), nhưng dễ gây nhầm:

```ts
status = 'pending'
coachStatus = 'pending' | 'accepted' | 'declined' ?
status = 'confirmed'
coachStatus = 'pending' ?
```

→ Khó đọc, khó biết “pending ở đâu”.

---

## 2. Mục tiêu refactor

- **Tách bạch 3 chiều trạng thái**:
  1. **Booking lifecycle** – booking nói chung đang ở bước nào (pending/confirmed/cancelled/completed).
  2. **Payment status** – thanh toán cho booking (unpaid/paid/refunded).
  3. **Approval status** – quyết định của owner/coach (pending/accepted/declined/...).
- **Giữ backward-compatible tối đa**:
  - Không xoá ngay `status`, `noteStatus`, `coachStatus`.
  - Thêm field mới, migrate dần.
- **Dễ debug / dễ query**:
  - Nhìn 1 booking là hiểu ngay:

```ts
status = 'pending'
paymentStatus = 'paid'
coachStatus = 'pending'
// => Đã thanh toán, đang chờ coach accept
```

---

## 3. Thiết kế đề xuất (mức logical)

### 3.1. Field Booking

Thêm 2 field **logical** (sau sẽ map vào schema):

```ts
interface FieldBooking {
  // 1. Lifecycle tổng thể (giữ Booking.status hiện tại)
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';

  // 2. Trạng thái thanh toán cho booking sân
  paymentStatus?: 'unpaid' | 'paid' | 'refunded';

  // 3. Trạng thái duyệt note (nếu có)
  approvalStatus?: 'pending' | 'approved' | 'rejected';

  // Metadata
  note?: string;
  paymentMethod: PaymentMethod;
}
```

#### Mapping logic field hiện tại → design mới (dự kiến)

- **Case 1: Online payment (không note)**

```ts
status = 'pending';          // Chưa hoàn thành booking
paymentStatus = 'unpaid';    // Chờ thanh toán
approvalStatus = undefined;  // Không có note

// Sau webhook success
status = 'confirmed';
paymentStatus = 'paid';
```

- **Case 2: CASH + có note**

```ts
status = 'pending';          // Chờ owner duyệt +/hoặc xử lý offline
paymentStatus = 'unpaid';    // Cash chưa thu
approvalStatus = 'pending';  // Chờ owner xem note

// Owner approve
status = 'confirmed';
approvalStatus = 'approved';
```

- **Case 3: CASH + không note**

```ts
status = 'confirmed';        // Auto-confirm
paymentStatus = 'unpaid';
approvalStatus = undefined;
```

### 3.2. Coach Booking

```ts
interface CoachBooking {
  // 1. Lifecycle tổng thể
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed';

  // 2. Payment status cho phần coach
  paymentStatus: 'unpaid' | 'paid' | 'refunded';

  // 3. Trạng thái coach phản hồi
  coachStatus: 'pending' | 'accepted' | 'declined';

  // Metadata
  paymentMethod: PaymentMethod;
}
```

#### Flow mẫu (coach booking online)

```ts
// Tạo booking mới (online payment)
status = 'pending';
paymentStatus = 'unpaid';
coachStatus = 'pending';

// Sau webhook thanh toán thành công
status = 'pending';      // vẫn pending vì còn chờ coach
paymentStatus = 'paid';  // ✅ thanh toán xong
coachStatus = 'pending';

// Coach accept
status = 'confirmed';
paymentStatus = 'paid';
coachStatus = 'accepted';

// Coach decline (sau khi refund)
status = 'cancelled';
paymentStatus = 'refunded';
coachStatus = 'declined';
```

### 3.3. Liên hệ với `Transaction`

- `Transaction.status`:
  - `PENDING`, `SUCCEEDED`, `FAILED`, `REFUNDED`, ...
- Booking `paymentStatus` có thể **map trực tiếp**:

```ts
Transaction.status = SUCCEEDED  → booking.paymentStatus = 'paid'
Transaction.status = REFUNDED   → booking.paymentStatus = 'refunded'
Transaction.status = PENDING    → booking.paymentStatus = 'unpaid'
```

---

## 4. Impact lên hệ thống hiện tại

### 4.1. Entity & DB

1. **Booking entity** cần được mở rộng:
   - Thêm field (tên dự kiến):
     - `paymentStatus?: 'unpaid' | 'paid' | 'refunded'`
     - `approvalStatus?: 'pending' | 'approved' | 'rejected'`
   - Giữ nguyên:
     - `status: BookingStatus`
     - `note`, `noteStatus`
     - `coachStatus`
2. DB migration:
   - Có thể làm **dần dần**:
     - Ban đầu, field mới có thể `undefined`.
     - Logic mới set giá trị cho booking mới.
     - Sau đó chạy script để backfill booking cũ nếu cần.

### 4.2. Booking service logic

#### FieldBookingService / BookingsService – `createFieldBookingLazy`

- Hiện tại:
  - Dùng `status` để encode:
    - Online payment → `PENDING`.
    - CASH + note → `PENDING`.
    - CASH + không note → `CONFIRMED`.
- Sau refactor (tư duy mới):
  - Khi tạo booking:
    - Set `status` + `paymentStatus` + `approvalStatus` **đồng bộ** theo bảng mapping ở trên.
  - Khi cập nhật theo webhook thanh toán:
    - Update `paymentStatus` theo `Transaction.status`.
    - Nếu logic hiện tại đang đổi `status` từ `PENDING` → `CONFIRMED`, cần đảm bảo **không làm hỏng flow coach/approval**.

=> **Impact mức logic**:

- Chỗ nào đang **if `status === 'pending'`** để kiểm tra:
  - Chờ thanh toán?
  - Hay chờ duyệt note?
- Sau refactor:
  - Code nên chuyển sang check theo **field đúng**:
    - `paymentStatus === 'unpaid'`
    - `approvalStatus === 'pending'`

#### Coach-related logic (`acceptCoachRequest`, `declineCoachRequest`)

- Hiện tại:
  - Check `coachStatus !== 'pending'`.
  - Không đụng tới `status`.
- Sau refactor:
  - Có thể vẫn dùng y như cũ (chỉ coachStatus).
  - Optional: update `status` theo coach:
    - Khi accept → `status = 'confirmed'` nếu payment đã `paid`.
    - Khi decline → `status = 'cancelled'` sau khi xử lý refund (nếu có).

### 4.3. Payment & Transaction flow

- `TransactionsService.createPayment`:
  - Không cần thay đổi interface.
  - Chỉ cần **ở nơi xử lý callback/webhook**, map thêm:
    - `Transaction.status` → `booking.paymentStatus`.
- `PaymentHandlerService`:
  - Hiện chịu trách nhiệm payout / chuyển tiền ví:
    - Có thể đọc `booking.paymentStatus` thay vì dựa quá nhiều vào `booking.status` tổng thể.

### 4.4. Frontend (user + admin)

- Các chỗ đang hiển thị/logic theo `status` sẽ bị impact:
  - Màn danh sách booking (filter trạng thái).
  - Badge màu theo trạng thái.
- Sau khi refactor:
  - Nên:
    - Giữ `status` để hiển thị “trạng thái tổng thể”.
    - Bổ sung icon/tooltip nhỏ cho:
      - Payment: `Đã thanh toán` / `Chưa thanh toán` / `Đã hoàn tiền`.
      - Coach: `Coach chưa phản hồi` / `Đã chấp nhận` / `Đã từ chối`.

---

## 5. Lộ trình refactor đề xuất

### Giai đoạn 1 – Chỉ thêm field & doc, chưa thay logic cũ

1. Thêm field mới vào `Booking` entity:
   - `paymentStatus?`
   - `approvalStatus?`
2. Cập nhật doc:
   - Đã mô tả trong file này + `coach-booking-design.md`.
3. Chưa thay đổi logic cũ:
   - `status`, `noteStatus`, `coachStatus` vẫn hoạt động như hiện tại.

### Giai đoạn 2 – Áp dụng dần cho booking mới

1. Trong `createFieldBookingLazy`:
   - Khi tạo booking mới:
     - Set `paymentStatus` + `approvalStatus` theo rule mapping.
2. Trong logic webhook/payment success/fail:
   - Bổ sung cập nhật `booking.paymentStatus`.
3. Trong coach booking:
   - Khi tạo coach booking:
     - Set `paymentStatus = 'unpaid'`.
   - Khi payment thành công:
     - Set `paymentStatus = 'paid'`.

### Giai đoạn 3 – Sử dụng field mới trong code

1. Tìm & update các chỗ:
   - `if (booking.status === 'pending')` → thay bằng:
     - `if (booking.paymentStatus === 'unpaid')` **hoặc**
     - `if (booking.approvalStatus === 'pending')` tùy ngữ cảnh.
2. UI:
   - Thêm hiển thị / filter dựa trên `paymentStatus`, `coachStatus`, `approvalStatus`.

### Giai đoạn 4 – Dọn dẹp (optional, lâu dài)

- Khi field mới đã dùng ổn định:
  - Cân nhắc:
    - Simplify cách set `status` để chỉ phản ánh **lifecycle tổng thể**.
    - Giảm việc encode nhiều nghĩa trong 1 field `status`.

---

## 6. Kết luận

- Thiết kế mới **không bắt buộc phải refactor ngay toàn bộ**, nhưng:
  - Rất nên được **ghi nhận lại** và áp dụng dần cho phần **coach booking** mới trước.
  - Field booking cũ có thể **từng bước** chuyển sang dùng `paymentStatus` + `approvalStatus`.
- Impact chính:
  - Backend: thêm field, update logic set trạng thái ở chỗ create/confirm/refund booking.
  - Frontend: hiển thị rõ hơn (payment + coach/owner approval).

Làm theo lộ trình này sẽ giúp hệ thống **đỡ “loạn pending”**, dễ debug và dễ mở rộng rule thanh toán/duyệt trong tương lai.


