# 🎭 Mock Data Importer

Script import mock data vào database với khả năng tùy chỉnh linh hoạt.

## 📁 Cấu trúc thư mục

```
scripts/mock-data/
├── README.md                    # Hướng dẫn sử dụng
├── import-config.json          # File cấu hình chính
├── import-cli.ts               # Script import chính
├── amenities-library.json      # Mock data cho amenities
├── users-library.json          # Mock data cho users (sẽ tạo)
├── fields-library.json         # Mock data cho fields (sẽ tạo)
└── bookings-library.json       # Mock data cho bookings (sẽ tạo)
```

## 🚀 Cách sử dụng

### **Cách 1: Sử dụng Config File**

1. **Chỉnh sửa config:**
   ```bash
   # Mở file scripts/mock-data/import-config.json
   {
     "enabled": {
       "amenities": true,    # Bật/tắt import amenities
       "users": false,       # Bật/tắt import users
       "fields": false,      # Bật/tắt import fields
       "bookings": false,    # Bật/tắt import bookings
       "reviews": false      # Bật/tắt import reviews
     }
   }
   ```

2. **Chạy import:**
   ```bash
   npm run import:mock
   ```

### **Cách 2: Sử dụng CLI Arguments**

```bash
# Import chỉ amenities
npm run import:mock -- --amenities

# Import tất cả
npm run import:mock -- --all

# Import với options tùy chỉnh
npm run import:mock -- --amenities --clear
npm run import:mock -- --all --no-skip-duplicates
npm run import:mock -- --amenities --users --fields
```

## ⚙️ Tùy chỉnh

### **Bật/Tắt Import**

**Option A: Config File**
```json
{
  "enabled": {
    "amenities": true,    // ✅ Bật import amenities
    "users": false,       // ❌ Tắt import users
    "fields": true        // ✅ Bật import fields
  }
}
```

**Option B: CLI Arguments**
```bash
npm run import:mock -- --amenities --fields
# Chỉ import amenities và fields
```

### **Xử lý Data Trùng lặp**

**Option A: Config File**
```json
{
  "options": {
    "skipDuplicates": true    // Bỏ qua data trùng lặp
  }
}
```

**Option B: CLI Arguments**
```bash
npm run import:mock -- --amenities --no-skip-duplicates
# Import tất cả, kể cả trùng lặp
```

### **Xóa Data Cũ**

**Option A: Config File**
```json
{
  "options": {
    "clearExisting": true    // Xóa data cũ trước khi import
  }
}
```

**Option B: CLI Arguments**
```bash
npm run import:mock -- --amenities --clear
# Xóa amenities cũ trước khi import mới
```

## 📊 Kết quả Import

```
🎯 Starting mock data import...
📋 Configuration:
   Amenities: ✅
   Users: ❌
   Fields: ❌
   Bookings: ❌
   Reviews: ❌

📦 Importing amenities...
✅ Imported: Bãi giữ xe
✅ Imported: Phòng thay đồ
⏭️  Skipping existing amenity: Phòng tắm & Vệ sinh
✅ Imported: Tủ sơ cứu y tế

📊 Amenities Import Summary:
   ✅ Imported: 3
   ⏭️  Skipped: 1
   📦 Total: 4

🎉 Mock data import completed!
```

## 🔧 Troubleshooting

### **Lỗi thường gặp:**

1. **"Cannot find module"**
   ```bash
   # Cài đặt ts-node nếu chưa có
   npm install -g ts-node
   ```

2. **"Database connection failed"**
   ```bash
   # Đảm bảo database đang chạy
   # Kiểm tra connection string trong .env
   ```

3. **"Permission denied"**
   ```bash
   # Chạy với quyền admin (Windows)
   # hoặc sudo (Linux/Mac)
   ```

### **Debug Mode:**

```bash
# Chạy với debug info
DEBUG=* npm run import:mock -- --amenities
```

## 📝 Thêm Mock Data Mới

1. **Tạo file JSON mới:**
   ```bash
   # Ví dụ: scripts/mock-data/users-library.json
   [
     {
       "fullName": "Nguyễn Văn A",
       "email": "user1@example.com",
       "phone": "0123456789"
     }
   ]
   ```

2. **Cập nhật config:**
   ```json
   {
     "enabled": {
       "users": true    // Bật import users
     }
   }
   ```

3. **Thêm logic import trong script**

## 🎯 Best Practices

- ✅ **Luôn backup database** trước khi import
- ✅ **Test trên development** trước khi chạy production
- ✅ **Sử dụng skipDuplicates** để tránh trùng lặp
- ✅ **Kiểm tra log** để đảm bảo import thành công
- ❌ **Không chạy trên production** với clearExisting: true
