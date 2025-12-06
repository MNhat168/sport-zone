# Bộ lọc trạng thái Booking (FE/BE)

## BE Swagger (đã cập nhật)
Endpoint: GET `/bookings/my-bookings`
- `status`: pending | confirmed | cancelled | completed (lifecycle)
- `paymentStatus`: unpaid | paid | refunded
- `approvalStatus`: pending | approved | rejected (duyệt note của owner)
- `coachStatus`: pending | accepted | declined
- `type`: field | coach

Endpoint: GET `/bookings/my-invoices`
- Trả về thêm các trường: `paymentStatus`, `approvalStatus`, `coachStatus`.

## Gợi ý FE
- Thanh filter bổ sung:
  - "Trạng thái thanh toán": unpaid/paid/refunded
  - "Trạng thái duyệt": pending/approved/rejected
  - "Coach": pending/accepted/declined
- Khi user chọn filter, FE gắn query tương ứng vào API.
- Badge/bookings list hiển thị song song lifecycle + payment/approval/coach (tooltip ngắn).
