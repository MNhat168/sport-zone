# 🔧 Fix Network Error trên AWS Lightsail

## Vấn đề
Khi test demo trên AWS Lightsail, server bị network error và phải reset server.

## Nguyên nhân
1. **MongoDB connection thiếu cấu hình**: Không có connection pool, timeout settings, và error handling
2. **Không có reconnection logic**: Khi MongoDB connection bị drop, server không tự động reconnect
3. **Thiếu timeout settings**: Axios và MongoDB không có timeout phù hợp cho production

## Các thay đổi đã thực hiện

### 1. MongoDB Connection Configuration (`BE/src/app.module.ts`)

Đã thêm các settings quan trọng:

```typescript
MongooseModule.forRoot(process.env.MONGODB_URI!, {
  // Connection pool settings
  maxPoolSize: 10,              // Tối đa 10 connections
  minPoolSize: 2,               // Giữ sẵn 2 connections
  socketTimeoutMS: 45000,        // Timeout 45s cho socket operations
  connectTimeoutMS: 30000,       // Timeout 30s khi kết nối ban đầu
  serverSelectionTimeoutMS: 30000, // Timeout 30s khi chọn server
  
  // Keep connection alive
  heartbeatFrequencyMS: 10000,  // Kiểm tra kết nối mỗi 10s
  maxIdleTimeMS: 30000,          // Đóng connection idle sau 30s
  keepAlive: true,
  keepAliveInitialDelay: 30000,
  
  // Retry settings
  retryWrites: true,
  retryReads: true,
  
  // Event handlers để log và xử lý errors
  connectionFactory: (connection) => {
    // Log connected, error, disconnected, reconnected events
  }
})
```

### 2. Process Error Handlers (`BE/src/main.ts`)

Thêm handlers để catch unhandled errors:

```typescript
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});
```

### 3. Axios Timeout Settings (`shadcn-admin/src/lib/axios.ts`)

Thêm timeout và network error handling:

```typescript
export const axiosInstance = axios.create({
  timeout: 60000, // 60 seconds
  // ... network error handling trong interceptor
});
```

## Kiểm tra trên AWS Lightsail

### 1. Kiểm tra MongoDB Connection String

Đảm bảo `MONGODB_URI` trong `.env.prod` có format đúng:

```bash
# MongoDB Atlas (khuyến nghị)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/dbname?retryWrites=true&w=majority

# Hoặc MongoDB trên Lightsail instance
MONGODB_URI=mongodb://username:password@private-ip:27017/dbname?authSource=admin
```

### 2. Kiểm tra Network Security Groups

Trên Lightsail, đảm bảo:
- Port 3000 (hoặc port bạn dùng) được mở cho HTTP/HTTPS
- Nếu MongoDB chạy trên instance khác, port 27017 được mở trong private network
- Firewall rules cho phép traffic từ frontend

### 3. Kiểm tra Resource Limits

```bash
# Kiểm tra memory usage
free -h

# Kiểm tra CPU
top

# Kiểm tra disk space
df -h
```

Nếu thiếu memory, có thể giảm `maxPoolSize` xuống 5 hoặc 3.

### 4. Kiểm tra Logs

```bash
# Xem logs của ứng dụng
pm2 logs

# Hoặc nếu dùng systemd
journalctl -u your-service-name -f

# Xem MongoDB logs
tail -f /var/log/mongodb/mongod.log
```

Tìm các messages:
- `✅ MongoDB connected successfully`
- `⚠️ MongoDB disconnected`
- `✅ MongoDB reconnected successfully`
- `❌ MongoDB connection error`

### 5. Kiểm tra Process Manager

Đảm bảo server được chạy bằng PM2 hoặc systemd để tự động restart khi crash:

**PM2 (khuyến nghị):**
```bash
pm2 start dist/main.js --name sportzone-api
pm2 save
pm2 startup
```

**Hoặc systemd:**
```bash
# Tạo service file tại /etc/systemd/system/sportzone-api.service
[Unit]
Description=SportZone API
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/path/to/BE
ExecStart=/usr/bin/node dist/main.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## Monitoring và Alerts

### 1. Health Check Endpoint

Có thể thêm health check endpoint để monitor:

```typescript
@Get('health')
async healthCheck() {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  return {
    status: 'ok',
    database: dbStatus,
    uptime: process.uptime(),
  };
}
```

### 2. Set up Alerts

- Monitor MongoDB connection status
- Alert khi có nhiều connection errors
- Monitor memory và CPU usage

## Tối ưu thêm (nếu vẫn còn vấn đề)

### 1. Giảm Connection Pool Size

Nếu server có ít memory:
```typescript
maxPoolSize: 5,
minPoolSize: 1,
```

### 2. Tăng Timeout

Nếu network chậm:
```typescript
socketTimeoutMS: 60000,
connectTimeoutMS: 45000,
```

### 3. Sử dụng MongoDB Connection String Options

Thêm vào connection string:
```
?retryWrites=true&w=majority&maxPoolSize=10&minPoolSize=2&socketTimeoutMS=45000
```

## Testing

Sau khi deploy, test các scenarios:

1. **Normal operation**: API calls hoạt động bình thường
2. **MongoDB restart**: Restart MongoDB và kiểm tra auto-reconnect
3. **Network interruption**: Tạm thời block MongoDB port và kiểm tra recovery
4. **High load**: Test với nhiều concurrent requests

## Kết luận

Các thay đổi này sẽ:
- ✅ Tự động reconnect khi MongoDB connection bị drop
- ✅ Giảm network errors do timeout
- ✅ Cải thiện error handling và logging
- ✅ Tăng stability cho production environment

Nếu vẫn gặp vấn đề, kiểm tra logs và điều chỉnh timeout/pool size theo tài nguyên server.

