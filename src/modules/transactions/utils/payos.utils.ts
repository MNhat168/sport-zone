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
 * Verify PayOS webhook/callback signature.
 *
 * Lưu ý quan trọng:
 * - Theo spec mới của PayOS, signature được tính trên TOÀN BỘ các field của object `data`
 *   (trừ field `signature` nếu có, và các field null/undefined/rỗng).
 * - Vì vậy ta phải duyệt dynamic tất cả key trong `data`, sort theo alphabet rồi join
 *   thành chuỗi query `key1=value1&key2=value2&...` trước khi hash.
 * 
 * @param data - Object `data` PayOS gửi (KHÔNG bao gồm signature, hoặc nếu có sẽ bị bỏ qua)
 * @param receivedSignature - Signature to verify
 * @param checksumKey - PayOS checksum key
 * @returns true if valid
 */
export function verifyPayOSSignature(
  data: Record<string, any>,
  receivedSignature: string,
  checksumKey: string
): boolean {
  try {
    // 1) Log all received fields (insertion order preserved by V8)
    const allKeys = Object.keys(data || {});
    console.log('[PayOS Signature] All received fields:', allKeys.sort().join(', '));

    // Helpers
    const buildQuery = (obj: Record<string, any>, keys: string[], includeEmpty: boolean) =>
      keys
        .filter((k) => includeEmpty ? true : (obj[k] !== null && obj[k] !== undefined && obj[k] !== ''))
        .map((k) => `${k}=${obj[k]}`)
        .join('&');

    // Prepare variants of keys
    const keysOrig = Object.keys(data || {});                 // original/insertion order
    const keysAlpha = [...keysOrig].sort();                   // alphabetical

    // Sanity: payloads to try (broadest to narrowest)
    const candidates: { label: string; payload: string }[] = [];

    // A1. All fields (alphabetical), include empty values
    candidates.push({ label: 'all-alpha-include-empty', payload: buildQuery(data, keysAlpha, true) });
    // A2. All fields (original order), include empty values
    candidates.push({ label: 'all-orig-include-empty', payload: buildQuery(data, keysOrig, true) });

    // B1. All fields (alphabetical), skip empty values
    candidates.push({ label: 'all-alpha-nonempty', payload: buildQuery(data, keysAlpha, false) });
    // B2. All fields (original order), skip empty values
    candidates.push({ label: 'all-orig-nonempty', payload: buildQuery(data, keysOrig, false) });

    // C. Six canonical fields (alphabetical)
    const six = ['accountNumber','amount','description','orderCode','reference','transactionDateTime'];
    if (six.every((k) => k in (data || {}))) {
      const sixAlpha = [...six].sort();
      candidates.push({ label: 'six-fields-alpha', payload: buildQuery(data, sixAlpha, true) });
      // Also try given order (as documented order)
      candidates.push({ label: 'six-fields-given', payload: buildQuery(data, six, true) });
    }

    // D. JSON stringify of the ORIGINAL object
    candidates.push({ label: 'json-stringify', payload: JSON.stringify(data || {}) });

    // 2) Try candidates sequentially
    for (const c of candidates) {
      const expected = crypto.createHmac('sha256', checksumKey).update(c.payload).digest('hex');
      const ok = expected === receivedSignature;
      console.log(`[PayOS Signature] Try ${c.label}: ${ok ? '✅ match' : '❌ no match'}`);
      if (ok) return true;
      if (c.label.startsWith('six-fields')) {
        console.log('[PayOS Signature] six payload:', c.payload);
        console.log('[PayOS Signature] six expected:', expected);
        console.log('[PayOS Signature] received:', receivedSignature);
      }
    }

    return false;
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
 * Generate PayOS order code (numeric, max 15 digits to stay within MAX_SAFE_INTEGER)
 * MAX_SAFE_INTEGER = 9007199254740991 (16 digits)
 * We use 15 digits to be safe: YYMMDDHHMMSS + 3 random digits
 */
export function generatePayOSOrderCode(): number {
  // Use timestamp + random for uniqueness
  // Format: YYMMDDHHMMSS + 3 random digits (15 digits total)
  // This ensures we stay well below MAX_SAFE_INTEGER (9007199254740991)
  const now = new Date();
  const year = now.getFullYear() % 100; // Get last 2 digits of year (YY)
  const timestamp = [
    String(year).padStart(2, '0'),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');
  
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  const orderCodeString = timestamp + random;
  const orderCode = parseInt(orderCodeString, 10);
  
  // Validate: ensure it's within safe integer range
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991
  if (orderCode > MAX_SAFE_INTEGER) {
    // Fallback: use modulo to ensure it's safe (shouldn't happen with 15 digits)
    return orderCode % 1000000000000000; // Max 15 digits
  }
  
  return orderCode;
}

/**
 * Validate PayOS order code format
 */
export function isValidPayOSOrderCode(orderCode: number): boolean {
  const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER; // 9007199254740991
  return (
    typeof orderCode === 'number' &&
    orderCode > 0 &&
    orderCode <= MAX_SAFE_INTEGER // Must be within safe integer range
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

