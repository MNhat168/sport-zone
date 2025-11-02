/**
 * VNPay Utilities
 * Based on official VNPay Node.js demo
 * Reference: vnpay_nodejs/routes/order.js
 */

import * as crypto from 'crypto';
import * as qs from 'qs';
import { Logger } from '@nestjs/common';

const logger = new Logger('VNPayUtils');

/**
 * Sort object keys alphabetically and encode values
 * This is CRITICAL for VNPay signature generation
 * Must match VNPay's sorting algorithm exactly
 * Based on vnpay_nodejs/routes/order.js sortObject function
 */
export function sortObject(obj: Record<string, any>): Record<string, string> {
  const sorted: Record<string, string> = {};
  const str: string[] = [];
  
  // Collect and encode keys
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      str.push(encodeURIComponent(key));
    }
  }
  
  // Sort keys alphabetically
  str.sort();
  
  // Build sorted object with encoded values
  for (let i = 0; i < str.length; i++) {
    const encodedKey = str[i];
    const decodedKey = decodeURIComponent(encodedKey);
    // Encode value and replace %20 with + (EXACTLY like VNPay does)
    const encodedValue = encodeURIComponent(String(obj[decodedKey])).replace(/%20/g, '+');
    sorted[encodedKey] = encodedValue;
  }
  
  return sorted;
}

/**
 * Generate VNPay secure hash (signature)
 * Uses HMAC SHA-512 algorithm
 * 
 * @param params - VNPay parameters (already sorted)
 * @param secretKey - VNPay hash secret from config
 * @returns Hex string signature
 */
export function generateVNPaySignature(
  params: Record<string, string>,
  secretKey: string
): string {
  // Create sign data from sorted params
  const signData = qs.stringify(params, { encode: false });
  
  logger.debug(`[VNPay Signature] Sign data: ${signData}`);
  
  // Create HMAC SHA-512 hash
  const hmac = crypto.createHmac('sha512', secretKey);
  const signature = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  
  logger.debug(`[VNPay Signature] Generated: ${signature.substring(0, 20)}...`);
  
  return signature;
}

/**
 * Verify VNPay signature from callback
 * Used in IPN and Return URL handlers
 * 
 * @param params - Query parameters from VNPay
 * @param secretKey - VNPay hash secret from config
 * @param receivedHash - vnp_SecureHash from VNPay
 * @returns true if signature is valid
 */
export function verifyVNPaySignature(
  params: Record<string, any>,
  secretKey: string,
  receivedHash: string
): boolean {
  // Remove hash fields before verification
  const paramsToVerify = { ...params };
  delete paramsToVerify.vnp_SecureHash;
  delete paramsToVerify.vnp_SecureHashType;
  
  // CRITICAL: VNPay uses encoded values (space -> +) for signature
  // Since Express decodes query params, we need to re-encode them
  // Sort parameters alphabetically by KEY
  const sortedKeys = Object.keys(paramsToVerify).sort();
  
  // Encode each value like VNPay does (encodeURIComponent then replace %20 with +)
  const sortedParams: Record<string, string> = {};
  for (const key of sortedKeys) {
    const value = paramsToVerify[key];
    // Encode value and replace %20 with + (like VNPay sortObject function)
    const encodedValue = encodeURIComponent(String(value)).replace(/%20/g, '+');
    sortedParams[key] = encodedValue;
  }
  
  // Generate sign data: key=value&key=value format (no URL encoding of keys/values, just join)
  const signData = sortedKeys
    .map(key => `${key}=${sortedParams[key]}`)
    .join('&');
  
  const hmac = crypto.createHmac('sha512', secretKey);
  const calculatedHash = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  
  const isValid = calculatedHash === receivedHash;
  
  logger.debug(`[VNPay Verify] Received hash: ${receivedHash.substring(0, 20)}...`);
  logger.debug(`[VNPay Verify] Calculated hash: ${calculatedHash.substring(0, 20)}...`);
  logger.debug(`[VNPay Verify] Sign data: ${signData}`);
  logger.debug(`[VNPay Verify] Valid: ${isValid}`);
  
  return isValid;
}

/**
 * Create VNPay payment URL
 * Based on vnpay_nodejs create_payment_url implementation
 * 
 * @param config - VNPay configuration
 * @param params - Payment parameters
 * @returns Complete VNPay payment URL
 */
