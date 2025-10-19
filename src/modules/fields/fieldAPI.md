# Field API Documentation (Updated for Pure Lazy Creation)

This document outlines the API endpoints for field-related operations in the SportZone system.

## Base URL
```
/fields
```

**Important**: Use `/fields` (plural), not `/field/` (singular)

## Authentication

Most endpoints require authentication using JWT tokens:
```
Authorization: Bearer <access_token>
```

## Response Format

All successful responses are wrapped by a global interceptor into the following unified format:

```json
{
  "success": true,
  "data": { /* object or array */ }
}
```

## Endpoints Summary

### Tạo sân mới - 2 cách:

1. **POST `/fields`** (JSON) - Khi đã có URL ảnh sẵn
   - Content-Type: `application/json`
   - `images` là mảng URL string
   - Dùng khi ảnh đã được upload từ nơi khác

2. **POST `/fields/with-images`** (Multipart) - Upload ảnh trực tiếp
   - Content-Type: `multipart/form-data`
   - Upload ảnh trực tiếp, backend tự động upload lên S3
   - Tất cả số phải gửi dạng STRING
   - Các object/array phải gửi dạng JSON STRING

### Các trường OPTIONAL khi tạo sân:
- `images`: Có thể bỏ qua hoặc gửi `[]`
- `amenities`: Có thể bỏ qua hoặc gửi `[]`
- `priceRanges`: Có thể bỏ qua, hệ thống tự tạo multiplier 1.0 cho toàn bộ operatingHours

### Các trường BẮT BUỘC khi tạo sân:
- `name`, `sportType`, `description`
- `location` (phải có cả `address` và `geo.coordinates`)
- `operatingHours` (ít nhất 1 ngày)
- `slotDuration`, `minSlots`, `maxSlots`
- `basePrice`

## Endpoints

### Get Nearby Fields

- **Method**: `GET`
- **Path**: `/nearby`
- **Auth**: Public
- **Description**: Retrieve fields near a coordinate within a radius

**Query Parameters**:
- `lat` (required): Latitude number, between -90 and 90
- `lng` (required): Longitude number, between -180 and 180
- `radius` (optional, km): number (default 10, 1-100)
- `limit` (optional): number (default 20, 1-100)
- `sportType` (optional): `football|tennis|badminton|pickleball|basketball|volleyball|swimming|gym`

**Example**:

