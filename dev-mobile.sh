#!/bin/bash

echo "🚀 Starting SportZone (BE + FE) for mobile testing with localtunnel..."

# Detect local IP (IPv4, non-loopback)
LOCAL_IP=$(
  ip addr show \
    | grep "inet " \
    | grep -v 127.0.0.1 \
    | awk '{print $2}' \
    | cut -d/ -f1 \
    | head -n1
)

if [ -z "$LOCAL_IP" ]; then
  echo "❌ Không lấy được LOCAL_IP. Vui lòng kiểm tra kết nối mạng (wifi/LAN)."
  exit 1
fi

echo "📱 Frontend (Local): http://$LOCAL_IP:5173"
echo "🔧 Backend (Local):  http://$LOCAL_IP:3000"
echo ""

BACKEND_DIR="/home/longvqh/Documents/Capstone/sport-zone"
FRONTEND_DIR="/home/longvqh/Documents/Capstone/sport-zone-fe"

if [ ! -d "$BACKEND_DIR" ] || [ ! -d "$FRONTEND_DIR" ]; then
  echo "❌ Không tìm thấy thư mục backend hoặc frontend. Kiểm tra lại đường dẫn trong script."
  exit 1
fi

# Start backend on 0.0.0.0
cd "$BACKEND_DIR" || exit 1
echo "Starting Backend (NestJS)..."
npm run start:dev -- --host 0.0.0.0 &
BACKEND_PID=$!

# Wait for backend to be ready
echo "⏳ Waiting for backend to start..."
sleep 8

# Start localtunnel for backend (can be used for Didit / PayOS webhooks)
echo "🌐 Creating localtunnel for backend (port 3000)..."
LT_LOG_FILE="/tmp/sportzone-lt-url.txt"

# Try lt (localtunnel CLI), fallback to npx localtunnel
if command -v lt >/dev/null 2>&1; then
  lt --port 3000 --subdomain sportzone-dev > "$LT_LOG_FILE" 2>&1 &
elif command -v npx >/dev/null 2>&1; then
  npx localtunnel --port 3000 --subdomain sportzone-dev > "$LT_LOG_FILE" 2>&1 &
else
  echo "⚠️  Không tìm thấy 'lt' hoặc 'npx localtunnel'. Vui lòng:"
  echo "    npm install -g localtunnel"
  echo "  hoặc chạy: npx localtunnel --port 3000"
  LT_PID=""
fi

LT_PID=$!

sleep 3

LT_URL=$(grep -o 'https://[^[:space:]]*' "$LT_LOG_FILE" | head -1)

if [ -n "$LT_URL" ]; then
  echo "🌐 Backend Tunnel URL: $LT_URL"
  echo ""
  echo "🔔 DIDIT webhook (nếu sau này dùng webhook):"
  echo "   $LT_URL/field-owner/ekyc/webhook"
  echo ""
  echo "🔔 PayOS webhook (đã dùng trong dự án):"
  echo "   $LT_URL/transactions/payos/webhook"
  echo ""
else
  echo "⚠️  Không lấy được tunnel URL. Xem log ở: $LT_LOG_FILE"
fi

# Start frontend (Vite) on all interfaces
cd "$FRONTEND_DIR" || exit 1
echo "Starting Frontend (Vite)..."
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Ready for mobile testing!"
echo ""
echo "📱 TEST TRÊN ĐIỆN THOẠI:"
echo "   Mở: http://$LOCAL_IP:5173"
echo ""
if [ -n "$LT_URL" ]; then
  echo "🔔 WEBHOOK URL COPY VÀO DASHBOARD (nếu cần):"
  echo "   PayOS: $LT_URL/transactions/payos/webhook"
  echo "   Didit (tùy chọn, nếu sau này dùng webhook): $LT_URL/field-owner/ekyc/webhook"
fi
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Nhấn Ctrl+C để dừng toàn bộ services."

# Cleanup on exit
trap 'echo ""; echo "🛑 Stopping services..."; kill $BACKEND_PID $FRONTEND_PID $LT_PID 2>/dev/null' EXIT

wait


