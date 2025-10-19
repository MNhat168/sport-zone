# 🏟️ AMENITIES API DOCUMENTATION

## 📋 Tổng quan
Module Amenities quản lý các tiện ích của hệ thống như huấn luyện viên, đồ uống, cơ sở vật chất, v.v.

**Tính năng chính:**
- ✅ CRUD operations đầy đủ cho amenities
- ✅ Phân trang và filtering nâng cao
- ✅ Upload hình ảnh với AWS S3 integration
- ✅ Repository pattern với dependency injection
- ✅ Validation và error handling toàn diện
- ✅ JWT authentication cho operations bảo mật

## 🔗 Base URL
```
/amenities
```

## 🔐 Authentication
- **Required**: JWT Bearer Token cho các operations tạo/sửa/xóa
- **Optional**: Không cần token cho các operations đọc dữ liệu

---

## 📊 Data Models

### Amenity Entity
```typescript
{
  _id: string;
  name: string;                    // Tên tiện ích
  description?: string;            // Mô tả chi tiết
  sportType: SportType;           // Loại thể thao
  isActive: boolean;              // Trạng thái hoạt động
  imageUrl?: string;              // URL hình ảnh
  type: AmenityType;              // Loại tiện ích
  createdAt: Date;
  updatedAt: Date;
}
```

### Enums
```typescript
// SportType
enum SportType {
  FOOTBALL = 'football',
  TENNIS = 'tennis',
  BADMINTON = 'badminton',
  PICKLEBALL = 'pickleball',
  BASKETBALL = 'basketball',
  VOLLEYBALL = 'volleyball',
  SWIMMING = 'swimming',
  GYM = 'gym'
}

// AmenityType
enum AmenityType {
  COACH = 'coach',        // Huấn luyện viên
  DRINK = 'drink',        // Đồ uống
  FACILITY = 'facility',  // Cơ sở vật chất
  OTHER = 'other'         // Khác
}
```

---

## 🚀 API Endpoints

### 1. 📝 Tạo tiện ích mới
```http
POST /amenities
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

**Request Body:**
```typescript
{
  name: string;                    // Required - Tên tiện ích
  description?: string;            // Optional - Mô tả
  sportType: SportType;           // Required - Loại thể thao
  isActive?: boolean;             // Optional - Trạng thái (default: true)
  imageUrl?: string;              // Optional - URL hình ảnh
  type: AmenityType;              // Required - Loại tiện ích
  image?: File;                   // Optional - File hình ảnh
}
```

**Example Request:**
```bash
curl -X POST "http://localhost:3000/amenities" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "name=Huấn luyện viên bóng đá chuyên nghiệp" \
  -F "description=Huấn luyện viên với 5 năm kinh nghiệm" \
  -F "sportType=football" \
  -F "type=coach" \
  -F "image=@coach_photo.jpg"
