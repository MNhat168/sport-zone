# 🔗 Localtunnel Setup Guide

Script này tự động tạo tunnel để expose local server ra internet, dùng cho PayOS webhook testing.

## 📦 Installation

Cài đặt dependencies (đã được thêm vào `package.json`):

```bash
npm install
```

## 🚀 Usage

### Cách 1: Chạy cùng lúc Server + Tunnel (Recommended)

```bash
npm run start:dev:tunnel
```

Lệnh này sẽ:
- ✅ Chạy NestJS server ở port 3000 (hoặc PORT trong .env)
- ✅ Tự động tạo localtunnel với subdomain `payoslong`
- ✅ Hiển thị public URL và webhook URL

### Cách 2: Chạy riêng biệt

```bash
# Terminal 1: Chạy server
npm run start:dev

# Terminal 2: Chạy tunnel
npm run tunnel
```

## ⚙️ Configuration

### URL Mặc Định (Fixed)

Script được cấu hình để **luôn sử dụng URL cố định**:
- **URL:** `https://payoslong.loca.lt`
- **Webhook URL:** `https://payoslong.loca.lt/transactions/payos/webhook`

URL này sẽ **không thay đổi** mỗi lần chạy, giúp bạn không cần cập nhật lại trong PayOS Dashboard.

### Environment Variables

Thêm vào file `.env` (nếu cần):

```env
# Port của NestJS server (default: 3000)
PORT=3000
```

**Lưu ý:** Subdomain `payoslong` đã được **hardcode** trong script để đảm bảo URL không thay đổi.

### Thay đổi Subdomain (Nếu cần)

Nếu subdomain `payoslong` đã được sử dụng và bạn muốn đổi, sửa trực tiếp trong `scripts/start-localtunnel.js`:

```javascript
// Dòng 12 trong scripts/start-localtunnel.js
const SUBDOMAIN = 'payoslong2'; // Thay đổi ở đây
const EXPECTED_URL = `https://${SUBDOMAIN}.loca.lt`; // URL mới
```

## 📍 Webhook URL

**URL cố định (không thay đổi):**
- **Public URL:** `https://payoslong.loca.lt`
- **Webhook URL:** `https://payoslong.loca.lt/transactions/payos/webhook`

Sau khi chạy, bạn sẽ thấy:

```
✅ Localtunnel is running!
   Public URL: https://payoslong.loca.lt
   Webhook URL: https://payoslong.loca.lt/transactions/payos/webhook
   
   📋 Copy webhook URL này vào PayOS Dashboard:
   https://payoslong.loca.lt/transactions/payos/webhook
```

**Cấu hình trong PayOS Dashboard (chỉ cần làm 1 lần):**
- Đăng nhập PayOS Dashboard
- Vào phần Webhook Settings
- Thêm URL: `https://payoslong.loca.lt/transactions/payos/webhook`
- **Lưu ý:** URL này sẽ không thay đổi, bạn chỉ cần cấu hình 1 lần duy nhất!

## ⚠️ Lưu ý

1. **URL cố định:** Script đã được cấu hình để **luôn sử dụng URL `https://payoslong.loca.lt`**, không thay đổi mỗi lần chạy.

2. **Subdomain có thể bị chiếm:** 
   - Nếu subdomain `payoslong` đã được sử dụng (bởi bạn hoặc người khác), script sẽ báo lỗi
   - Giải pháp: Đóng tất cả terminal đang chạy tunnel, đợi vài phút rồi thử lại
   - Hoặc đổi subdomain khác trong script (xem phần Configuration)

3. **Tunnel sẽ tự động đóng khi:**
   - Bạn nhấn `Ctrl+C`
   - Server bị tắt
   - Mất kết nối internet

4. **Chỉ dùng cho development:** Localtunnel không phù hợp cho production.

## 🛑 Stop

Để dừng, nhấn `Ctrl+C` trong terminal. Cả server và tunnel sẽ tự động dừng.

## 🔧 Troubleshooting

### Lỗi: "Subdomain already in use"
- Giải pháp: Đổi subdomain khác trong `.env` hoặc script

### Lỗi: "Connection refused"
- Kiểm tra server đã chạy chưa (port 3000)
- Kiểm tra PORT trong `.env` có đúng không

### Tunnel không hoạt động
- Kiểm tra kết nối internet
- Thử chạy lại: `npm run tunnel`
- Kiểm tra firewall có chặn không

