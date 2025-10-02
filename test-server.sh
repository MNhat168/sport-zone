#!/bin/bash
echo "Testing NestJS server startup..."
cd /e/Capstone-project/BE
echo "Current directory: $(pwd)"
echo "Installing dependencies..."
npm install
echo "Starting server..."
npm run start:dev &
SERVER_PID=$!
echo "Server started with PID: $SERVER_PID"
sleep 10
echo "Checking if server is running..."
if kill -0 $SERVER_PID 2>/dev/null; then
  echo "✅ Server is running successfully!"
  kill $SERVER_PID
  echo "Server stopped."
else
  echo "❌ Server failed to start."
fi