export function createVNPayPaymentUrl(
  config: {
    vnp_TmnCode: string;
    vnp_HashSecret: string;
    vnp_Url: string;
    vnp_ReturnUrl: string;
  },
  params: {
    amount: number;
    orderId: string;
    orderInfo: string;
    ipAddr: string;
    bankCode?: string;
    locale?: string;
  }
): string {
  // Validate config
  if (!config.vnp_TmnCode || !config.vnp_HashSecret || !config.vnp_Url) {
    throw new Error('VNPay configuration is incomplete');
  }
  
  // Trim whitespace from config
  const tmnCode = config.vnp_TmnCode.trim();
  const hashSecret = config.vnp_HashSecret.trim();
  const vnpUrl = config.vnp_Url.trim();
  const returnUrl = config.vnp_ReturnUrl.trim();
  
  // Generate create date (YYYYMMDDHHmmss format)
  const date = new Date();
  const createDate = [
    date.getFullYear(),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
  ].join('');
  
  // Build VNPay parameters (must match VNPay specification)
  const vnpParams: Record<string, string> = {
    vnp_Version: '2.1.0',
    vnp_Command: 'pay',
    vnp_TmnCode: tmnCode,
    vnp_Locale: params.locale || 'vn',
    vnp_CurrCode: 'VND',
    vnp_TxnRef: params.orderId,
    vnp_OrderInfo: params.orderInfo,
    vnp_OrderType: 'other',
    vnp_Amount: (params.amount * 100).toString(), // VNPay uses smallest currency unit
    vnp_ReturnUrl: returnUrl,
    vnp_IpAddr: params.ipAddr,
    vnp_CreateDate: createDate,
  };
  
  // Add bank code if specified
  if (params.bankCode) {
    vnpParams.vnp_BankCode = params.bankCode;
  }
  
  // Sort parameters (CRITICAL for signature)
  const sortedParams = sortObject(vnpParams);
  
  // Generate signature
  const signData = qs.stringify(sortedParams, { encode: false });
  const hmac = crypto.createHmac('sha512', hashSecret);
  const signature = hmac.update(Buffer.from(signData, 'utf-8')).digest('hex');
  
  // Add signature to parameters
  sortedParams['vnp_SecureHash'] = signature;
  
  // Build final URL
  const finalUrl = `${vnpUrl}?${qs.stringify(sortedParams, { encode: false })}`;
  
  logger.log(`[VNPay URL] Created for order ${params.orderId}, amount ${params.amount} VND`);
  logger.debug(`[VNPay URL] Sign data: ${signData}`);
  logger.debug(`[VNPay URL] Signature: ${signature}`);
  
  return finalUrl;
}

/**
 * VNPay Response Codes
 * Reference: VNPay API Documentation
 */
export const VNPayResponseCode = {
  SUCCESS: '00',
  TRANSACTION_NOT_FOUND: '01',
  TRANSACTION_ALREADY_CONFIRMED: '02',
  INVALID_AMOUNT: '04',
  TRANSACTION_FAILED: '05',
  TRANSACTION_ERROR: '06',
  PAYMENT_BLOCKED: '07',
  AUTHENTICATION_FAILED: '09',
  CARD_LOCKED: '10',
  CARD_EXPIRED: '11',
  INVALID_CARD: '12',
  INSUFFICIENT_BALANCE: '13',
  CARD_INFO_ERROR: '24',
  TRANSACTION_NOT_ALLOWED: '51',
  TRANSACTION_FEE_ERROR: '65',
  CHECKSUM_ERROR: '97',
  OTHER_ERROR: '99',
} as const;

/**
 * Get Vietnamese description for VNPay response code
 */
export function getVNPayResponseDescription(code: string): string {
  const descriptions: Record<string, string> = {
    '00': 'Giao dịch thành công',
    '01': 'Không tìm thấy giao dịch',
    '02': 'Giao dịch đã được xác nhận',
    '04': 'Số tiền không hợp lệ',
    '05': 'Giao dịch thất bại',
    '06': 'Có lỗi xảy ra trong quá trình xử lý',
    '07': 'Giao dịch bị khóa',
    '09': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng chưa đăng ký dịch vụ InternetBanking tại ngân hàng',
    '10': 'Giao dịch không thành công do: Khách hàng xác thực thông tin thẻ/tài khoản không đúng quá 3 lần',
    '11': 'Giao dịch không thành công do: Đã hết hạn chờ thanh toán. Xin quý khách vui lòng thực hiện lại giao dịch',
    '12': 'Giao dịch không thành công do: Thẻ/Tài khoản của khách hàng bị khóa',
    '13': 'Giao dịch không thành công do: Quý khách nhập sai mật khẩu xác thực giao dịch (OTP)',
    '24': 'Giao dịch không thành công do: Khách hàng hủy giao dịch',
    '51': 'Giao dịch không thành công do: Tài khoản của quý khách không đủ số dư để thực hiện giao dịch',
    '65': 'Giao dịch không thành công do: Tài khoản của Quý khách đã vượt quá hạn mức giao dịch trong ngày',
    '75': 'Ngân hàng thanh toán đang bảo trì',
    '79': 'Giao dịch không thành công do: KH nhập sai mật khẩu thanh toán quá số lần quy định',
    '97': 'Chữ ký không hợp lệ',
    '99': 'Các lỗi khác',
  };
  
  return descriptions[code] || 'Lỗi không xác định';
}

/**
 * Format date for VNPay API (YYYYMMDDHHmmss)
 */
export function formatVNPayDate(date: Date): string {
  return [
    date.getFullYear(),
    (date.getMonth() + 1).toString().padStart(2, '0'),
    date.getDate().toString().padStart(2, '0'),
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
  ].join('');
}

/**
 * Generate VNPay request ID
 * Format: HHmmss
 */
export function generateVNPayRequestId(): string {
  const date = new Date();
  return [
    date.getHours().toString().padStart(2, '0'),
    date.getMinutes().toString().padStart(2, '0'),
    date.getSeconds().toString().padStart(2, '0'),
  ].join('');
}

/**
 * Parse VNPay date string to Date object
 */
export function parseVNPayDate(dateString: string): Date {
  // Format: YYYYMMDDHHmmss
  const year = parseInt(dateString.substring(0, 4));
  const month = parseInt(dateString.substring(4, 6)) - 1;
  const day = parseInt(dateString.substring(6, 8));
  const hours = parseInt(dateString.substring(8, 10));
  const minutes = parseInt(dateString.substring(10, 12));
  const seconds = parseInt(dateString.substring(12, 14));
  
  return new Date(year, month, day, hours, minutes, seconds);
}

