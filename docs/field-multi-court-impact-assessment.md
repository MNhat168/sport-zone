# Đánh Giá Tác Động: Chuyển Từ 1 Field = 1 Court Sang 1 Field Có Nhiều Court

## Tổng Quan

Hiện tại hệ thống đang sử dụng mô hình **1 Field = 1 Court**, nghĩa là mỗi Field entity đại diện cho một sân thể thao duy nhất. Khi chuyển sang mô hình **1 Field có nhiều Court** (ví dụ: Sân Thống Nhất có 8 court tennis), cần thay đổi cấu trúc dữ liệu và logic nghiệp vụ.

## Hiện Trạng

- **Field Entity**: Đại diện cho 1 sân (1 court)
- **Booking Entity**: Chỉ reference đến `field`, không có `court`
- **Schedule Entity**: Chỉ reference đến `field`, không có `court`
- **Availability Check**: Dựa trên `field + date`
- **Booking Creation**: Chỉ cần `fieldId`

## Các Thay Đổi Cần Thiết

### 1. Database Schema

#### Tạo Court Entity Mới
- Tạo module `courts` mới với entity `Court`
- Court có relationship với Field (many-to-one)
- Court có các thuộc tính: `name`, `courtNumber`, `isActive`
- Có thể có pricing riêng cho từng court (optional)

#### Cập Nhật Booking Entity
- Thêm field `court?: Types.ObjectId` (required cho field bookings)
- Giữ `field` để backward compatibility
- Index: `{ court: 1, date: 1, status: 1 }`

#### Cập Nhật Schedule Entity
- Thêm field `court?: Types.ObjectId` (required cho field schedules)
- Index: `{ court: 1, date: 1 }` unique
- Schedule giờ track theo court thay vì field

#### Cập Nhật TournamentFieldReservation
- Thêm field `court?: Types.ObjectId` (optional, có thể book nhiều court)

### 2. Booking Services

#### Availability Service
- **Thay đổi lớn**: Check availability theo `court` thay vì `field`
- Query Schedule và Booking theo `court` thay vì `field`
- API endpoint cần support: `GET /fields/:fieldId/courts/:courtId/availability`
- Hoặc trả về availability cho tất cả courts của field

#### Field Booking Service
- DTO cần thêm `courtId` (required)
- Validate `courtId` thuộc `fieldId`
- Tạo Schedule với `court` reference
- Check availability theo court cụ thể

#### Session Booking Service (Coach)
- Thêm `courtId` vào booking khi có field
- Validate coach có thể dạy tại court đó

### 3. API Endpoints

- **Field Availability**: Cần support court filtering
- **Booking Creation**: Require `courtId` trong request body
- **Field Management**: Thêm endpoints để CRUD courts của field

## Tác Động Theo Module

| Module | Mức Độ | Mô Tả |
|--------|--------|-------|
| **Courts Module** | 🔴 CRITICAL | Tạo module mới với CRUD operations |
| **Booking Service** | 🔴 CRITICAL | Thay đổi toàn bộ logic availability và booking creation |
| **Schedule Service** | 🔴 CRITICAL | Update để support court thay vì field |
| **Availability Service** | 🔴 CRITICAL | Rewrite logic để check theo court |
| **Field Booking Service** | 🔴 CRITICAL | Update DTOs, validation, và business logic |
| **Session Booking Service** | 🟡 MEDIUM | Update để support court khi có field |
| **Tournament Service** | 🟡 MEDIUM | Update field reservation logic |
| **Review Service** | 🟢 LOW | Optional - có thể thêm court reference |
| **Fields Service** | 🟡 MEDIUM | Thêm endpoints để list/manage courts |
| **API Controllers** | 🟡 MEDIUM | Update DTOs và validation rules |

## Rủi Ro Và Lưu Ý

### 1. Backward Compatibility
- Cần migration script để convert existing data
- Giữ `field` reference trong Booking/Schedule để tương thích
- Hoặc migrate toàn bộ data sang court-based model

### 2. Data Consistency
- Đảm bảo mỗi court thuộc đúng field
- Validate khi tạo booking: `court.field === fieldId`
- Prevent orphaned courts

### 3. Performance
- Thêm indexes: `{ court: 1, date: 1 }` cho Schedule
- Index: `{ court: 1, date: 1, status: 1 }` cho Booking
- Compound index: `{ field: 1, court: 1 }` cho Court

### 4. Business Logic
- **Pricing**: Court có thể override field pricing (optional)
- **Availability**: Check theo court, không phải field
- **Maintenance**: Có thể maintain từng court riêng
- **Booking Conflict**: Check conflict theo court cụ thể

## Kế Hoạch Triển Khai

### Phase 1: Setup (Tuần 1)
- Tạo Court entity và module
- Migration script: Tạo Court từ Field hiện có (1 field → 1 court)
- Setup indexes và relationships

### Phase 2: Core Booking (Tuần 2-3)
- Update Booking entity (thêm court field)
- Update Schedule entity (thêm court field)
- Rewrite Availability service
- Update Field booking service

### Phase 3: Integration (Tuần 4)
- Update Session booking (coach)
- Update Tournament field reservation
- Update API endpoints và DTOs
- Update Fields service

### Phase 4: Testing & Migration (Tuần 5)
- Test với data mới
- Migrate existing bookings và schedules
- Deploy và monitor

## Ước Tính Effort

- **Database Schema**: 2-3 ngày
- **Booking/Schedule Services**: 5-7 ngày
- **Availability Service**: 3-4 ngày
- **API & DTOs**: 2-3 ngày
- **Migration Scripts**: 2-3 ngày
- **Testing**: 3-5 ngày

**Tổng**: ~17-25 ngày (3-5 tuần)

## Kết Luận

Đây là một thay đổi **CRITICAL** ảnh hưởng đến core business logic của hệ thống booking. Cần:

1. ✅ Tạo Court entity và module mới
2. ✅ Update toàn bộ booking flow để support court
3. ✅ Migration existing data
4. ✅ Update API contracts
5. ✅ Comprehensive testing

**Khuyến nghị**: Triển khai theo từng phase, test kỹ ở mỗi phase trước khi chuyển sang phase tiếp theo.

