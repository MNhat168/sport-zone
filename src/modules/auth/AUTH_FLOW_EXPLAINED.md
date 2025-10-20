# Authentication Flow - Giải thích chi tiết

## 📋 Tổng quan

Hệ thống sử dụng **Cookie-based JWT Authentication** với 2 loại token:
- **Access Token**: Có hiệu lực 15 phút, dùng cho các request thông thường
- **Refresh Token**: Có hiệu lực 7 ngày, dùng để làm mới access token khi hết hạn

## 🔐 Các Endpoint chính

### 1. **POST /auth/login**
Đăng nhập bằng email và password

**Request:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "rememberMe": true
}
```

**Response:**
- Set cookies: `access_token`, `refresh_token`
- Return: thông tin user

**Logic:**
- `rememberMe = true`: Cookies tồn tại 15 phút (access) / 7 ngày (refresh)
- `rememberMe = false`: Session cookies (xóa khi đóng browser)

---

### 2. **POST /auth/google**
Đăng nhập bằng Google OAuth

**Request:**
```json
{
  "token": "google_oauth_token",
  "avatar": "avatar_url",
  "rememberMe": true
}
```

**Response:** Giống như `/auth/login`

---

### 3. **GET /auth/validate**
Kiểm tra session hiện tại có hợp lệ không

**Headers:** 
- Cookie: `access_token=...`

**Response:**
```json
{
  "user": {
    "_id": "...",
    "email": "...",
    "fullName": "...",
    "role": "...",
    "avatarUrl": "...",
    "isActive": true,
    "isVerified": true
  }
}
```

**Khi nào gọi:**
- Khi user refresh trang (F5)
- Khi app khởi động và phát hiện có user trong storage

**Logic:**
- JwtAccessTokenGuard verify `access_token` từ cookie
- Nếu valid: trả về user info
- Nếu expired/invalid: trả về 401 → Frontend tự động gọi `/auth/refresh`

---

### 4. **POST /auth/refresh**
Làm mới access token bằng refresh token

**Headers:**
- Cookie: `refresh_token=...`

**Response:**
- Set cookies mới: `access_token`, `refresh_token`
- Return: success message

**Khi nào gọi:**
- Khi access_token hết hạn (sau 15 phút)
- Axios interceptor tự động gọi khi nhận 401

**Logic:**
- Verify `refresh_token` từ cookie
- Tạo access_token và refresh_token mới
- Giữ nguyên pattern cookie (persistent hoặc session)

---

### 5. **POST /auth/logout**
Đăng xuất, xóa cookies

**Response:**
- Clear cookies: `access_token`, `refresh_token`
- Return: success message

---

## 🔄 Flow hoạt động

### A. Login Flow
```
User → Login Form
  ↓
Frontend: dispatch(signInWithEmailAndPassword)
  ↓
POST /auth/login { email, password, rememberMe }
  ↓
Backend: Verify credentials
  ↓
Backend: Generate access_token + refresh_token
  ↓
Backend: Set cookies (httpOnly, secure, sameSite=strict)
  ↓
Frontend: Save user to localStorage/sessionStorage
  ↓
✅ User logged in
```

### B. Refresh Page Flow
```
User: Press F5
  ↓
Frontend: UserSyncProvider detects user in storage
  ↓
Frontend: dispatch(validateSession())
  ↓
GET /auth/validate (with access_token cookie)
  ↓
Backend: JwtAccessTokenGuard verifies token
  ↓
  ├─ Valid → Return user info → ✅ Stay logged in
  │
  └─ Expired (401) → Axios interceptor catches
       ↓
       POST /auth/refresh (with refresh_token cookie)
       ↓
       Backend: Generate new tokens, set new cookies
       ↓
       Retry GET /auth/validate
       ↓
       ✅ Stay logged in
```

### C. Access Token Expiration Flow
```
User: Makes API request (after 15 minutes)
  ↓
Backend: JwtAccessTokenGuard verifies token
  ↓
Token expired → Return 401
  ↓
Frontend: Axios interceptor catches 401
  ↓
POST /auth/refresh (with refresh_token cookie)
  ↓
Backend: Generate new tokens, set new cookies
  ↓
Retry original request with new token
  ↓
✅ Request succeeds
```

### D. Logout Flow
```
User: Click logout button
  ↓
Frontend: dispatch(logout())
  ↓
POST /auth/logout
  ↓
Backend: Clear cookies (access_token, refresh_token)
  ↓
Frontend: Clear Redux state + localStorage/sessionStorage
  ↓