```
GET /fields/nearby?lat=16.0471&lng=108.2062&radius=5&sportType=football&limit=10
``

**Success 200** (interceptor wraps as `{ success, data }`):

```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "name": "Sân bóng Phú Nhuận",
    "location": "District 3, Ho Chi Minh City",
    "latitude": 10.776889,
    "longitude": 106.700981,
    "distance": 2.5,
    "rating": 4.5,
    "price": "150k/h",
    "sportType": "football",
    "images": [
      "https://example.com/field1.jpg"
    ],
    "isActive": true
  }
]
```

### Get All Fields

- **Method**: `GET`
- **Path**: `/`
- **Auth**: Public
- **Description**: Retrieve a list of all available fields with filtering

**Query Parameters**:
- `name` (optional): Filter by field name
- `location` (optional): Filter by location
- `sportType` (optional): Filter by sport type (FOOTBALL, BASKETBALL, TENNIS, etc.)

**Success 200**:

```json
[
  {
    "id": "507f1f77bcf86cd799439011",
    "owner": "507f1f77bcf86cd799439012",
    "name": "Sân bóng Phú Nhuận",
    "sportType": "FOOTBALL",
    "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
    "location": "District 3, Ho Chi Minh City",
    "images": [
      "https://example.com/field1.jpg",
      "https://example.com/field2.jpg"
    ],
    "operatingHours": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      },
      {
        "day": "tuesday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      }
    ],
    "slotDuration": 60,
    "minSlots": 1,
    "maxSlots": 4,
    "priceRanges": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "10:00",
        "multiplier": 1.0
      },
      {
        "day": "monday",
        "start": "18:00",
        "end": "22:00",
        "multiplier": 1.5
      }
    ],
    "basePrice": 150000,
    "isActive": true,
    "maintenanceNote": null,
    "maintenanceUntil": null,
    "rating": 4.5,
    "totalReviews": 128,
    "createdAt": "2025-01-15T00:00:00.000Z",
    "updatedAt": "2025-10-01T00:00:00.000Z"
  }
]
```

### Create New Field (JSON - Khi đã có URL ảnh sẵn)

- **Method**: `POST`
- **Path**: `/`
- **Auth**: Field Owner Only
- **Content-Type**: `application/json`
- **Description**: Tạo sân mới với dữ liệu JSON thuần. Sử dụng khi đã có URL ảnh sẵn (đã upload từ nơi khác).

**Request Body**:
```json
{
  "name": "Sân bóng Phú Nhuận",
  "sportType": "football",
  "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
  "location": {
    "address": "District 3, Ho Chi Minh City",
    "geo": {
      "type": "Point",
      "coordinates": [106.700981, 10.776889]
    }
  },
  "images": [
    "https://example.com/field1.jpg",
    "https://example.com/field2.jpg"
  ],
  "operatingHours": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    },
    {
      "day": "tuesday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    }
  ],
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    },
    {
      "day": "monday",
      "start": "18:00",
      "end": "22:00",
      "multiplier": 1.5
    }
  ],
  "basePrice": 150000,
  "amenities": [
    {
      "amenityId": "507f1f77bcf86cd799439020",
      "price": 150000
    },
    {
      "amenityId": "507f1f77bcf86cd799439021",
      "price": 50000
    }
  ]
}
```

**Lưu ý**:
- `images` là **OPTIONAL** - có thể bỏ qua hoặc gửi mảng rỗng `[]`
- `amenities` là **OPTIONAL** - có thể bỏ qua hoặc gửi mảng rỗng `[]`
- `priceRanges` là **OPTIONAL** - nếu không gửi, hệ thống sẽ tự tạo giá mặc định với multiplier 1.0 cho toàn bộ operatingHours

**Success 201**:
```json
{
  "id": "507f1f77bcf86cd799439011",
  "owner": "507f1f77bcf86cd799439012",
  "name": "Sân bóng Phú Nhuận",
  "sportType": "football",
  "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
  "location": {
    "address": "District 3, Ho Chi Minh City",
    "geo": {
      "type": "Point",
      "coordinates": [106.700981, 10.776889]
    }
  },
  "images": [
    "https://example.com/field1.jpg",
    "https://example.com/field2.jpg"
  ],
  "operatingHours": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    },
    {
      "day": "tuesday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    }
  ],
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    },
    {
      "day": "monday",
      "start": "18:00",
      "end": "22:00",
      "multiplier": 1.5
    }
  ],
  "basePrice": 150000,
  "isActive": true,
  "maintenanceNote": null,
  "maintenanceUntil": null,
  "rating": 0,
  "totalReviews": 0,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

### Create Field with Images (Multipart - Upload ảnh trực tiếp)

- **Method**: `POST`
- **Path**: `/with-images`
- **Auth**: Field Owner Only
- **Content-Type**: `multipart/form-data`
- **Description**: Tạo sân mới với upload ảnh trực tiếp. Backend sẽ tự động upload lên S3 và trả về URL.

**Request Body** (Form Data - multipart/form-data):

| Field | Type | Required | Example | Description |
|-------|------|----------|---------|-------------|
| `name` | string | ✅ | `Sân bóng Phú Nhuận` | Tên sân |
| `sportType` | string | ✅ | `football` | Loại thể thao (football/tennis/badminton/...) |
| `description` | string | ✅ | `Sân bóng đá 11 người, có đèn chiếu sáng` | Mô tả sân |
| `location` | string (JSON) | ✅ | `{"address":"District 3, Ho Chi Minh City","geo":{"type":"Point","coordinates":[106.700981,10.776889]}}` | Địa điểm (JSON string) |
| `operatingHours` | string (JSON) | ✅ | `[{"day":"monday","start":"06:00","end":"22:00","duration":60}]` | Giờ hoạt động (JSON string array) |
| `slotDuration` | string | ✅ | `60` | Thời lượng slot (phút) |
| `minSlots` | string | ✅ | `1` | Số slot tối thiểu |
| `maxSlots` | string | ✅ | `4` | Số slot tối đa |
| `priceRanges` | string (JSON) | ❌ | `[{"day":"monday","start":"06:00","end":"10:00","multiplier":1.0}]` | Khung giá (JSON string array) - OPTIONAL |
| `basePrice` | string | ✅ | `150000` | Giá cơ bản (VND) |
| `amenities` | string (JSON) | ❌ | `[{"amenityId":"507f1f77bcf86cd799439020","price":150000}]` | Danh sách tiện ích (JSON string array) - OPTIONAL |
| `images` | file[] | ❌ | `[file1.jpg, file2.jpg]` | Danh sách ảnh (tối đa 10 ảnh) - OPTIONAL |

