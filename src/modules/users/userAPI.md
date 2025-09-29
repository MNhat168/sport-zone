# 📋 User API Documentation - SportZone

## 🎯 **Overview**
API endpoints cho quản lý người dùng trong hệ thống SportZone, bao gồm profile management, authentication, và password operations.

---

## 🔐 **Authentication**
Tất cả endpoints (trừ forgot/reset password) yêu cầu JWT token trong header:
```
Authorization: Bearer <jwt_token>
```

---

## 📡 **API Endpoints**

### 1. **GET** `/users/get-profile`
Lấy thông tin profile của user hiện tại

**Headers:**
```
Authorization: Bearer <jwt_token>
```

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "fullName": "Nguyễn Văn A",
  "email": "user@example.com",
  "phone": "0123456789",
  "role": "user",
  "avatarUrl": "https://s3.amazonaws.com/bucket/avatar.jpg",
  "isVerified": true,
  "googleId": null,
  "favouriteField": ["507f1f77bcf86cd799439012"],
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T10:30:00.000Z"
}
```

**Status Codes:**
- `200` - Success
- `401` - Unauthorized
- `404` - User not found

---

### 2. **PUT** `/users/:id`
Cập nhật thông tin user và upload avatar

**Headers:**
```
Authorization: Bearer <jwt_token>
Content-Type: multipart/form-data
```

**Request Body (Form Data):**
```
fullName: string (optional)
email: string (optional)
phone: string (optional)
avatar: File (optional) - Image file for avatar
```

**Example Request:**
```javascript
const formData = new FormData();
formData.append('fullName', 'Nguyễn Văn B');
formData.append('phone', '0987654321');
formData.append('avatar', fileInput.files[0]); // File object
```

**Response:**
```json
{
  "_id": "507f1f77bcf86cd799439011",
  "fullName": "Nguyễn Văn B",
  "email": "user@example.com",
  "phone": "0987654321",
  "role": "user",
  "avatarUrl": "https://s3.amazonaws.com/bucket/new-avatar.jpg",
  "isVerified": true,
  "googleId": null,
  "favouriteField": ["507f1f77bcf86cd799439012"],
  "isActive": true,
  "createdAt": "2024-01-15T10:30:00.000Z",
  "updatedAt": "2024-01-15T11:45:00.000Z"
}
```

**Status Codes:**
- `200` - Success
- `400` - Bad Request (validation error)
- `401` - Unauthorized
- `404` - User not found

---

### 3. **POST** `/users/forgot-password`
Gửi email reset password

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Response:**
```json
{
  "message": "Đã gửi mail đặt lại mật khẩu"
}
```

**Status Codes:**
- `200` - Success
- `400` - Bad Request (invalid email)
- `404` - Email không tồn tại

---

### 4. **POST** `/users/reset-password`
Reset password với token từ email

**Request Body:**
```json
{
  "token": "uuid-token-from-email",
  "newPassword": "NewPassword123!"
}
```

**Response:**
```json
{
  "message": "Đặt lại mật khẩu thành công"
}
```

**Status Codes:**
- `200` - Success
- `400` - Bad Request (token expired or invalid)

---

## 📊 **Data Models**

### **User Entity**
```typescript
interface User {
  _id: string;                    // MongoDB ObjectId
  fullName: string;               // Tên đầy đủ
  email: string;                  // Email (unique)
  phone?: string;                 // Số điện thoại
  password?: string;              // Password (hashed)
  role: UserRole;                 // Vai trò user
  avatarUrl?: string;             // URL avatar
  isVerified: boolean;            // Đã xác thực email
  verificationToken?: string;     // Token xác thực
  resetPasswordToken?: string;    // Token reset password
  resetPasswordExpires?: Date;    // Thời gian hết hạn token
  googleId?: string;              // Google OAuth ID
  favouriteField?: string[];      // Danh sách field yêu thích
  isActive: boolean;              // Trạng thái hoạt động
  createdAt: Date;                // Ngày tạo
  updatedAt: Date;                // Ngày cập nhật
}
```

### **UserRole Enum**
```typescript
enum UserRole {
  USER = 'user',              // Người dùng thường
  COACH = 'coach',            // Huấn luyện viên
  FIELD_OWNER = 'field_owner', // Chủ sân
  ADMIN = 'admin'             // Quản trị viên
}
```

### **UpdateUserDto**
```typescript
interface UpdateUserDto {
  fullName?: string;    // Tên đầy đủ (optional)
  email?: string;       // Email (optional)
  phone?: string;       // Số điện thoại (optional)
  avatarUrl?: string;   // URL avatar (optional)
}
```

### **ForgotPasswordDto**
```typescript
interface ForgotPasswordDto {
  email: string;        // Email để gửi reset link
}
```

### **ResetPasswordDto**
```typescript
interface ResetPasswordDto {
  token: string;        // Token từ email
  newPassword: string;  // Mật khẩu mới
}
```

### **ChangePasswordDto**
```typescript
interface ChangePasswordDto {
  old_password: string;     // Mật khẩu cũ
  new_password: string;     // Mật khẩu mới (strong password)
  confirm_password: string; // Xác nhận mật khẩu mới
}
```

---

## 🎨 **Frontend Data Requirements**

### **1. User Profile Page**
```typescript
// Data cần thiết cho profile page
interface UserProfileData {
  user: User;                    // Thông tin user hiện tại
  isLoading: boolean;            // Trạng thái loading
  isUpdating: boolean;           // Trạng thái đang update
  error: string | null;          // Lỗi nếu có
}