✅ User logged out
```

---

## 🛠️ Code Structure

### Backend

**`auth.controller.ts`**
- `setAuthCookies()`: Helper method để set cookies (DRY principle)
- Constants: `ACCESS_TOKEN_EXPIRES_IN_MS`, `REFRESH_TOKEN_EXPIRES_IN_MS`
- Endpoints: login, google, validate, refresh, logout

**`auth.service.ts`**
- `generateAccessToken()`: Tạo access token (15 phút)
- `generateRefreshToken()`: Tạo refresh token (7 ngày)
- `getUserById()`: Lấy user từ DB cho validation
- `login()`, `authenticateWithGoogle()`: Logic đăng nhập

**`guards/jwt-access-token.guard.ts`**
- Verify access_token từ cookie
- Throw 401 nếu token invalid/expired

**`guards/jwt-refresh-token.guard.ts`**
- Verify refresh_token từ cookie
- Throw 401 nếu token invalid/expired

**`strategies/jwt.strategy.ts`**
- Extract JWT từ cookie hoặc Authorization header
- Passport strategy cho JWT validation

---

### Frontend

**`authThunk.ts`**
- `signInWithEmailAndPassword`: Login thunk
- `signInWithGoogle`: Google login thunk
- `validateSession`: Validate session thunk
- `refreshToken`: Refresh token thunk
- `logout`: Logout thunk

**`authSlice.ts`**
- Redux slice quản lý auth state
- Xử lý response từ các thunks
- Lưu user vào localStorage/sessionStorage

**`UserSyncProvider.tsx`**
- Component wrap toàn app
- Tự động validate session khi app khởi động
- Đồng bộ auth state với user state

**`axiosPrivate.tsx`**
- Axios instance với `withCredentials: true`
- Interceptor tự động refresh token khi 401
- Redirect về login nếu refresh thất bại

---

## 🔒 Bảo mật

### Cookie Settings
```typescript
{
  httpOnly: true,      // ✅ Không thể truy cập từ JavaScript (chống XSS)
  secure: true,        // ✅ Chỉ gửi qua HTTPS ở production
  sameSite: 'strict',  // ✅ Chống CSRF attack
  path: '/',
}
```

### Token Expiration
- **Access Token**: 15 phút → Giảm thiểu rủi ro nếu bị đánh cắp
- **Refresh Token**: 7 ngày → Balance giữa UX và security

### Session vs Persistent
- **Session Cookie** (`rememberMe = false`): 
  - Xóa khi đóng browser
  - Phù hợp cho shared computers
  
- **Persistent Cookie** (`rememberMe = true`):
  - Tồn tại theo expiration time
  - Phù hợp cho personal devices

---

## 📝 Ghi chú

### Tại sao cần endpoint `/auth/validate`?
- Khi user refresh trang, frontend cần verify token còn hợp lệ không
- Không thể chỉ dựa vào localStorage vì token có thể đã hết hạn
- Endpoint này giúp verify token và trả về thông tin user mới nhất

### Tại sao cần refresh token?
- Access token ngắn hạn (15 phút) → Bảo mật cao
- Nhưng không muốn user phải login lại mỗi 15 phút → UX kém
- Refresh token dài hạn (7 ngày) → Tự động làm mới access token → Balance security & UX

### Tại sao dùng Cookie thay vì localStorage?
- **Cookie httpOnly**: JavaScript không thể truy cập → Chống XSS attack
- **localStorage**: JavaScript có thể truy cập → Dễ bị tấn công XSS
- **Cookie secure + sameSite**: Chống CSRF attack

### Flow khi sửa code ở Frontend (Hot Reload)?
Trước đây: Phải đăng nhập lại ❌

Bây giờ:
1. Hot reload trigger app re-render
2. `UserSyncProvider` detect user trong storage
3. Gọi `validateSession()` để verify token
4. Token vẫn còn hạn → ✅ Giữ nguyên trạng thái đăng nhập

---

## 🐛 Troubleshooting

### Vấn đề: User bị logout khi refresh trang
**Nguyên nhân**: Endpoint `/auth/validate` không tồn tại hoặc không hoạt động

**Giải pháp**: 
- Kiểm tra endpoint có được định nghĩa đúng không
- Kiểm tra JwtAccessTokenGuard hoạt động chính xác
- Check console logs để xem lỗi chi tiết

### Vấn đề: Cookie không được gửi kèm request
**Nguyên nhân**: `withCredentials` không được set

**Giải pháp**:
```typescript
// axiosPrivate.tsx
const axiosInstance = axios.create({
  withCredentials: true, // ✅ Bắt buộc phải có
});
```

### Vấn đề: Refresh token không hoạt động
**Nguyên nhân**: 
- Refresh token hết hạn (sau 7 ngày)
- Cookie bị xóa
- Guard không verify đúng

**Giải pháp**:
- Kiểm tra `JwtRefreshTokenGuard`
- Check cookie expiration trong browser DevTools
- Verify JWT secret khớp giữa các guards

---

## 📚 Tài liệu tham khảo

- [JWT Best Practices](https://tools.ietf.org/html/rfc8725)
- [Cookie Security](https://developer.mozilla.org/en-US/docs/Web/HTTP/Cookies)
- [NestJS Authentication](https://docs.nestjs.com/security/authentication)
- [Passport JWT Strategy](http://www.passportjs.org/packages/passport-jwt/)

