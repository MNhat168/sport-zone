# TIMEZONE HANDLING REPORT - Backend (BE)

**Ngày tạo:** 2025-12-03 13:08:41  
**Dự án:** SportZone Backend  
**Múi giờ mục tiêu:** Vietnam (UTC+7)

---

## 📋 TỔNG QUAN

Backend SportZone sử dụng hệ thống xử lý timezone để đảm bảo tất cả timestamps được lưu trữ và hiển thị nhất quán theo múi giờ Việt Nam (UTC+7).

---

## 🏗️ KIẾN TRÚC TIMEZONE HANDLING

### 1. **Base Entity** (`src/common/entities/base.entity.ts`)

**Chức năng:** Base class cho tất cả entities, tự động xử lý timestamps với UTC+7 offset.

**Đặc điểm:**
- ✅ Tự động thêm `createdAt` và `updatedAt` cho mọi entity
- ⚠️ **Lưu timestamps với offset +7 giờ** trước khi persist vào MongoDB
- MongoDB vẫn lưu dưới dạng UTC, nhưng giá trị đã được shift +7h

```17:18:sport-zone/src/common/entities/base.entity.ts
    // ⚠️ Save timestamps as Vietnam time (UTC+7) by shifting +7h before persist
    currentTime: () => new Date(Date.now() + 7 * 60 * 60 * 1000)
```

**Lưu ý quan trọng:**
- MongoDB luôn lưu dates dưới dạng UTC
- Offset +7 được áp dụng TRƯỚC khi lưu vào DB
- Khi đọc từ DB, giá trị đã là UTC+7 (được biểu diễn như UTC trong MongoDB)

---

### 2. **Timezone Utilities** (`src/utils/timezone.utils.ts`)

**Các hàm chính:**

#### `convertToVietnamTime(utcDate: Date): Date`
- Chuyển đổi UTC time sang Vietnam timezone
- **Hiện tại:** Trả về bản sao của date (vì dữ liệu đã được lưu theo UTC+7)

#### `getCurrentVietnamTime(): Date`
- Lấy thời gian hiện tại theo múi giờ Việt Nam
- Cộng offset +7 giờ vào UTC time

```18:20:sport-zone/src/utils/timezone.utils.ts
export function getCurrentVietnamTime(): Date {
    return new Date(Date.now() + (7 * 60 * 60 * 1000));
}
```

#### `formatVietnamTime(date: Date, format: 'iso' | 'readable'): string`
- Format date theo múi giờ Việt Nam
- `'iso'`: Trả về ISO string với offset +07:00
- `'readable'`: Trả về định dạng dễ đọc (vi-VN locale)

#### `createVietnamDate(year, month, day, hour, minute, second): Date`
- Tạo Date object từ các thành phần thời gian Việt Nam

---

### 3. **TimezoneService** (`src/common/services/timezone.service.ts`)

**Chức năng:** Service wrapper cho timezone utilities, cung cấp interface nhất quán.

**Methods:**
- `toVietnamTime(utcDate: Date): Date`
- `getCurrentVietnamTime(): Date`
- `formatVietnamTime(date: Date, format): string`
- `addTimezoneToResponse<T>(entity: T, timestampFields: string[]): T`
- `addTimezoneToResponseArray<T>(entities: T[], timestampFields: string[]): T[]`

**Sử dụng:** Injectable service, có thể inject vào bất kỳ module nào.

---

### 4. **GlobalTimezoneInterceptor** (`src/common/interceptors/global-timezone.interceptor.ts`)

**Chức năng:** Tự động convert tất cả timestamps trong response sang Vietnam timezone.

**Đặc điểm:**
- ✅ Recursively transform tất cả Date objects và timestamp fields
- ✅ Xử lý nested objects và arrays
- ✅ Bảo vệ khỏi circular references
- ✅ Có thể skip bằng decorator `@SkipTimezoneConversion()`