// Form data cho update profile
interface UpdateProfileForm {
  fullName: string;
  email: string;
  phone: string;
  avatar: File | null;
}
```

### **2. Forgot Password Page**
```typescript
interface ForgotPasswordForm {
  email: string;
}

interface ForgotPasswordState {
  isLoading: boolean;
  isEmailSent: boolean;
  error: string | null;
}
```

### **3. Reset Password Page**
```typescript
interface ResetPasswordForm {
  token: string;           // Từ URL params
  newPassword: string;
  confirmPassword: string;
}

interface ResetPasswordState {
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
}
```

### **4. Change Password Page**
```typescript
interface ChangePasswordForm {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

interface ChangePasswordState {
  isLoading: boolean;
  isSuccess: boolean;
  error: string | null;
}
```

---

## 🔧 **Frontend Implementation Examples**

### **1. Get User Profile**
```typescript
// React Hook
const useUserProfile = () => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/users/get-profile', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) throw new Error('Failed to fetch profile');
      
      const userData = await response.json();
      setUser(userData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfile();
  }, []);

  return { user, loading, error, refetch: fetchProfile };
};
```

### **2. Update User Profile**
```typescript
// React Hook
const useUpdateProfile = () => {
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateProfile = async (userId: string, formData: FormData) => {
    try {
      setIsUpdating(true);
      setError(null);
      
      const response = await fetch(`/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Update failed');
      }
      
      const updatedUser = await response.json();
      return updatedUser;
    } catch (err) {
      setError(err.message);
      throw err;
    } finally {
      setIsUpdating(false);
    }
  };

  return { updateProfile, isUpdating, error };
};
```

### **3. Forgot Password**
```typescript
// React Hook
const useForgotPassword = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [isEmailSent, setIsEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendResetEmail = async (email: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      const response = await fetch('/api/users/forgot-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to send reset email');
      }
      
      setIsEmailSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return { sendResetEmail, isLoading, isEmailSent, error };
};
```

---

## ⚠️ **Error Handling**

### **Common Error Responses**
```typescript
interface ErrorResponse {
  statusCode: number;
  message: string | string[];
  error: string;
}

// Examples:
// 400 - Validation Error
{
  "statusCode": 400,
  "message": ["email must be a valid email"],
  "error": "Bad Request"
}

// 401 - Unauthorized
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}

// 404 - Not Found
{
  "statusCode": 404,
  "message": "User not found",
  "error": "Not Found"
}
```

---

## 🔒 **Security Notes**

1. **JWT Token**: Tất cả protected endpoints cần JWT token hợp lệ
2. **File Upload**: Avatar upload giới hạn kích thước và định dạng
3. **Password Reset**: Token có thời hạn 1 giờ
4. **Email Validation**: Email phải đúng định dạng
5. **Strong Password**: Mật khẩu mới phải đủ mạnh (6+ ký tự, có chữ hoa, thường, số, ký tự đặc biệt)

---

## 📝 **Notes**

- Tất cả timestamps đều theo UTC
- Avatar upload sử dụng AWS S3
- Email service sử dụng dynamic URL (local/production)
- Repository pattern được sử dụng cho data access
- Global exception handling cho error responses