**Lưu ý quan trọng**:
- **Tất cả các trường số phải gửi dạng STRING** (do multipart/form-data): `"60"`, `"150000"`, không phải `60`, `150000`
- **Các trường phức tạp phải gửi dạng JSON STRING**: `operatingHours`, `priceRanges`, `location`, `amenities`
- **images là OPTIONAL** - không upload cũng được, hệ thống sẽ tạo sân với `images: []`
- **amenities là OPTIONAL** - không gửi cũng được
- **priceRanges là OPTIONAL** - không gửi thì hệ thống tự tạo multiplier 1.0 cho toàn bộ operatingHours

**Example với CURL**:
```bash
curl -X POST "http://localhost:3000/fields/with-images" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "name=Sân bóng Phú Nhuận" \
  -F "sportType=football" \
  -F "description=Sân bóng đá 11 người, có đèn chiếu sáng" \
  -F 'location={"address":"District 3, Ho Chi Minh City","geo":{"type":"Point","coordinates":[106.700981,10.776889]}}' \
  -F 'operatingHours=[{"day":"monday","start":"06:00","end":"22:00","duration":60}]' \
  -F "slotDuration=60" \
  -F "minSlots=1" \
  -F "maxSlots=4" \
  -F 'priceRanges=[{"day":"monday","start":"06:00","end":"10:00","multiplier":1.0}]' \
  -F "basePrice=150000" \
  -F 'amenities=[{"amenityId":"507f1f77bcf86cd799439020","price":150000}]' \
  -F "images=@/path/to/image1.jpg" \
  -F "images=@/path/to/image2.jpg"
```

