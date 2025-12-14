# Kế hoạch hoàn thiện hỗ trợ multi-court

## Bối cảnh
- Booking/Schedule/Availability đã gắn `court`, nhưng thiếu lớp quản lý court và cập nhật UI/field config.
- Mục tiêu: hoàn thiện CRUD court, expose API, cập nhật FE (owner + user + admin) và cấu hình giá/slot theo court, đảm bảo migrate dữ liệu cũ.

## Phạm vi ưu tiên (tuần 1-2)
1) Backend - Courts API
- Tạo controller/service cho module `courts`: CRUD court (create/update/deactivate), list courts by field, bulk seed/migrate.
- Validate ownership (owner or admin) và guard role.
- Ràng buộc: unique `courtNumber` per field; optional pricingOverride (basePrice/priceRanges).
- Wire courts module vào bookings/fields modules (imports/providers) nếu cần service dùng chung.

2) Backend - Booking/Availability hardening
- Field availability endpoint: cho phép trả danh sách court + slots khi không truyền `courtId` (multi-court UX), hoặc giữ bắt buộc `courtId` kèm error rõ ràng.
- Đảm bảo tất cả booking create/hold/reschedule DTOs require `courtId` (field bookings).
- Add court populate to owner/user booking detail endpoints (owner detail, user detail modal).

3) Backend - Migration & data integrity
- Migration script: mỗi Field tạo tối thiểu 1 Court từ dữ liệu hiện có; map bookings/schedules hiện tại sang court mới.
- Index review: confirm `{ court:1,date:1,status:1 }` Booking, `{ court:1,date:1 }` Schedule; add `{ field:1,courtNumber:1 }` Court (đã có).
- Backfill court references in historical bookings/schedules; add verification command.

4) Frontend - Owner/Field management
- Owner dashboard: thêm màn/quy trình CRUD court (tên/number/status/pricing override).
- Field detail/config pages: hiển thị danh sách court, trạng thái, giá/override.
- Booking list/owner detail: hiển thị court name/number rõ ràng.

5) Frontend - User booking flow
- Field discovery/detail: hiển thị courts; allow chọn court trước khi xem slot.
- Availability fetch: nếu field có nhiều court, yêu cầu chọn court hoặc call endpoint trả về slots theo court.
- Booking steps (select slot, confirm): bắt buộc `courtId`, hiển thị court chosen; pipe vào create booking payload.

6) Frontend - Admin
- Admin bookings table/detail: đã populate `court`; bổ sung filter by courtId, hiển thị ở detail drawer/page (nếu có).
- Courts management for admin (optional): list courts per field for support.

7) QA & monitoring
- Test matrix: single-court vs multi-court fields; booking create/cancel/reschedule; availability validation; owner CRUD; admin list/filter.
- Add minimal e2e/smoke: create field->add court->book->cancel; reschedule once we define API.
- Observability: log booking creates missing courtId; dashboard for multi-court usage.

## Phân chia tuần (gợi ý)
- Tuần 1: Courts API + migration script skeleton + owner CRUD UI khung.
- Tuần 2: Availability/booking DTO hardening + FE user flow chọn court + admin filter + QA smoke.

## Phụ thuộc / câu hỏi mở
- Pricing per-court: chỉ override basePrice/priceRanges hay cả slotDuration/min/max? (hiện Court chưa có slotDuration riêng).
- Reschedule API chưa định nghĩa: cần yêu cầu `courtId` mới? (task kế tiếp).
- Nếu field có 1 court, có thể auto chọn để giảm UI bước?

## Checklist hành động theo impact assessment (đang thiếu)
- [ ] Courts API: controller + service CRUD/list, guard owner/admin, error rõ khi field multi-court thiếu courtId.
- [ ] Migration script: tạo court mặc định cho field cũ, backfill bookings/schedules, verify report.
- [ ] Availability endpoint: hỗ trợ trả slots theo từng court hoặc yêu cầu courtId, message rõ.
- [ ] Booking create/cancel/reschedule DTOs: require `courtId`; FE gửi `courtId` mọi nơi (reschedule còn thiếu).
- [ ] Owner FE: màn quản lý court (list/add/edit/status, pricing override).
- [ ] User FE: chọn court trước khi xem slot/đặt; hiển thị court trong detail/history/invoice.
- [ ] Admin: filter courtId + hiển thị court ở detail/drawer.
- [ ] Pricing/slot per-court: quyết định có slotDuration/min/max override; nếu có, bổ sung schema + UI.

