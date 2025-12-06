## Thiết kế Booking Coach (tái sử dụng payment của Field)

Tài liệu này mô tả cách thêm **booking coach** vào hệ thống SportZone, ưu tiên:

- **Tái sử dụng tối đa** payment flow của booking sân (field).
- **Code đơn giản, rõ ràng**, dễ đọc – tránh over-engineering.
- **Dễ debug, dễ mở rộng** (thêm gateway, thêm rule tính tiền, v.v.).

---

## 1. Hiện trạng hệ thống (tóm tắt)

- **Entity `Booking`** (`src/modules/bookings/entities/booking.entity.ts`)
  - Có sẵn:
    - `type: 'field' | 'coach'` (`BookingType.FIELD | BookingType.COACH`) → **phân biệt booking sân vs booking coach**
    - `requestedCoach?: CoachProfile`
    - `coachStatus?: 'pending' | 'accepted' | 'declined'`
    - `bookingAmount`, `platformFee`, `totalPrice?`
    - `transaction?: Transaction` → liên kết **1 transaction PAYMENT chính** cho booking
- **Entity `Transaction`** (`src/modules/transactions/entities/transaction.entity.ts`)
  - Transaction thống nhất cho tất cả payment:
    - `method: PaymentMethod`
    - `type: TransactionType.PAYMENT | PAYOUT | FEE | REFUND_* | ADJUSTMENT | ...`
    - `status: TransactionStatus.PENDING | SUCCEEDED | ...`
    - `booking?: Booking` → **nếu là payment cho 1 booking cụ thể (field/coach)** thì sẽ set trường này
    - metadata cho VNPay / PayOS, payout, fee, v.v.
- **Flow booking sân (Field) – đã chuẩn**
  - Service: `BookingsService.createFieldBookingLazy(...)` (và `FieldBookingService` mới).
  - Logic:
    - Validate field + pricing.
    - Tạo `Booking` với:
      - `bookingAmount`, `platformFee`, `pricingSnapshot`.
    - **Tạo `Transaction`** qua `transactionsService.createPayment(...)`.
    - `booking.status`:
      - Online payment → `PENDING`.
      - Cash + không note → `CONFIRMED`.
- **Flow session (Field + Coach) – LEGACY**
  - `SessionBookingService.createSessionBooking(...)`:
    - Tạo 2 booking:
      - `type: FIELD`, `totalPrice = fieldPrice`.
      - `type: COACH`, `totalPrice = coachPrice`.
    - **Chưa** tạo `Transaction` / payment chuẩn mới.
    - Dùng `totalPrice` thô, không có `bookingAmount` + `platformFee`.

Kết luận: **hạ tầng payment/booking đã đủ**, chỉ thiếu flow **coach booking đời mới** bám vào logic field.

**Nguyên tắc cốt lõi:**

- **Booking**:
  - Dùng để phân biệt **loại đặt chỗ**: sân (`field`) hay coach (`coach`).
  - Thể hiện ở `Booking.type`.
- **Transaction**:
  - Dùng để ghi lại **dòng tiền** (tiền vào/ra hệ thống).
  - Phân biệt bản chất dòng tiền bằng `TransactionType`:
    - `PAYMENT`: khách / người dùng trả tiền cho hệ thống (thanh toán booking, thanh toán phí).
    - `PAYOUT`: hệ thống trả tiền cho field owner / coach.
    - `FEE`: phí nền tảng hệ thống thu.
    - `REFUND_*`, `ADJUSTMENT`, ...
  - Không dùng `TransactionType` để phân biệt field hay coach – phần đó do **Booking.type** đảm nhiệm (khi transaction gắn booking).

---

## 2. Mục tiêu thiết kế cho booking coach

- **M1 – Thống nhất payment:**
  - Booking coach dùng **cùng Transaction + PaymentMethod + PaymentHandlerService** như field.
- **M2 – Trạng thái rõ ràng:**
  - Online payment: `Booking.status = PENDING` cho đến khi gateway confirm.
  - Cash: có thể `CONFIRMED` ngay nếu không có ghi chú.
- **M3 – Đơn giản, rõ ràng:**
  - Tránh kiến trúc phức tạp.
  - Tách code field/coach rõ ràng, nhưng dùng chung **hàm core** để không duplicate logic.
- **M4 – Dễ debug:**
  - Một request booking → tối đa 1–2 booking + 1 transaction.
  - Log đầy đủ: bookingId, transactionId, gateway URL, amount, type.