**Success 201**: 
```json
{
  "id": "507f1f77bcf86cd799439011",
  "owner": "507f1f77bcf86cd799439012",
  "name": "Sân bóng Phú Nhuận",
  "sportType": "football",
  "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
  "location": {
    "address": "District 3, Ho Chi Minh City",
    "geo": {
      "type": "Point",
      "coordinates": [106.700981, 10.776889]
    }
  },
  "images": [
    "https://sport-zone-bucket.s3.region.amazonaws.com/images/unique-filename-1.jpg",
    "https://sport-zone-bucket.s3.region.amazonaws.com/images/unique-filename-2.jpg"
  ],
  "operatingHours": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    }
  ],
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    }
  ],
  "basePrice": 150000,
  "isActive": true,
  "maintenanceNote": null,
  "maintenanceUntil": null,
  "rating": 0,
  "totalReviews": 0,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

  ### Get Field by ID

  - **Method**: `GET`
  - **Path**: `/:id`
  - **Auth**: Public
  - **Description**: Retrieve detailed information about a specific field

  **Parameters**:
  - `id`: Field ID (ObjectId)

  **Success 200**:

  ```json
  {
    "id": "507f1f77bcf86cd799439011",
    "owner": "507f1f77bcf86cd799439012",
    "name": "Sân bóng Phú Nhuận",
    "sportType": "FOOTBALL",
    "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
    "location": {
      "address": "District 3, Ho Chi Minh City",
      "geo": {
        "type": "Point",
        "coordinates": [106.700981, 10.776889]
      }
    },
    "images": [
      "https://example.com/field1.jpg",
      "https://example.com/field2.jpg"
    ],
    "operatingHours": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      },
      {
        "day": "tuesday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      }
    ],
    "slotDuration": 60,
    "minSlots": 1,
    "maxSlots": 4,
    "priceRanges": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "10:00",
        "multiplier": 1.0
      },
      {
        "day": "monday",
        "start": "18:00",
        "end": "22:00",
        "multiplier": 1.5
      }
    ],
    "basePrice": 150000,
    "isActive": true,
    "maintenanceNote": null,
    "maintenanceUntil": null,
    "rating": 4.5,
    "totalReviews": 128,
    "createdAt": "2025-01-15T00:00:00.000Z",
    "updatedAt": "2025-10-01T00:00:00.000Z"
  }
  ```

### Get Field Availability (Pure Lazy Creation)

- **Method**: `GET`
- **Path**: `/:id/availability`
- **Auth**: Public
- **Description**: Check field availability for date range with dynamic pricing

**Parameters**:
- `id`: Field ID (ObjectId)

**Query Parameters**:
- `startDate`: Start date (YYYY-MM-DD) - required
- `endDate`: End date (YYYY-MM-DD) - required

**Example**: `GET /fields/507f1f77bcf86cd799439011/availability?startDate=2025-10-01&endDate=2025-10-31`

**Success 200**:

```json
[
  {
    "date": "2025-10-15",
    "isHoliday": false,
    "slots": [
      {
        "startTime": "09:00",
        "endTime": "10:00",
        "available": true,
        "price": 150000,
        "priceBreakdown": "09:00-10:00: 1.0x base price"
      },
      {
        "startTime": "19:00",
        "endTime": "20:00",
        "available": false,
        "price": 225000,
        "priceBreakdown": "19:00-20:00: 1.5x base price (booked)"
      }
    ]
  }
]
```

### Schedule Price Update

- **Method**: `POST`
- **Path**: `/:id/schedule-price-update`
- **Auth**: Field Owner Only
- **Content-Type**: `application/json`
- **Description**: Lên lịch thay đổi giá cho sân trong tương lai

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body**:

```json
{
  "newOperatingHours": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    },
    {
      "day": "tuesday",
      "start": "06:00",
      "end": "22:00",
      "duration": 60
    }
  ],
  "newPriceRanges": [
    {
      "day": "monday",
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.2
    },
    {
      "day": "monday",
      "start": "18:00",
      "end": "22:00",
      "multiplier": 1.8
    }
  ],
  "newBasePrice": 200000,
  "effectiveDate": "2025-11-01"
}
```

**Lưu ý**:
- `effectiveDate` phải là ngày trong tương lai (sau hôm nay)
- Nếu đã có lịch cập nhật giá cho cùng ngày, nó sẽ bị ghi đè
- `newOperatingHours`, `newPriceRanges`, `newBasePrice` đều bắt buộc

**Success 201**:

```json
{
  "success": true
}
```

### Cancel Scheduled Price Update

- **Method**: `DELETE`
- **Path**: `/:id/scheduled-price-update`
- **Auth**: Required (Field Owner)
- **Description**: Cancel a pending price update

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body**:

```json
{
  "effectiveDate": "2025-11-01"
}
```

**Success 200**:

```json
{
  "success": true,
  "message": "Scheduled price update cancelled"
}
```

### Get Scheduled Price Updates

- **Method**: `GET`
- **Path**: `/:id/scheduled-price-updates`
- **Auth**: Field Owner Only
- **Description**: Lấy danh sách tất cả lịch cập nhật giá đang chờ cho sân

**Parameters**:
- `id`: Field ID (ObjectId)

**Success 200**:

```json
[
  {
    "newOperatingHours": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      }
    ],
    "newPriceRanges": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "10:00",
        "multiplier": 1.2
      }
    ],
    "newBasePrice": 200000,
    "effectiveDate": "2025-11-01T00:00:00.000Z",
    "applied": false,
    "createdBy": "507f1f77bcf86cd799439012"
  }
]
```

**Lưu ý**:
- Chỉ trả về các lịch chưa được apply (`applied: false`)
- Kết quả được sắp xếp theo `effectiveDate` tăng dần


### Update Field Information

- **Method**: `PUT`
- **Path**: `/:id`
- **Auth**: Field Owner Only
- **Content-Type**: `application/json`
- **Description**: Cập nhật thông tin sân (chỉ chủ sân mới được phép cập nhật)

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body** (tất cả các trường đều OPTIONAL):

```json
{
  "name": "Updated Field Name",
  "description": "Updated description",
  "images": ["https://example.com/new-image.jpg"],
  "location": {
    "address": "Updated location address",
    "geo": {
      "type": "Point",
      "coordinates": [106.700981, 10.776889]
    }
  },
  "operatingHours": [
    {
      "day": "monday",
      "start": "05:00",
      "end": "23:00",
      "duration": 90
    },
    {
      "day": "tuesday",
      "start": "05:00",
      "end": "23:00",
      "duration": 90
    }
  ],
  "slotDuration": 90,
  "minSlots": 2,
  "maxSlots": 6,
  "priceRanges": [
    {
      "day": "monday",
      "start": "05:00",
      "end": "08:00",
      "multiplier": 0.8
    },
    {
      "day": "monday",
      "start": "18:00",
      "end": "23:00",
      "multiplier": 2.0
    }
  ],
  "basePrice": 200000,
  "isActive": true,
  "maintenanceNote": "Maintenance scheduled",
  "maintenanceUntil": "2025-10-20",
  "amenities": [
    {
      "amenityId": "507f1f77bcf86cd799439020",
      "price": 150000
    }
  ]
}
```

**Lưu ý**:
- Tất cả các trường đều OPTIONAL - chỉ gửi các trường cần update
- `location` phải gửi đầy đủ cả `address` và `geo.coordinates`
- `amenities` nếu có sẽ **thay thế toàn bộ** danh sách amenities cũ (không merge)

**Success 200**:

```json
{
  "id": "507f1f77bcf86cd799439011",
  "owner": "507f1f77bcf86cd799439012",
  "name": "Updated Field Name",
  "sportType": "FOOTBALL",
  "description": "Updated description",
  "location": {
    "address": "Updated location address",
    "geo": {
      "type": "Point",
      "coordinates": [106.700981, 10.776889]
    }
  },
  "images": ["https://example.com/new-image.jpg"],
  "operatingHours": [
    {
      "day": "monday",
      "start": "05:00",
      "end": "23:00",
      "duration": 90
    },
    {
      "day": "tuesday",
      "start": "05:00",
      "end": "23:00",
      "duration": 90
    }
  ],
  "slotDuration": 90,
  "minSlots": 2,
  "maxSlots": 6,
  "priceRanges": [
    {
      "day": "monday",
      "start": "05:00",
      "end": "08:00",
      "multiplier": 0.8
    },
    {
      "day": "monday",
      "start": "18:00",
      "end": "23:00",
      "multiplier": 2.0
    }
  ],
  "basePrice": 200000,
  "isActive": true,
  "maintenanceNote": "Maintenance scheduled",
  "maintenanceUntil": "2025-10-20T00:00:00.000Z",
  "rating": 4.5,
  "totalReviews": 128,
  "createdAt": "2025-01-15T00:00:00.000Z",
  "updatedAt": "2025-10-05T00:00:00.000Z"
}
```

### Delete Field

- **Method**: `DELETE`
- **Path**: `/:id`
- **Auth**: Required (Field Owner)
- **Description**: Delete a field (only owner can delete)

**Parameters**:
- `id`: Field ID (ObjectId)

**Success 200**:

```json
{
  "success": true,
  "message": "Field deleted successfully"
}
```

## Error Responses

All errors follow standard NestJS format:

**400 Bad Request**:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

**401 Unauthorized**:

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**403 Forbidden**:

```json
{
  "statusCode": 403,
  "message": "Access denied. Field owner role required.",
  "error": "Forbidden"
}
```

**404 Not Found**:

```json
{
  "statusCode": 404,
  "message": "Field not found",
  "error": "Not Found"
}
```

## Common Mistakes & Solutions

### ❌ Lỗi thường gặp:

1. **Gửi số dạng number trong multipart/form-data**
   ```javascript
   // SAI ❌
   formData.append('slotDuration', 60);
   // ĐÚNG ✅
   formData.append('slotDuration', '60');
   ```

2. **Quên stringify JSON trong multipart/form-data**
   ```javascript
   // SAI ❌
   formData.append('operatingHours', operatingHoursArray);
   // ĐÚNG ✅
   formData.append('operatingHours', JSON.stringify(operatingHoursArray));
   ```

3. **Set Content-Type khi dùng FormData**
   ```javascript
   // SAI ❌
   headers: {
     'Content-Type': 'multipart/form-data'
   }
   // ĐÚNG ✅
   headers: {
     'Authorization': `Bearer ${token}`
     // KHÔNG set Content-Type, để browser tự set
   }
   ```

4. **Gửi sportType chữ hoa**
   ```javascript
   // SAI ❌
   sportType: 'FOOTBALL'
   // ĐÚNG ✅
   sportType: 'football'
   ```

5. **Thiếu trường bắt buộc trong location**
   ```javascript
   // SAI ❌
   location: { address: 'some address' }
   // ĐÚNG ✅
   location: {
     address: 'some address',
     geo: {
       type: 'Point',
       coordinates: [lng, lat] // [longitude, latitude]
     }
   }
   ```

6. **Nhầm thứ tự coordinates**
   ```javascript
   // SAI ❌
   coordinates: [lat, lng] // [10.776889, 106.700981]
   // ĐÚNG ✅
   coordinates: [lng, lat] // [106.700981, 10.776889]
   ```

7. **Gửi string rỗng cho images thay vì bỏ qua**
   ```javascript
   // SAI ❌
   images: ['']
   // ĐÚNG ✅
   images: [] // hoặc không gửi trường images
   ```

## Pure Lazy Creation Features

**Dynamic Availability**:
- No pre-created schedules required
- Availability computed in real-time based on existing bookings
- Supports complex pricing multipliers by time ranges

**Price Scheduling**:
- Field owners can schedule future price changes
- Automatic price updates at midnight on effective date
- Pending updates can be cancelled before being applied

**Slot Management**:
- Configurable slot duration (minimum 30 minutes)
- Min/max slots per booking to control reservation sizes
- Operating hours enforcement

## Notes

**SportType Values** (chữ thường):

- `football` - Bóng đá
- `tennis` - Tennis  
- `badminton` - Cầu lông
- `pickleball` - Pickleball
- `basketball` - Bóng rổ
- `volleyball` - Bóng chuyền
- `swimming` - Bơi lội
- `gym` - Gym

**Lưu ý**: Backend lưu và trả về chữ thường (`football`), KHÔNG phải chữ hoa (`FOOTBALL`)

**Time Format**:

- All times use HH:mm format (24-hour)
- Dates use YYYY-MM-DD format
- Timestamps follow ISO 8601 format

**Pricing Structure**:

- Base price + time-based multipliers
- Prices in VND (Vietnamese Dong)
- Dynamic pricing based on time slots

**Authentication**:

- JWT tokens required for owner-specific operations
- Public access for field listing and availability checks

## Updated Field Entity Structure

The field entity has been simplified to use direct properties instead of complex nested structures:

**Operating Hours**: Array of daily schedules with day-specific timing

```json
[
  {
    "day": "monday",
    "start": "06:00",
    "end": "22:00",
    "duration": 60
  },
  {
    "day": "tuesday",
    "start": "06:00",
    "end": "22:00",
    "duration": 60
  }
]
```

**Price Ranges**: Array of day and time-based multipliers

```json
[
  {
    "day": "monday",
    "start": "06:00",
    "end": "10:00",
    "multiplier": 1.0
  },
  {
    "day": "monday",
    "start": "18:00",
    "end": "22:00",
    "multiplier": 1.5
  }
]
```

**Slot Configuration**: Direct properties

- `slotDuration`: Duration in minutes (30-180)
- `minSlots`: Minimum bookable slots
- `maxSlots`: Maximum bookable slots
- `basePrice`: Base price per slot in VND

**Pending Price Updates**: Embedded array for scheduled updates

```json
[
  {
    "newPriceRanges": [...],
    "newBasePrice": 200000,
    "effectiveDate": "2025-11-01T00:00:00.000Z",
    "applied": false,
    "createdBy": "ownerId",
    "createdAt": "2025-10-01T10:30:00.000Z"
  }
]
```

## AWS S3 Integration

The `/with-images` endpoint supports automatic image upload to AWS S3:

- **Upload Process**: Images are uploaded to S3 with unique filenames
- **Storage Location**: `https://bucket-name.s3.region.amazonaws.com/images/unique-filename.ext`
- **Supported Formats**: JPEG, PNG, WebP
- **File Limits**: Maximum 10 images per field
- **Form Data**: All field data sent as form-data with images as file uploads