**Cách hoạt động:**
```38:92:sport-zone/src/common/interceptors/global-timezone.interceptor.ts
  private transformTimestamps(data: any, visited = new WeakSet()): any {
    if (!data) return data;

    // Handle primitive types
    if (typeof data !== 'object') return data;

    // Check for circular references
    if (visited.has(data)) {
      return data; // Return original to avoid infinite loop
    }

    // Handle Date objects
    if (data instanceof Date) {
      return this.timezoneService.toVietnamTime(data);
    }

    // Handle arrays
    if (Array.isArray(data)) {
      visited.add(data);
      const result = data.map(item => this.transformTimestamps(item, visited));
      visited.delete(data);
      return result;
    }

    // Handle objects (including Mongoose documents)
    if (typeof data === 'object' && data !== null) {
      visited.add(data);

      // Convert Mongoose document to plain object if needed
      const plainData = data.toObject ? data.toObject() : data;
      
      // Transform object properties
      const transformed = {};
      for (const [key, value] of Object.entries(plainData)) {
        // Handle _id serialization
        if (key === '_id' && value && typeof value === 'object' && value.toString) {
          transformed[key] = value.toString();
        }
        // Transform timestamp fields
        else if ((key === 'createdAt' || key === 'updatedAt') && value instanceof Date) {
          transformed[key] = this.timezoneService.toVietnamTime(value);
        } else if (value && typeof value === 'object') {
          // Recursively transform nested objects
          transformed[key] = this.transformTimestamps(value, visited);
        } else {
          transformed[key] = value;
        }
      }
      
      visited.delete(data);
      return transformed;
    }

    return data;
  }
```

**⚠️ VẤN ĐỀ:** Interceptor này được export từ `CommonModule` nhưng **KHÔNG được đăng ký globally** trong `main.ts`. Cần đăng ký để tự động áp dụng cho tất cả responses.

---

### 5. **SkipTimezoneConversion Decorator** (`src/common/decorators/skip-timezone.decorator.ts`)

**Chức năng:** Cho phép skip timezone conversion cho endpoint cụ thể.

**Sử dụng:**
```typescript
@SkipTimezoneConversion()
@Get('some-endpoint')
async getData() {
  // Response sẽ không được convert timezone
}
```

---

## 📍 CÁC VỊ TRÍ SỬ DỤNG TIMEZONE

### 1. **Payment Cleanup Service** (`src/modules/transactions/payment-cleanup.service.ts`)

**Mục đích:** Xử lý expired payments với timezone-aware logic.

**Cách sử dụng:**
- Sử dụng `TimezoneService.getCurrentVietnamTime()` để lấy thời gian hiện tại
- So sánh timestamps với offset +7 giờ
- Format logs với `formatVietnamTime(date, 'readable')`

**Ví dụ:**
```48:54:sport-zone/src/modules/transactions/payment-cleanup.service.ts
      // Use Vietnam local time as source of truth because timestamps are stored in UTC+7
      const nowVN = this.timezoneService.getCurrentVietnamTime();
      const expirationThresholdVN = new Date(nowVN.getTime() - (5 * 60 * 1000)); // 5 minutes ago

      this.logger.debug(`[Cleanup] Current time (Vietnam UTC+7): ${this.timezoneService.formatVietnamTime(nowVN, 'readable')}`);
      this.logger.debug(`[Cleanup] Expiration threshold (Vietnam UTC+7): ${this.timezoneService.formatVietnamTime(expirationThresholdVN, 'readable')}`);
```

---

### 2. **Bookings Service** (`src/modules/bookings/bookings.service.ts`)

**Mục đích:** Xử lý date queries và availability checks.

**Cách sử dụng:**
- Normalize dates về start/end of day trong Vietnam timezone
- Sử dụng `toISOString().split('T')[0]` để lấy date string (YYYY-MM-DD)

**Ví dụ:**
```1229:1234:sport-zone/src/modules/bookings/bookings.service.ts
      // Normalize date to start/end of day in Vietnam timezone (UTC+7)
const startOfDay = new Date(date);
startOfDay.setHours(0, 0, 0, 0); // Start of local day (Vietnam)

const endOfDay = new Date(date);
endOfDay.setHours(23, 59, 59, 999); // End of local day (Vietnam)
```

---

### 3. **Fields Service** (`src/modules/fields/fields.service.ts`)

**Mục đích:** Lấy ngày hôm nay theo timezone Việt Nam cho các operations.

**Cách sử dụng:**
```291:294:sport-zone/src/modules/fields/fields.service.ts
            // Lấy ngày hôm nay theo timezone Việt Nam (UTC+7)
            const vietnamTime = new Date(Date.now() + 7 * 60 * 60 * 1000);
            const vietnamDate = new Date(vietnamTime.toLocaleString("en-US", {timeZone: "Asia/Ho_Chi_Minh"}));
            const todayString = vietnamDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD
```

---

### 4. **Field Owner Service** (`src/modules/field-owner/field-owner.service.ts`)

**Mục đích:** Tương tự Fields Service, lấy ngày hôm nay theo Vietnam timezone.

