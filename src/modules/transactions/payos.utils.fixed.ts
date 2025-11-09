/**
 * PayOS Utilities
 * Signature verification and helper functions
 */

import * as crypto from 'crypto';

/**
 * Create PayOS signature for payment request
 * Used when creating payment link
 */
export function createPayOSSignature(
  data: {
    orderCode: number;
    amount: number;
    description: string;
    cancelUrl: string;
    returnUrl: string;
  },
  checksumKey: string
): string {
  // Sort keys alphabetically
  const sortedKeys = Object.keys(data).sort();
  
  // Create data string: key1=value1&key2=value2
  const dataString = sortedKeys
    .map(key => `${key}=${data[key]}`)
    .join('&');
  
  console.log('[PayOS Signature] Create - Data:', dataString);
  
  // Generate HMAC SHA256
  const signature = crypto
    .createHmac('sha256', checksumKey)
    .update(dataString)
    .digest('hex');
  
  console.log('[PayOS Signature] Create - Generated:', signature.substring(0, 8) + '...');
  
  return signature;
}

/**
 * Verify PayOS webhook/callback signature
 * 
 * IMPORTANT: PayOS sends data in 2 formats:
 * 
 * 1. Return URL (GET): signature in query params
 *    ?orderCode=123&amount=1000&signature=abc123...
 * 
 * 2. Webhook (POST): signature at root level
 *    { 
 *      "data": { orderCode, amount, ... },
 *      "signature": "abc123..."
 *    }
 */
export function verifyPayOSSignature(
  data: Record<string, any>,
  receivedSignature: string,
  checksumKey: string
): boolean {
  try {
    // Remove signature from data before verification
    const { signature, ...dataToSign } = data;
    
    // Sort keys alphabetically (CRITICAL for PayOS)
    const sortedKeys = Object.keys(dataToSign).sort();
    
    // Build query string: key1=value1&key2=value2
    const dataString = sortedKeys
      .map(key => `${key}=${dataToSign[key]}`)
      .join('&');
    
    console.log('[PayOS Signature] Data to sign (query):', dataString);
    console.log('[PayOS Signature] Data length:', dataString.length);
    
    // Generate expected signature
    const expectedSignature = crypto
      .createHmac('sha256', checksumKey)
      .update(dataString)
      .digest('hex');
    
    console.log('[PayOS Signature] Generated (first 8):', expectedSignature.substring(0, 8) + '...');
    
    // Compare signatures
    const isValid = expectedSignature === receivedSignature;
    
    if (!isValid) {
      console.warn('[PayOS Signature] ❌ Signature verification failed');
      console.log('[PayOS Signature] Expected:', expectedSignature.substring(0, 8) + '...' + expectedSignature.substring(expectedSignature.length - 4));
      console.log('[PayOS Signature] Received:', receivedSignature.substring(0, 8) + '...' + receivedSignature.substring(receivedSignature.length - 4));
      console.log('[PayOS Signature] Data keys:', Object.keys(dataToSign).join(', '));
    } else {
      console.log('[PayOS Signature] ✅ Signature verified');
    }
    
    return isValid;
  } catch (error) {
    console.error('[PayOS Signature] Error:', error.message);
    return false;
  }
}

/**
 * Validate PayOS webhook data structure
 */
export function validatePayOSWebhookData(data: any): boolean {
  return !!(
    data &&
    typeof data === 'object' &&
    data.orderCode &&
    data.amount &&
    data.description
  );
}

/**
 * Generate PayOS order code (numeric, max 17 digits)
 */
export function generatePayOSOrderCode(): number {
  // Use timestamp + random for uniqueness
  // Format: YYYYMMDDHHMMSS + 3 random digits
  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const orderCode = parseInt(timestamp + random);
  
  // Ensure it's within 17 digits
  return orderCode % 100000000000000000; // Max 17 digits
}

/**
 * Validate PayOS order code format
 */
export function isValidPayOSOrderCode(orderCode: number): boolean {
  return (
    typeof orderCode === 'number' &&
    orderCode > 0 &&
    orderCode < 100000000000000000 // Max 17 digits
  );
}

/**
 * Format amount for PayOS (must be positive integer)
 */
export function formatPayOSAmount(amount: number): number {
  return Math.max(1, Math.floor(amount));
}

/**
 * Get PayOS response description
 */
export function getPayOSResponseDescription(code: string): string {
  const descriptions: Record<string, string> = {
    '00': 'Giao dịch thành công',
    '01': 'Giao dịch thất bại',
    '02': 'Giao dịch đã được xử lý',
    '03': 'Giao dịch đã bị hủy',
    '97': 'Chữ ký không hợp lệ',
    '98': 'Số tiền không khớp',
    '99': 'Lỗi hệ thống',
  };
  
  return descriptions[code] || 'Không xác định';
}