## Frontend Integration Examples

### 1. Tạo sân với JSON (có sẵn URL ảnh)

```javascript
const createFieldWithJSON = async (token) => {
  const response = await fetch('http://localhost:3000/fields', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Sân bóng Phú Nhuận',
      sportType: 'football',
      description: 'Sân bóng đá 11 người, có đèn chiếu sáng',
      location: {
        address: 'District 3, Ho Chi Minh City',
        geo: {
          type: 'Point',
          coordinates: [106.700981, 10.776889]
        }
      },
      images: [
        'https://example.com/field1.jpg',
        'https://example.com/field2.jpg'
      ], // OPTIONAL
      operatingHours: [
        { day: 'monday', start: '06:00', end: '22:00', duration: 60 },
        { day: 'tuesday', start: '06:00', end: '22:00', duration: 60 }
      ],
      slotDuration: 60,
      minSlots: 1,
      maxSlots: 4,
      priceRanges: [ // OPTIONAL
        { day: 'monday', start: '06:00', end: '10:00', multiplier: 1.0 },
        { day: 'monday', start: '18:00', end: '22:00', multiplier: 1.5 }
      ],
      basePrice: 150000,
      amenities: [ // OPTIONAL
        { amenityId: '507f1f77bcf86cd799439020', price: 150000 }
      ]
    })
  });
  
  const result = await response.json();
  return result.data; // { id, owner, name, ... }
};
```