---

## ⚠️ VẤN ĐỀ VÀ HẠN CHẾ

### 1. **GlobalTimezoneInterceptor chưa được đăng ký globally**

**Vấn đề:** Interceptor được export từ `CommonModule` nhưng không được đăng ký trong `main.ts`.

**Giải pháp:** Thêm vào `main.ts`:
```typescript
import { GlobalTimezoneInterceptor } from './common/interceptors/global-timezone.interceptor';

// Trong bootstrap function:
app.useGlobalInterceptors(
  new ResponseInterceptor(),
  app.get(GlobalTimezoneInterceptor) // Cần inject từ DI container
);
```

Hoặc sử dụng `APP_INTERCEPTOR` provider trong `app.module.ts`:
```typescript
{
  provide: APP_INTERCEPTOR,
  useClass: GlobalTimezoneInterceptor,
}
```

---

### 2. **Inconsistency trong cách lưu timestamps**

**Vấn đề:** 
- BaseEntity lưu timestamps với offset +7h TRƯỚC khi persist
- Nhưng MongoDB vẫn lưu dưới dạng UTC
- Điều này có thể gây confusion khi query hoặc so sánh dates

**Khuyến nghị:**
- Nên lưu timestamps thuần UTC trong MongoDB
- Chỉ convert sang UTC+7 khi hiển thị/response
- Hoặc document rõ ràng về cách timestamps được lưu

---

### 3. **Date normalization không nhất quán**

**Vấn đề:** Một số nơi sử dụng `setHours(0,0,0,0)` trực tiếp, một số nơi sử dụng timezone utils.

**Khuyến nghị:** Tạo helper function `normalizeToVietnamDay(date: Date)` để nhất quán.

---

### 4. **Thiếu timezone trong date comparisons**

**Vấn đề:** Một số nơi so sánh dates mà không normalize về cùng timezone.

**Khuyến nghị:** Luôn normalize dates về Vietnam timezone trước khi so sánh.

---

## ✅ BEST PRACTICES ĐANG ĐƯỢC ÁP DỤNG

1. ✅ Sử dụng `TimezoneService` thay vì hardcode offset
2. ✅ Format logs với timezone-aware formatting
3. ✅ Normalize dates về start/end of day khi query
4. ✅ Sử dụng `Asia/Ho_Chi_Minh` timezone identifier
5. ✅ Có decorator để skip timezone conversion khi cần

---

## 🔧 KHUYẾN NGHỊ CẢI THIỆN

### 1. **Đăng ký GlobalTimezoneInterceptor globally**
```typescript
// app.module.ts
import { APP_INTERCEPTOR } from '@nestjs/core';
import { GlobalTimezoneInterceptor } from './common/interceptors/global-timezone.interceptor';

@Module({
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: GlobalTimezoneInterceptor,
    },
  ],
})
```

### 2. **Tạo helper functions cho date operations**
```typescript
// timezone.utils.ts
export function normalizeToVietnamDay(date: Date): { start: Date; end: Date } {
  const vnDate = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const start = new Date(vnDate);
  start.setHours(0, 0, 0, 0);
  const end = new Date(vnDate);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
```

### 3. **Document rõ ràng về timezone strategy**
- Tạo document giải thích cách timestamps được lưu
- Quy định khi nào cần convert timezone
- Best practices cho developers

### 4. **Unit tests cho timezone functions**
- Test các edge cases (DST, midnight, etc.)
- Test với các server timezone khác nhau
- Test date comparisons

---

## 📊 TÓM TẮT

### ✅ Điểm mạnh:
- Có hệ thống timezone utilities hoàn chỉnh
- Sử dụng service pattern để centralize logic
- Có interceptor để tự động convert responses
- Có decorator để skip conversion khi cần

### ⚠️ Điểm cần cải thiện:
- GlobalTimezoneInterceptor chưa được đăng ký globally
- Inconsistency trong cách lưu timestamps
- Thiếu helper functions cho common date operations
- Cần document rõ ràng hơn về timezone strategy

### 🎯 Priority Actions:
1. **HIGH:** Đăng ký GlobalTimezoneInterceptor globally
2. **MEDIUM:** Tạo helper functions cho date normalization
3. **MEDIUM:** Document timezone strategy
4. **LOW:** Refactor để nhất quán hơn trong cách lưu timestamps

---

**Người tạo:** AI Assistant  
**Ngày:** 2025-12-03 13:08:41

