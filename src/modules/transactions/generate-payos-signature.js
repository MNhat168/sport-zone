/**
 * Script để generate PayOS signature cho testing
 * Chạy: node generate-payos-signature.js
 */

const crypto = require('crypto');

// Checksum key từ .env của bạn
const CHECKSUM_KEY = '31ac6ca7aa720681b97596c9cdbb1fc0c0d6c2dcdc1d5c5accd78a14915408b9';

/**
 * Generate signature cho webhook test data
 */
function generateWebhookSignature() {
  console.log('='.repeat(60));
  console.log('PAYOS WEBHOOK SIGNATURE GENERATOR');
  console.log('='.repeat(60));
  
  // Data từ webhook (KHÔNG bao gồm signature)
  const data = {
    accountNumber: "1",
    amount: 1000,
    description: "test",
    orderCode: 123,
    reference: "abc",
    transactionDateTime: "2025-11-05 10:00:00"
  };
  
  console.log('\n1. Original Data:');
  console.log(JSON.stringify(data, null, 2));
  
  // Sort keys alphabetically (QUAN TRỌNG!)
  const sortedKeys = Object.keys(data).sort();
  console.log('\n2. Sorted Keys:', sortedKeys.join(', '));
  
  // Build query string
  const dataString = sortedKeys
    .map(key => `${key}=${data[key]}`)
    .join('&');
  
  console.log('\n3. Data String:');
  console.log(dataString);
  console.log('Length:', dataString.length, 'chars');
  
  // Generate HMAC SHA256
  const signature = crypto
    .createHmac('sha256', CHECKSUM_KEY)
    .update(dataString)
    .digest('hex');
  
  console.log('\n4. Generated Signature:');
  console.log('Full:', signature);
  console.log('First 8 chars:', signature.substring(0, 8) + '...');
  console.log('Last 4 chars:', '...' + signature.substring(signature.length - 4));
  
  console.log('\n5. Webhook Body để test:');
  const webhookBody = {
    data: data,
    signature: signature
  };
  console.log(JSON.stringify(webhookBody, null, 2));
  
  console.log('\n6. CURL Command:');
  console.log(`curl -X POST http://localhost:3000/transactions/payos/webhook \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(webhookBody)}'`);
  
  console.log('\n' + '='.repeat(60));
  
  return signature;
}

/**
 * Verify một signature đã có
 */
function verifySignature(dataObj, receivedSignature) {
  console.log('\n' + '='.repeat(60));
  console.log('VERIFY PAYOS SIGNATURE');
  console.log('='.repeat(60));
  
  // Remove signature from data
  const { signature, ...dataToSign } = dataObj;
  
  // Sort keys
  const sortedKeys = Object.keys(dataToSign).sort();
  
  // Build string
  const dataString = sortedKeys
    .map(key => `${key}=${dataToSign[key]}`)
    .join('&');
  
  console.log('\nData String:', dataString);
  
  // Generate expected signature
  const expectedSignature = crypto
    .createHmac('sha256', CHECKSUM_KEY)
    .update(dataString)
    .digest('hex');
  
  console.log('\nExpected Signature:', expectedSignature);
  console.log('Received Signature:', receivedSignature);
  
  const isValid = expectedSignature === receivedSignature;
  console.log('\nResult:', isValid ? '✅ VALID' : '❌ INVALID');
  
  if (!isValid) {
    console.log('\nMismatch Details:');
    console.log('Expected (first 20):', expectedSignature.substring(0, 20));
    console.log('Received (first 20):', receivedSignature.substring(0, 20));
  }
  
  console.log('='.repeat(60) + '\n');
  
  return isValid;
}

/**
 * Generate signature cho payment creation
 */
function generatePaymentSignature() {
  console.log('='.repeat(60));
  console.log('PAYOS PAYMENT CREATION SIGNATURE');
  console.log('='.repeat(60));
  
  const paymentData = {
    amount: 200000,
    cancelUrl: "http://localhost:5173/transactions/payos/cancel",
    description: "Thanh toan san tennis",
    orderCode: 20251106001,
    returnUrl: "http://localhost:5173/transactions/payos/return"
  };
  
  console.log('\n1. Payment Data:');
  console.log(JSON.stringify(paymentData, null, 2));
  
  const sortedKeys = Object.keys(paymentData).sort();
  const dataString = sortedKeys
    .map(key => `${key}=${paymentData[key]}`)
    .join('&');
  
  console.log('\n2. Data String:');
  console.log(dataString);
  
  const signature = crypto
    .createHmac('sha256', CHECKSUM_KEY)
    .update(dataString)
    .digest('hex');
  
  console.log('\n3. Signature:');
  console.log(signature);
  
  console.log('='.repeat(60) + '\n');
  
  return signature;
}

// Main
console.log('\n');
console.log('🔐 PayOS Signature Tool\n');

// 1. Generate webhook signature
const webhookSig = generateWebhookSignature();

// 2. Test verify với data giả
console.log('\n📝 Testing verification with dummy signature...');
verifySignature(
  {
    accountNumber: "1",
    amount: 1000,
    description: "test",
    orderCode: 123,
    reference: "abc",
    transactionDateTime: "2025-11-05 10:00:00",
    signature: "dummy"
  },
  "dummy"
);

// 3. Test verify với signature đúng
console.log('📝 Testing verification with correct signature...');
verifySignature(
  {
    accountNumber: "1",
    amount: 1000,
    description: "test",
    orderCode: 123,
    reference: "abc",
    transactionDateTime: "2025-11-05 10:00:00"
  },
  webhookSig
);

// 4. Generate payment signature
console.log('\n');
generatePaymentSignature();

console.log('\n✅ Done! Copy webhook body above để test với Postman hoặc curl.\n');