### 2. Tạo sân với upload ảnh (Multipart Form Data)

```javascript
const createFieldWithImages = async (token, imageFiles) => {
  const formData = new FormData();
  
  // Thêm các trường text
  formData.append('name', 'Sân bóng Phú Nhuận');
  formData.append('sportType', 'football');
  formData.append('description', 'Sân bóng đá 11 người, có đèn chiếu sáng');
  
  // Thêm location (phải stringify thành JSON string)
  formData.append('location', JSON.stringify({
    address: 'District 3, Ho Chi Minh City',
    geo: {
      type: 'Point',
      coordinates: [106.700981, 10.776889]
    }
  }));
  
  // Thêm operatingHours (phải stringify thành JSON string)
  formData.append('operatingHours', JSON.stringify([
    { day: 'monday', start: '06:00', end: '22:00', duration: 60 },
    { day: 'tuesday', start: '06:00', end: '22:00', duration: 60 }
  ]));
  
  // Thêm các số (phải chuyển sang string)
  formData.append('slotDuration', '60');
  formData.append('minSlots', '1');
  formData.append('maxSlots', '4');
  formData.append('basePrice', '150000');
  
  // Thêm priceRanges (OPTIONAL - stringify thành JSON string)
  formData.append('priceRanges', JSON.stringify([
    { day: 'monday', start: '06:00', end: '10:00', multiplier: 1.0 },
    { day: 'monday', start: '18:00', end: '22:00', multiplier: 1.5 }
  ]));
  
  // Thêm amenities (OPTIONAL - stringify thành JSON string)
  formData.append('amenities', JSON.stringify([
    { amenityId: '507f1f77bcf86cd799439020', price: 150000 }
  ]));
  
  // Thêm ảnh (OPTIONAL - có thể bỏ qua)
  if (imageFiles && imageFiles.length > 0) {
    imageFiles.forEach(file => {
      formData.append('images', file);
    });
  }
  
  const response = await fetch('http://localhost:3000/fields/with-images', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
      // KHÔNG set Content-Type, để browser tự set với boundary
    },
    body: formData
  });
  
  const result = await response.json();
  return result.data; // { id, owner, name, images: [...S3 URLs], ... }
};
```

