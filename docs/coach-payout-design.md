# Thiết kế payout khi check-in cho Booking Coach

Mục tiêu: Khi khách check-in thành công buổi học với coach, hệ thống chuyển `bookingAmount` vào `pendingBalance` của ví coach, giữ `platformFee` trong ví hệ thống (admin).

## Nguyên tắc
- Payment đã thành công trước đó (`paymentStatus = 'paid'`).
- Payout diễn ra khi có sự kiện check-in (tương tự field owner).
- Idempotent: không chuyển tiền lặp lại nếu đã chuyển.

## Điểm chạm hệ thống
- `PaymentHandlerService.handleCheckInSuccess(bookingId)`
  - Nếu `booking.type === 'coach'`:
    - Lấy `bookingAmount` (doanh thu coach).
    - Trừ từ `adminWallet.systemBalance` số tiền `bookingAmount`.
    - Cộng vào `coachWallet.pendingBalance` số tiền `bookingAmount`.
    - Ghi log + emit event `wallet.transfer.completed`.

## Cần bổ sung
- `WalletService.getOrCreateWallet(userId, ROLE=COACH)` nếu chưa có.
- Ràng buộc: Coach phải `bankVerified === true` để nhận payout.
  - Nếu chưa verified → trả lỗi có hướng dẫn (gọi `/transactions/coach-verification`).

## Pseudo-code
```ts
if (booking.type === 'coach') {
  if (!coach.bankVerified) throw new Error('Coach bank not verified');
  const amount = booking.bookingAmount; // platformFee giữ trong admin
  const admin = await walletService.getOrCreateWallet('ADMIN_SYSTEM_ID', ADMIN);
  const coachWallet = await walletService.getOrCreateWallet(coachUserId, COACH);
  if (admin.systemBalance < amount) throw new Error('Insufficient system balance');
  admin.systemBalance -= amount;
  coachWallet.pendingBalance += amount;
  await admin.save();
  await coachWallet.save();
  emit('wallet.transfer.completed', { bookingId, coachUserId, amount });
}
```

## Kiểm thử
- Case thành công: check-in sau payment → pendingBalance tăng đúng.
- Case thiếu số dư hệ thống: báo lỗi rõ ràng.
- Case coach chưa verify: từ chối + hướng dẫn.
