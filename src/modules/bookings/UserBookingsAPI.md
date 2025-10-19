# User Bookings API Documentation

## Get My Bookings

### Endpoint
- **Method**: `GET`
- **Path**: `/bookings/my-bookings`
- **Auth**: Required (JWT Bearer Token)
- **Description**: Lấy danh sách booking của user hiện tại với filtering và pagination

### Query Parameters
| Parameter | Type | Required | Description | Example |
|-----------|------|----------|-------------|---------|
| `status` | string | No | Filter theo trạng thái booking | `confirmed` |
| `type` | string | No | Filter theo loại booking | `field` |
| `limit` | number | No | Số booking mỗi trang (1-100, default: 10) | `10` |
| `page` | number | No | Trang hiện tại (bắt đầu từ 1, default: 1) | `1` |

#### Status Values
- `pending` - Đang chờ xác nhận
- `confirmed` - Đã xác nhận  
- `cancelled` - Đã hủy
- `completed` - Hoàn thành

#### Type Values
- `field` - Booking sân
- `coach` - Booking huấn luyện viên

### Example Request
```bash
GET /bookings/my-bookings?status=confirmed&type=field&limit=5&page=1
Authorization: Bearer your_jwt_token
```

### Success Response (200)
```json
{
  "success": true,
  "data": {
    "bookings": [
      {
        "_id": "507f1f77bcf86cd799439011",
        "field": {
          "_id": "507f1f77bcf86cd799439013",
          "name": "Sân bóng Phú Nhuận",
          "location": {
            "address": "District 3, Ho Chi Minh City",
            "geo": {
              "type": "Point",
              "coordinates": [106.700981, 10.776889]
            }
          },
          "images": ["https://example.com/field1.jpg"],
          "sportType": "football",
          "owner": {
            "fullName": "Nguyễn Văn A",
            "phoneNumber": "0987654321",
            "email": "owner@example.com"
          }
        },
        "requestedCoach": {
          "user": {
            "fullName": "Coach Nguyễn",
            "phoneNumber": "0987654322",
            "email": "coach@example.com"
          },
          "hourlyRate": 200000,
          "sports": ["football"]
        },
        "date": "2025-10-15T00:00:00.000Z",
        "startTime": "09:00",
        "endTime": "11:00",
        "numSlots": 2,
        "type": "field",
        "status": "confirmed",
        "totalPrice": 300000,
        "selectedAmenities": [
          {
            "_id": "507f1f77bcf86cd799439020",
            "name": "Nước uống",
            "price": 50000
          }
        ],
        "amenitiesFee": 50000,
        "cancellationReason": null,
        "createdAt": "2025-10-10T08:30:00.000Z",
        "updatedAt": "2025-10-10T08:35:00.000Z"
      }
    ],
    "pagination": {
      "total": 25,
      "page": 1,
      "limit": 5,
      "totalPages": 5,
      "hasNextPage": true,
      "hasPrevPage": false
    }
  }
}
```

### Error Responses

#### 401 Unauthorized
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Authentication required",
    "timestamp": "2025-10-19T10:30:00.000Z"
  }
}
```

#### 400 Bad Request
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_FAILED", 
    "message": "Invalid query parameters",
    "details": [
      "limit must not be greater than 100",
      "page must not be less than 1"
    ]
  }
}
```

### Response Data Structure

#### Booking Object Fields
| Field | Type | Description |
|-------|------|-------------|
| `_id` | string | ID của booking |
| `field` | object | Thông tin sân (populated) |
| `requestedCoach` | object/null | Thông tin coach nếu có |
| `date` | string | Ngày đặt (ISO format) |
| `startTime` | string | Giờ bắt đầu (HH:mm) |
| `endTime` | string | Giờ kết thúc (HH:mm) |
| `numSlots` | number | Số slots đã đặt |
| `type` | string | Loại booking |
| `status` | string | Trạng thái booking |
| `totalPrice` | number | Tổng tiền (VND) |
| `selectedAmenities` | array | Danh sách tiện ích đã chọn |
| `amenitiesFee` | number | Phí tiện ích (VND) |
| `cancellationReason` | string/null | Lý do hủy (nếu có) |
| `createdAt` | string | Ngày tạo |
| `updatedAt` | string | Ngày cập nhật cuối |

#### Pagination Object Fields
| Field | Type | Description |
|-------|------|-------------|
| `total` | number | Tổng số booking |
| `page` | number | Trang hiện tại |
| `limit` | number | Số booking mỗi trang |
| `totalPages` | number | Tổng số trang |
| `hasNextPage` | boolean | Có trang tiếp theo không |
| `hasPrevPage` | boolean | Có trang trước không |

### Usage Examples

#### Lấy tất cả booking
```bash
GET /bookings/my-bookings
```

#### Lấy booking đã xác nhận
```bash
GET /bookings/my-bookings?status=confirmed
```

#### Lấy booking sân trang 2
```bash
GET /bookings/my-bookings?type=field&page=2&limit=5
```

#### Lấy booking đã hủy với lý do
```bash
GET /bookings/my-bookings?status=cancelled
```

### Notes
- Booking được sắp xếp theo thời gian tạo giảm dần (mới nhất trước)
- Field information được populate với thông tin owner
- Coach information được populate nếu có requestedCoach
- Amenities được populate với tên và giá
- Default pagination: 10 items per page
- Maximum limit: 100 items per page
- Minimum page: 1