### 3. Cập nhật sân (chỉ update 1 vài trường)

```javascript
const updateField = async (token, fieldId, updates) => {
  const response = await fetch(`http://localhost:3000/fields/${fieldId}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Tên mới', // OPTIONAL
      basePrice: 200000, // OPTIONAL
      // Chỉ gửi các trường cần update
    })
  });
  
  const result = await response.json();
  return result.data;
};
```

### 4. Lấy sân gần đây (Public - không cần token)

```javascript
const getNearbyFields = async (lat, lng, radius = 10, sportType = null) => {
  const params = new URLSearchParams({
    lat: lat.toString(),
    lng: lng.toString(),
    radius: radius.toString(),
    limit: '20'
  });
  
  if (sportType) {
    params.append('sportType', sportType);
  }
  
  const response = await fetch(`http://localhost:3000/fields/nearby?${params}`);
  const result = await response.json();
  return result.data; // [{ id, name, distance, ... }]
};
```

## Field Amenities Management

### Get Field Amenities

- **Method**: `GET`
- **Path**: `/{fieldId}/amenities`
- **Auth**: Public
- **Description**: Retrieve all amenities associated with a field

**Success 200**:
```json
{
  "fieldId": "507f1f77bcf86cd799439011",
  "fieldName": "Sân bóng Phú Nhuận",
  "amenities": [
    {
      "amenity": {
        "_id": "507f1f77bcf86cd799439020",
        "name": "Huấn luyện viên bóng đá",
        "description": "Huấn luyện viên chuyên nghiệp với 5 năm kinh nghiệm",
        "sportType": "football",
        "isActive": true,
        "imageUrl": "https://example.com/coach.jpg",
        "type": "coach"
      },
      "price": 150000
    },
    {
      "amenity": {
        "_id": "507f1f77bcf86cd799439021",
        "name": "Nước uống",
        "description": "Nước suối, nước ngọt các loại",
        "sportType": "football",
        "isActive": true,
        "imageUrl": "https://example.com/drinks.jpg",
        "type": "drink"
      },
      "price": 50000
    }
  ]
}
```


### Update Field Amenities (Replace All)

- **Method**: `PUT`
- **Path**: `/{fieldId}/amenities`
- **Auth**: Field Owner Only
- **Description**: Replace all amenities for a field

**Request Body**:
```json
{
  "amenities": [
    {
      "amenityId": "507f1f77bcf86cd799439020",
      "price": 150000
    },
    {
      "amenityId": "507f1f77bcf86cd799439021",
      "price": 50000
    },
    {
      "amenityId": "507f1f77bcf86cd799439022",
      "price": 0
    }
  ]
}
```

**Success 200**:
```json
{
  "success": true,
  "message": "Updated field amenities",
  "field": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Sân bóng Phú Nhuận",
    "amenities": [
      {
        "amenity": {
          "_id": "507f1f77bcf86cd799439020",
          "name": "Huấn luyện viên bóng đá",
          "description": "Huấn luyện viên chuyên nghiệp với 5 năm kinh nghiệm",
          "sportType": "football",
          "isActive": true,
          "imageUrl": "https://example.com/coach.jpg",
          "type": "coach"
        },
        "price": 150000
      },
      {
        "amenity": {
          "_id": "507f1f77bcf86cd799439021",
          "name": "Nước uống",
          "description": "Nước suối, nước ngọt các loại",
          "sportType": "football",
          "isActive": true,
          "imageUrl": "https://example.com/drinks.jpg",
          "type": "drink"
        },
        "price": 50000
      },
      {
        "amenity": {
          "_id": "507f1f77bcf86cd799439022",
          "name": "Phòng thay đồ",
          "description": "Phòng thay đồ rộng rãi, có tủ khóa",
          "sportType": "football",
          "isActive": true,
          "imageUrl": "https://example.com/locker.jpg",
          "type": "facility"
        },
        "price": 0
      }
    ]
  }
}
```

## Amenities Integration Notes

### Amenity Types
- **coach**: Huấn luyện viên
- **drink**: Đồ uống
- **facility**: Cơ sở vật chất
- **other**: Khác

### Sport Types
- **football**: Bóng đá
- **tennis**: Tennis
- **badminton**: Cầu lông
- **pickleball**: Pickleball
- **basketball**: Bóng rổ
- **volleyball**: Bóng chuyền
- **swimming**: Bơi lội
- **gym**: Gym

### Usage Examples

**Get field amenities**:
```bash
curl -X GET "http://localhost:3000/fields/507f1f77bcf86cd799439011/amenities"
```

**Create field with amenities**:
```bash
curl -X POST "http://localhost:3000/fields" \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sân bóng Phú Nhuận",
    "sportType": "football",
    "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
    "location": {
      "address": "District 3, Ho Chi Minh City",
      "geo": {
        "type": "Point",
        "coordinates": [106.700981, 10.776889]
      }
    },
    "operatingHours": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "22:00",
        "duration": 60
      }
    ],
    "slotDuration": 60,
    "minSlots": 1,
    "maxSlots": 4,
    "priceRanges": [
      {
        "day": "monday",
        "start": "06:00",
        "end": "10:00",
        "multiplier": 1.0
      }
    ],
    "basePrice": 150000,
    "amenities": [
      {
        "amenityId": "507f1f77bcf86cd799439020",
        "price": 150000
      },
      {
        "amenityId": "507f1f77bcf86cd799439021",
        "price": 50000
      }
    ]
  }'
```

**Update field amenities**:
```bash
curl -X PUT "http://localhost:3000/fields/507f1f77bcf86cd799439011/amenities" \
  -H "Authorization: Bearer your_jwt_token" \
  -H "Content-Type: application/json" \
  -d '{
    "amenities": [
      {
        "amenityId": "507f1f77bcf86cd799439020",
        "price": 150000
      },
      {
        "amenityId": "507f1f77bcf86cd799439021",
        "price": 50000
      },
      {
        "amenityId": "507f1f77bcf86cd799439022",
        "price": 0
      }
    ]
  }'
```

### Error Handling

**Invalid amenity ID format**:
```json
{
  "statusCode": 400,
  "message": "Invalid amenity ID format: invalid-id"
}
```

**Field not found**:
```json
{
  "statusCode": 404,
  "message": "Field with ID 507f1f77bcf86cd799439011 not found"
}
```

**Access denied**:
```json
{
  "statusCode": 401,
  "message": "Access denied. Field owner only."
}
```