---

## 3. Hai cách tiếp cận chính

### Cách 1 – Booking coach **riêng**, payment riêng (Đề xuất cho giai đoạn đầu)

**Ý tưởng:**
- Người dùng có thể:
  - Book sân bình thường (`Booking.type = 'field'`).
  - Book coach riêng (gắn với 1 sân / slot) (`Booking.type = 'coach'`) với **payment riêng**.
- Mỗi booking (field / coach) có **1 transaction PAYMENT riêng**, flow đơn giản, ít ràng buộc:
  - `Transaction.type = PAYMENT`, `direction = 'in'`, `booking = bookingId`.

**Ưu điểm:**
- Dễ code, dễ test, ít rủi ro.
- Khi debug: mỗi booking có transaction riêng → tra log, DB rất dễ.
- Không đụng sâu tới logic phức tạp của combo.

**Nhược điểm:**
- Nếu người dùng book combo sân + coach, họ sẽ:
  - Thanh toán 2 lần (1 cho sân, 1 cho coach) – UX hơi kém.

**Phù hợp khi:**
- Hệ thống đang trong giai đoạn build MVP / pilot.
- Ưu tiên **ổn định, dễ bảo trì** hơn là UX tối ưu.

#### 3.1.1. Backend – Cách 1

1. **DTO mới cho coach booking**
   - Tạo `CreateCoachBookingLazyDto`, ví dụ:
     - `fieldId: string`
     - `coachId: string`
     - `date: string`
     - `startTime: string`
     - `endTime: string`
     - `paymentMethod?: PaymentMethod`
     - `note?: string`
     - `paymentNote?: string`
2. **Hàm core tái sử dụng logic field**
   - Trong `BookingsService` (hoặc `FieldBookingService`), viết hàm private:
     - `createCoachBookingLazyCore(userId, dto, session): Promise<Booking>`
   - Bên trong:
     - Validate `field`, `coach`.
     - Tính duration + giá coach (dựa trên `coach.ratePerHour` / `lessonTypes`).
     - Tính:
       - `bookingAmount` (tiền coach thuần).
       - `platformFee` (5% hoặc config).
       - `totalPrice = bookingAmount + platformFee` (backward compat).
     - Xác định `bookingStatus` dựa vào `paymentMethod` + `note` (giống field).
     - Tạo `Booking`:
       - `type: BookingType.COACH`
       - `requestedCoach: coachId`
       - `pricingSnapshot` mô tả giá coach.
     - Tạo **Transaction PAYMENT** cho booking coach:
       - Sử dụng **cùng hàm** `transactionsService.createPayment` giống field:
         - `bookingId = coachBooking._id`
         - `userId = userId` (khách đặt coach)
         - `amount = bookingAmount + platformFee`
         - `method = dto.paymentMethod`
         - `paymentNote = dto.paymentNote`
       - Kết quả:
         - `Transaction.type = PAYMENT`
         - `Transaction.direction = 'in'`
         - `Transaction.booking = coachBookingId`
       - Optional (cho dễ báo cáo):
         - Set thêm `metadata: { bookingType: 'coach' }` nếu cần.
     - Gán `booking.transaction = transaction._id` để booking tham chiếu đúng payment chính.
3. **Public API**
   - Trong `BookingsController`:
     - Thêm `POST /bookings/coach/lazy`:
       - Lấy `userId` từ token.
       - Gọi `bookingsService.createCoachBookingLazy(userId, dto)`.

#### 3.1.2. Frontend user – Cách 1

1. **Types & API**
   - Trong `src/types/booking-type.ts`:
     - Thêm `CreateCoachBookingLazyPayload` tương ứng DTO backend.
   - Trong `bookingThunk.ts`:
     - Thêm thunk `createCoachBookingLazy`.
2. **UI flow**
   - Tạo **trang / tab đặt coach**:
     - Chọn sân → chọn coach → chọn khung giờ → sang bước Payment.
   - Tái sử dụng **`PaymentTab`**:
     - Truyền props kiểu:
       - `mode="coach"`
       - `onCreateBooking = () => dispatch(createCoachBookingLazy(...))`
       - `bookingType = 'coach'` (nếu cần phân biệt khi hiển thị).
3. **Payment**
   - Làm tương tự field:
     - Gọi API tạo booking coach.
     - Lấy `booking.transaction` / `transactionId` / `amount` từ response (thường BE trả về booking đã gắn transaction).
     - Gọi API backend tạo PayOS/VNPay link (nếu có).
     - Redirect user sang gateway.

