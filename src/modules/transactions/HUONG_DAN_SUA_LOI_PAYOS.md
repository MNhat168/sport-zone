# 🔧 HƯỚNG DẪN SỬA LỖI PAYOS SIGNATURE

## 🔍 Nguyên nhân lỗi

Từ log của bạn:
```
Expected: 901cfa70...1752
Received: dummy...ummy  ❌ Sai!
```

**Vấn đề**: Bạn đang test với signature giả (`dummy`) thay vì nhận signature thực từ PayOS.

## 📋 Cách PayOS gửi signature

PayOS gửi signature theo **2 cách khác nhau**:

### 1️⃣ Return URL (GET request)
Khi user thanh toán xong, PayOS redirect về:
```
http://localhost:5173/transactions/payos/return?
  orderCode=123&
  amount=1000&
  description=test&
  accountNumber=1&
  reference=abc&
  transactionDateTime=2025-11-05%2010:00:00&
  signature=901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752
```

👉 **Signature ở query params**

### 2️⃣ Webhook (POST request)
PayOS gửi POST request đến webhook URL:
```json
{
  "data": {
    "orderCode": 123,
    "amount": 1000,
    "description": "test",
    "accountNumber": "1",
    "reference": "abc",
    "transactionDateTime": "2025-11-05 10:00:00"
  },
  "signature": "901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752"
}
```

👉 **Signature ở root level**, KHÔNG trong `data`

---

## ✅ GIẢI PHÁP

### Bước 1: Sửa `transactions.controller.ts`

Tìm method `handlePayOSWebhook` (dòng 1540) và sửa lại:

```typescript
@Post('payos/webhook')
@HttpCode(200)
async handlePayOSWebhook(@Body() body: any) {
    try {
        this.logger.log('[PayOS Webhook] Received webhook');
        this.logger.debug('[PayOS Webhook] Full body:', JSON.stringify(body, null, 2));

        // ⚠️ QUAN TRỌNG: Lấy signature từ ROOT LEVEL
        const receivedSignature = body.signature; // ✅ Đúng
        // KHÔNG PHẢI: body.data.signature ❌ Sai
        
        const webhookData = body.data;
        
        if (!receivedSignature || !webhookData) {
            this.logger.warn('[PayOS Webhook] ❌ Missing signature or data');
            return { code: '97', desc: 'Invalid webhook' };
        }

        this.logger.debug('[PayOS Webhook] Signature:', receivedSignature.substring(0, 8) + '...');

        // Chuẩn bị data để verify (KHÔNG bao gồm signature trong data)
        const payload: PayOSCallbackDto = {
            orderCode: webhookData.orderCode,
            amount: webhookData.amount,
            description: webhookData.description,
            accountNumber: webhookData.accountNumber,
            reference: webhookData.reference,
            transactionDateTime: webhookData.transactionDateTime,
            signature: receivedSignature, // Chỉ để truyền vào service
        };

        // Verify signature
        const verificationResult = this.payosService.verifyCallback(payload);

        if (!verificationResult.isValid) {
            this.logger.warn(`[PayOS Webhook] ❌ Invalid signature`);
            return { code: '97', desc: 'Invalid signature' };
        }

        this.logger.log(`[PayOS Webhook] ✅ Signature verified`);

        // ... xử lý transaction như cũ ...
        
    } catch (error) {
        this.logger.error(`[PayOS Webhook] ❌ Error: ${error.message}`);
        return { code: '99', desc: 'System error' };
    }
}
```

### Bước 2: Kiểm tra `payos.utils.ts`

File utils phải verify đúng cách:

```typescript
export function verifyPayOSSignature(
  data: Record<string, any>,
  receivedSignature: string,
  checksumKey: string
): boolean {
  // 1. Remove signature từ data
  const { signature, ...dataToSign } = data;
  
  // 2. Sort keys theo alphabet (QUAN TRỌNG!)
  const sortedKeys = Object.keys(dataToSign).sort();
  
  // 3. Build query string: key1=value1&key2=value2
  const dataString = sortedKeys
    .map(key => `${key}=${dataToSign[key]}`)
    .join('&');
  
  console.log('[PayOS] Data string:', dataString);
  
  // 4. Generate HMAC SHA256
  const expectedSignature = crypto
    .createHmac('sha256', checksumKey)
    .update(dataString)
    .digest('hex');
  
  console.log('[PayOS] Expected:', expectedSignature.substring(0, 8) + '...');
  console.log('[PayOS] Received:', receivedSignature.substring(0, 8) + '...');
  
  // 5. So sánh
  return expectedSignature === receivedSignature;
}
```

### Bước 3: Kiểm tra `.env`