```

**Response (201):**
```json
{
  "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Huấn luyện viên bóng đá chuyên nghiệp",
  "description": "Huấn luyện viên với 5 năm kinh nghiệm",
  "sportType": "football",
  "isActive": true,
  "imageUrl": "https://your-s3-bucket.com/images/coach_photo.jpg",
  "type": "coach",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### 2. 📋 Lấy danh sách tiện ích (có phân trang & lọc)
```http
GET /amenities
```

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `page` | number | No | 1 | Số trang |
| `limit` | number | No | 10 | Số lượng mỗi trang |
| `sportType` | SportType | No | - | Lọc theo loại thể thao |
| `type` | AmenityType | No | - | Lọc theo loại tiện ích |
| `search` | string | No | - | Tìm kiếm theo tên |
| `isActive` | boolean | No | - | Trạng thái hoạt động |

**Example Request:**
```bash
curl "http://localhost:3000/amenities?page=1&limit=5&sportType=football&type=coach&isActive=true"
```

**Response (200):**
```json
{
  "data": [
    {
      "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
      "name": "Huấn luyện viên bóng đá chuyên nghiệp",
      "description": "Huấn luyện viên với 5 năm kinh nghiệm",
      "sportType": "football",
      "isActive": true,
      "imageUrl": "https://your-s3-bucket.com/images/coach_photo.jpg",
      "type": "coach",
      "createdAt": "2024-01-15T10:30:00.000Z",
      "updatedAt": "2024-01-15T10:30:00.000Z"
    }
  ],
  "total": 25,
  "page": 1,
  "limit": 5
}
```

---

### 3. 🏃‍♂️ Lấy tiện ích theo loại thể thao
```http
GET /amenities/sport-type/{sportType}
```

**Path Parameters:**
- `sportType`: SportType enum value

**Example Request:**
```bash
curl "http://localhost:3000/amenities/sport-type/football"
```

**Response (200):**
```json
[
  {
    "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Huấn luyện viên bóng đá chuyên nghiệp",
    "sportType": "football",
    "isActive": true,
    "type": "coach"
  }
]
```

---

### 4. 🎯 Lấy tiện ích theo loại tiện ích
```http
GET /amenities/type/{type}
```

**Path Parameters:**
- `type`: AmenityType enum value

**Example Request:**
```bash
curl "http://localhost:3000/amenities/type/coach"
```

**Response (200):**
```json
[
  {
    "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
    "name": "Huấn luyện viên bóng đá chuyên nghiệp",
    "sportType": "football",
    "isActive": true,
    "type": "coach"
  }
]
```

---

### 5. 🔍 Lấy thông tin tiện ích theo ID
```http
GET /amenities/{id}
```

**Path Parameters:**
- `id`: MongoDB ObjectId

**Example Request:**
```bash
curl "http://localhost:3000/amenities/64f1a2b3c4d5e6f7g8h9i0j1"
```

**Response (200):**
```json
{
  "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Huấn luyện viên bóng đá chuyên nghiệp",
  "description": "Huấn luyện viên với 5 năm kinh nghiệm",
  "sportType": "football",
  "isActive": true,
  "imageUrl": "https://your-s3-bucket.com/images/coach_photo.jpg",
  "type": "coach",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

---

### 6. ✏️ Cập nhật tiện ích
```http
PATCH /amenities/{id}
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

**Path Parameters:**
- `id`: MongoDB ObjectId

**Request Body:** (Tất cả fields đều optional)
```typescript
{
  name?: string;
  description?: string;
  sportType?: SportType;
  isActive?: boolean;
  imageUrl?: string;
  type?: AmenityType;
  image?: File;                   // File hình ảnh mới
}
```

**Example Request:**
```bash
curl -X PATCH "http://localhost:3000/amenities/64f1a2b3c4d5e6f7g8h9i0j1" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "description=Huấn luyện viên với 7 năm kinh nghiệm" \
  -F "image=@new_coach_photo.jpg"
```

**Response (200):**
```json
{
  "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Huấn luyện viên bóng đá chuyên nghiệp",
  "description": "Huấn luyện viên với 7 năm kinh nghiệm",
  "sportType": "football",
  "isActive": true,
  "imageUrl": "https://your-s3-bucket.com/images/new_coach_photo.jpg",
  "type": "coach",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

---

### 7. 🔄 Bật/tắt trạng thái tiện ích
```http
PATCH /amenities/{id}/toggle-status
Authorization: Bearer <jwt_token>
```

**Path Parameters:**
- `id`: MongoDB ObjectId

**Example Request:**
```bash
curl -X PATCH "http://localhost:3000/amenities/64f1a2b3c4d5e6f7g8h9i0j1/toggle-status" \
  -H "Authorization: Bearer your_jwt_token"
```

**Response (200):**
```json
{
  "_id": "64f1a2b3c4d5e6f7g8h9i0j1",
  "name": "Huấn luyện viên bóng đá chuyên nghiệp",
  "sportType": "football",
  "isActive": false,  // Đã chuyển từ true sang false
  "type": "coach",
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T12:00:00.000Z"
}
```

---

### 8. 🗑️ Xóa tiện ích
```http
DELETE /amenities/{id}
Authorization: Bearer <jwt_token>
```

**Path Parameters:**
- `id`: MongoDB ObjectId

**Example Request:**
```bash
curl -X DELETE "http://localhost:3000/amenities/64f1a2b3c4d5e6f7g8h9i0j1" \
  -H "Authorization: Bearer your_jwt_token"
```

**Response (204):**
```
No Content
```

---

## ❌ Error Responses

### 400 Bad Request
```json
{
  "statusCode": 400,
  "message": [
    "name should not be empty"
  ],
  "error": "Bad Request"
}
```

### 401 Unauthorized
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

### 404 Not Found
```json
{
  "statusCode": 404,
  "message": "Amenity with ID 64f1a2b3c4d5e6f7g8h9i0j1 not found"
}
```

### 500 Internal Server Error
```json
{
  "statusCode": 500,
  "message": "Internal server error"
}
```

---

## 📝 Usage Examples

### Tạo huấn luyện viên tennis
```bash
curl -X POST "http://localhost:3000/amenities" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "name=Huấn luyện viên tennis chuyên nghiệp" \
  -F "description=Huấn luyện viên tennis với 10 năm kinh nghiệm" \
  -F "sportType=tennis" \
  -F "type=coach" \
  -F "image=@tennis_coach.jpg"
```

### Tìm kiếm đồ uống cho bóng đá
```bash
curl "http://localhost:3000/amenities?sportType=football&type=drink&isActive=true"
```

### Lấy danh sách cơ sở vật chất
```bash
curl "http://localhost:3000/amenities/type/facility?page=1&limit=20"
```

### Cập nhật thông tin tiện ích
```bash
curl -X PATCH "http://localhost:3000/amenities/64f1a2b3c4d5e6f7g8h9i0j1" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "description=Huấn luyện viên với 7 năm kinh nghiệm" \
  -F "image=@new_coach_photo.jpg"
```

---

## 🔧 Technical Notes

### Image Upload
- Hỗ trợ upload hình ảnh qua multipart/form-data
- Tự động upload lên AWS S3
- Tự động xóa hình ảnh cũ khi cập nhật/xóa
- Hỗ trợ các format: JPG, PNG, GIF, WebP

### Repository Pattern
- Sử dụng Repository pattern với dependency injection
- Interface-based design cho dễ test và maintain
- Support pagination và filtering nâng cao

### Error Handling
- Sử dụng NestJS built-in exceptions (NotFoundException, BadRequestException)
- Validation errors với class-validator decorators
- AWS S3 errors được handle gracefully với warnings

---

## 🏗️ Architecture

### Repository Pattern
Module Amenities sử dụng Repository pattern để tách biệt business logic và data access:

```typescript
// Interface-based repository
export interface AmenityRepositoryInterface {
  create(data: Partial<Amenity>): Promise<Amenity>;
  findById(id: string): Promise<Amenity | null>;
  findAll(condition?: FilterQuery<Amenity>): Promise<Amenity[]>;
  update(id: string, data: Partial<Amenity>): Promise<Amenity | null>;
  delete(id: string): Promise<boolean>;
  findWithPagination(condition: FilterQuery<Amenity>, page: number, limit: number): Promise<PaginationResult>;
}

// Dependency injection trong service
@Injectable()
export class AmenitiesService {
  constructor(
    @Inject(AMENITY_REPOSITORY)
    private readonly amenityRepository: AmenityRepositoryInterface,
    private readonly awsS3Service: AwsS3Service,
  ) {}
}
```

### AWS S3 Integration
- **Upload**: Tự động upload hình ảnh lên S3 khi tạo/cập nhật
- **Delete**: Tự động xóa hình ảnh cũ từ S3 khi cập nhật/xóa record
- **Error Handling**: Graceful fallback nếu S3 operations fail

---

## 🧪 Testing

3. **Frontend Integration:**
   - Sử dụng axios/fetch để call API
   - Handle authentication headers
   - Implement error handling
   - Support multipart/form-data cho image upload

4. **Testing:**
   - Unit tests cho service và repository
   - E2E tests cho API endpoints
   - Mock AWS S3 service cho testing

---

*📅 Last Updated: 2025-10-13*
*👨‍💻 Updated by: AI Assistant*