---

### Cách 2 – Booking **combo field + coach** với **1 payment chung**

**Ý tưởng:**
- Một lần book → tạo 2 booking:
  - `fieldBooking` và `coachBooking`.
- Tạo **một Transaction duy nhất** cho cả combo:
  - `amount = totalAmountField + totalAmountCoach`.

**Ưu điểm:**
- UX tốt nhất: user thanh toán 1 lần.
- Rõ ràng từ góc nhìn “hóa đơn”: 1 payment chứa cả sân + coach.

**Nhược điểm:**
- Phức tạp hơn khi:
  - Hủy 1 trong 2 booking (refund partial?).
  - Thay đổi giờ cho coach mà không đổi sân (hoặc ngược lại).
  - Payout chia tiền cho **field owner** & **coach** từ 1 transaction.

**Phù hợp khi:**
- Muốn UX/classic e-commerce style (1 order gồm nhiều item).
- Chấp nhận chi thêm effort để làm refund / payout đẹp.

#### 3.2.1. Backend – Cách 2 (concept)

1. **DTO session booking lazy**
   - Mở rộng DTO hiện tại (`CreateSessionBookingPayload`) thành dạng lazy + payment:
     - `fieldId`, `coachId`, `date`, `fieldStartTime`, `coachStartTime`, ...
     - `paymentMethod`, `note`, `paymentNote`.
2. **Hàm core**
   - Trong 1 transaction Mongo:
     - Tạo `fieldBooking` giống `createFieldBookingLazyCore`.
     - Tạo `coachBooking` giống `createCoachBookingLazyCore`.
     - Tính số tiền:
       - `amount = fieldTotalAmount + coachTotalAmount`.
     - Tạo **1 Transaction**:
       - `booking` liên kết với một trong hai (hoặc bỏ trống, lưu mapping ở `metadata`).
       - Hoặc dùng `relatedTransaction` nếu muốn tách nhỏ sau.
3. **Payout / check-in**
   - `PaymentHandlerService.handleCheckInSuccess`:
     - Nếu check-in cho booking field:
       - Payout cho field owner như hiện tại.
     - Nếu check-in cho booking coach:
       - Payout cho coach (dùng trường `payoutTo` trên `Transaction` hoặc tạo transaction payout riêng).

#### 3.2.2. Frontend user – Cách 2 (concept)

1. **Flow UI**
   - Người dùng book combo từ một màn hình:
     - Chọn sân, giờ sân.
     - Chọn coach, giờ coach.
     - Xem tổng tiền (sân + coach + phí nền tảng).
     - Thanh toán 1 lần qua `PaymentTab`.
2. **PaymentTab**
   - `PaymentTab` gọi một thunk `createSessionBookingLazy`:
     - Backend trả về `{ fieldBooking, coachBooking, amount, transactionId }`.
   - FE dùng `amount` + `transactionId` để gọi API tạo PayOS link.

---

## 4. Đề xuất lựa chọn & lộ trình

**Giai đoạn 1 – Ưu tiên đơn giản, dễ debug (khuyến nghị):**

- Áp dụng **Cách 1**:
  - Coach booking riêng, payment riêng.
  - Tái sử dụng cấu trúc:
    - `CreateFieldBookingLazyDto` → `CreateCoachBookingLazyDto`.
    - `createFieldBookingLazyCore` → `createCoachBookingLazyCore`.
  - Chỉ cần thêm:
    - 1–2 DTO.
    - 1 service method.
    - 1 endpoint (`POST /bookings/coach/lazy`).
    - 1 thunk + 1 flow UI đơn giản.

**Giai đoạn sau – Nâng UX:**

- Khi hệ thống ổn định:
  - Mở rộng thành **Cách 2**:
    - Combo field + coach với 1 payment.
    - Bổ sung xử lý refund / payout chi tiết hơn.

---

## 5. Nguyên tắc coding để dễ fix bug & update

- **Tách hàm core**:
  - Không nhét toàn bộ logic vào controller.
  - Tạo hàm private như `createFieldBookingLazyCore`, `createCoachBookingLazyCore`:
    - Input: `userId`, DTO, `session`.
    - Output: `Booking`.