```bash
# Checksum key phải đúng và KHÔNG có khoảng trắng
PAYOS_CHECKSUM_KEY=31ac6ca7aa720681b97596c9cdbb1fc0c0d6c2dcdc1d5c5accd78a14915408b9
```

---

## 🧪 TEST WEBHOOK

### Option 1: Dùng script Node.js

Tôi đã tạo file `generate-payos-signature.js` để test:

```bash
node generate-payos-signature.js
```

Kết quả:
```
Signature: 901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752

Webhook Body:
{
  "data": {
    "accountNumber": "1",
    "amount": 1000,
    "description": "test",
    "orderCode": 123,
    "reference": "abc",
    "transactionDateTime": "2025-11-05 10:00:00"
  },
  "signature": "901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752"
}
```

### Option 2: Test bằng CURL

```bash
curl -X POST http://localhost:3000/transactions/payos/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "accountNumber": "1",
      "amount": 1000,
      "description": "test",
      "orderCode": 123,
      "reference": "abc",
      "transactionDateTime": "2025-11-05 10:00:00"
    },
    "signature": "901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752"
  }'
```

### Option 3: Test bằng Postman

**URL**: `POST http://localhost:3000/transactions/payos/webhook`

**Headers**:
```
Content-Type: application/json
```

**Body** (raw JSON):
```json
{
  "data": {
    "accountNumber": "1",
    "amount": 1000,
    "description": "test",
    "orderCode": 123,
    "reference": "abc",
    "transactionDateTime": "2025-11-05 10:00:00"
  },
  "signature": "901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752"
}
```

---

## 📊 Cách tính signature đúng

```javascript
const crypto = require('crypto');

// 1. Data KHÔNG bao gồm signature
const data = {
  accountNumber: "1",
  amount: 1000,
  description: "test",
  orderCode: 123,
  reference: "abc",
  transactionDateTime: "2025-11-05 10:00:00"
};

// 2. Sort keys theo alphabet
const sortedKeys = Object.keys(data).sort();
// Result: ["accountNumber", "amount", "description", "orderCode", "reference", "transactionDateTime"]

// 3. Build query string
const dataString = sortedKeys
  .map(key => `${key}=${data[key]}`)
  .join('&');
// Result: "accountNumber=1&amount=1000&description=test&orderCode=123&reference=abc&transactionDateTime=2025-11-05 10:00:00"

// 4. Generate HMAC SHA256
const checksumKey = '31ac6ca7aa720681b97596c9cdbb1fc0c0d6c2dcdc1d5c5accd78a14915408b9';
const signature = crypto
  .createHmac('sha256', checksumKey)
  .update(dataString)
  .digest('hex');

console.log('Signature:', signature);
// Result: 901cfa7037c7d9b950697033ff9e030a86d679bd57993619213bef1caccf1752
```

---

## 🎯 Test với PayOS thật

Để test với PayOS thực tế:

1. **Tạo payment link** qua API hoặc dashboard
2. **Thanh toán** trên sandbox PayOS
3. PayOS sẽ gửi webhook với **signature thật** về server của bạn
4. Server verify signature và xử lý

### Cấu hình webhook trong PayOS Dashboard

1. Vào https://payos.vn/dashboard
2. Vào **Settings** → **Webhook**
3. Thêm webhook URL: `https://your-domain.com/transactions/payos/webhook`
4. Dùng **localtunnel** để expose local:
   ```bash
   npx localtunnel --port 3000 --subdomain payoslong
   # Webhook URL: https://payoslong.loca.lt/transactions/payos/webhook
   ```

---

## ✅ Checklist

- [ ] Sửa `handlePayOSWebhook` để lấy signature từ `body.signature`
- [ ] Kiểm tra `verifyPayOSSignature` trong utils
- [ ] Đảm bảo `PAYOS_CHECKSUM_KEY` trong `.env` không có khoảng trắng
- [ ] Test với script `generate-payos-signature.js`
- [ ] Test webhook với Postman/CURL
- [ ] Test với PayOS sandbox thật

---

## 🐛 Debug tips

Nếu vẫn lỗi, thêm log chi tiết:

```typescript
console.log('=== PayOS Debug ===');
console.log('Full body:', JSON.stringify(body, null, 2));
console.log('Signature location:', body.signature ? 'root' : body.data?.signature ? 'data' : 'missing');
console.log('Received signature:', body.signature?.substring(0, 20) + '...');
console.log('Data to sign:', JSON.stringify(body.data));
console.log('Keys:', Object.keys(body.data).sort().join(', '));
console.log('===================');
```

---

## 📚 Tài liệu tham khảo

- PayOS Webhook Documentation: https://payos.vn/docs/webhook
- PayOS Signature Guide: https://payos.vn/docs/signature

---

Nếu còn lỗi, share thêm log mới sau khi sửa, tôi sẽ giúp debug tiếp! 🚀
