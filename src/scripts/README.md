# Hướng Dẫn Fix Lỗi Chọn Giờ Đặt Sân

## Vấn đề
UI không cho phép chọn giờ sau khi đã chọn ngày do các field thiếu cấu hình.

## Giải pháp

### Bước 1: Validate (Kiểm tra)
Chạy script để xem có bao nhiêu field bị thiếu cấu hình:

```bash
# Trong MongoDB Compass hoặc mongo shell
mongosh "mongodb+srv://nhatnmde180:helloworld@cluster0.zufvinh.mongodb.net/SportZone"

# Load và chạy script validation
load("e:/Capstone-project/BE/src/scripts/validate_fields.js")
```

Hoặc copy nội dung file `validate_fields.js` và paste vào MongoDB Compass/Shell.

### Bước 2: Fix (Sửa lỗi)
Chạy script để tự động fix tất cả fields thiếu cấu hình:

```bash
# Load và chạy script fix
load("e:/Capstone-project/BE/src/scripts/fix_fields.js")
```

Script này sẽ tự động thêm:
- **Operating Hours**: 6h-22h các ngày thứ 2-6, 6h-23h cuối tuần
- **Price Ranges**: Giá cơ bản 1.0x (6h-17h), 1.5x (17h-22h), 2.0x cuối tuần
- **Slot Configuration**: 60 phút/slot, tối thiểu 1 slot, tối đa 4 slots
- **Base Price**: 100,000 VND/giờ
- **Location**: Địa chỉ mặc định (sẽ cần update sau)

### Bước 3: Verify (Xác nhận)
Chạy script để kiểm tra lại sau khi fix:

```bash
# Load và chạy script verify
load("e:/Capstone-project/BE/src/scripts/verify_fields.js")
```

Script này sẽ:
- Kiểm tra tất cả fields đã có đủ cấu hình chưa
- Kiểm tra riêng field "Test wallet"
- Báo cáo các field vẫn còn thiếu (nếu có)

## Lưu ý quan trọng

### Sau khi chạy scripts:
1. **Restart backend server** để clear cache (nếu có)
2. **Refresh browser** để reload data mới
3. **Test lại** chức năng chọn giờ đặt sân

### Nếu vẫn không hoạt động:
1. Kiểm tra console log của frontend
2. Kiểm tra network tab - xem API `/fields/:fieldId/availability` có trả về data không
3. Kiểm tra court có kết nối đúng với field không

## Các file scripts
- `validate_fields.js` - Kiểm tra fields thiếu cấu hình
- `fix_fields.js` - Tự động fix tất cả fields
- `verify_fields.js` - Xác nhận sau khi fix

## Liên hệ
Nếu vẫn gặp vấn đề, cung cấp kết quả output của `verify_fields.js` để được hỗ trợ.