- **Log rõ ràng**:
  - Mỗi bước quan trọng log:
    - `bookingId`, `userId`, `fieldId`, `coachId`, `transactionId`, `amount`, `paymentMethod`.
  - Dùng `Logger` của NestJS với prefix service (vd: `CoachBookingService`).
- **Giữ DTO/FE/Docs đồng bộ**:
  - Mỗi khi thêm field mới vào DTO:
    - Cập nhật: DTO backend → types FE → Postman / docs → commit nhỏ, dễ review.
- **Ưu tiên transaction ngắn, rõ ràng**:
  - Mọi thao tác booking + payment nên nằm trong **1 session Mongo**.
  - Nếu có lỗi, rollback, log chi tiết.

---

## 6. Logic core cho PAYMENT & VERIFICATION (tổng hợp)

### 6.1. PAYMENT cho booking (field / coach)

- **Mỗi booking** (dù là `field` hay `coach`) có đúng **1 transaction PAYMENT chính**:
  - Được tạo qua `transactionsService.createPayment(...)`.
  - Cấu trúc chính:

```ts
{
  booking: bookingId,             // field hoặc coach booking
  user: userId,                   // khách đặt
  direction: 'in',                // tiền vào hệ thống
  type: TransactionType.PAYMENT,  // thanh toán booking
  amount: bookingAmount + platformFee,
  method: paymentMethod,
  status: TransactionStatus.PENDING | SUCCEEDED,
  notes: paymentNote,
  // Optional: phân biệt field/coach qua metadata nếu cần
  metadata: { bookingType: 'field' | 'coach' },
}
```

- **Phân biệt field/coach**:
  - Chủ yếu dựa vào `Booking.type` (`'field' | 'coach'`).
  - `TransactionType` **không cần** phân biệt field/coach.

### 6.2. VERIFICATION tài khoản ngân hàng (field owner / coach)

- Đây **không phải booking**, mà là **phí xác thực tài khoản ngân hàng** (ví dụ 10k).
- Transaction cho verification:
  - Không có `booking`.
  - `direction = 'in'`.
  - `type`:
    - Field owner hiện tại dùng `TransactionType.FEE` với:
      - `metadata.verificationType = 'BANK_ACCOUNT_VERIFICATION'`.
    - Coach có thể dùng:
      - `TransactionType.PAYMENT` **hoặc** `TransactionType.FEE` (tùy bạn muốn thống nhất hay không).
      - Phân biệt rõ qua `metadata`.
- **Pattern chung gợi ý (đơn giản, dễ query)**:

```ts
{
  booking: undefined,                  // không gắn booking
  user: userId,                        // field owner hoặc coach
  direction: 'in',
  type: TransactionType.PAYMENT,       // hoặc FEE nếu bạn muốn giống field owner
  amount: verificationAmount,          // ví dụ 10000
  method: PaymentMethod.PAYOS,
  status: TransactionStatus.PENDING | SUCCEEDED,
  metadata: {
    purpose: 'ACCOUNT_VERIFICATION',   // đánh dấu đây là verify
    targetRole: 'coach' | 'field_owner',
    bankAccount: bankAccountNumber,
    bankName,
    bankAccountId,                     // nếu có entity riêng
  },
}
```

- **Impact design**:
  - PAYMENT cho booking field/coach và PAYMENT/FEE cho verification được phân biệt bởi:
    - Có hay không `booking`.
    - `metadata.purpose` / `metadata.verificationType`.
  - Rất dễ lọc:
    - Tất cả verify: `metadata.purpose = 'ACCOUNT_VERIFICATION'`.
    - Tất cả booking: `booking != null`.

---

## 7. Checklist triển khai nhanh (Cách 1)

1. Backend:
   - [ ] Tạo `CreateCoachBookingLazyDto`.
   - [ ] Implement `createCoachBookingLazyCore` (tương tự field).
   - [ ] Thêm `BookingsService.createCoachBookingLazy`.
   - [ ] Thêm route `POST /bookings/coach/lazy`.
2. Frontend user:
   - [ ] Thêm type `CreateCoachBookingLazyPayload`.
   - [ ] Thêm thunk `createCoachBookingLazy`.
   - [ ] Tạo UI đặt coach + dùng lại `PaymentTab` (mode `"coach"`).
3. Admin:
   - [ ] Thêm filter `type = 'coach'` trong list booking/invoice (nếu cần).

Làm xong checklist này là đã có **booking coach** đơn giản, tái sử dụng payment của field và đủ dễ để debug / mở rộng về sau.


