/**
 * Payment Method Enum
 * Các phương thức thanh toán được hỗ trợ trong hệ thống
 */
export enum PaymentMethod {
  /** Trả tiền mặt tại chỗ */
  CASH = 1,
  
  /** Internet Banking */
  EBANKING = 2,
  
  /** Thẻ tín dụng */
  CREDIT_CARD = 3,
  
  /** Thẻ ghi nợ */
  DEBIT_CARD = 4,
  
  /** Ví điện tử MoMo */
  MOMO = 5,
  
  /** Ví điện tử ZaloPay */
  ZALOPAY = 6,
  
  /** Chuyển khoản ngân hàng */
  BANK_TRANSFER = 8,
  
  /** QR Code thanh toán */
  QR_CODE = 9,

  /** Giao dịch nội bộ hệ thống (payout, fee) */
  INTERNAL = 10,

  /** Cổng thanh toán PayOS */
  PAYOS = 11,
  WALLET,
}

/**
 * Payment Method Labels for UI display
 */
export const PaymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'Trả tiền mặt',
  [PaymentMethod.EBANKING]: 'Internet Banking',
  [PaymentMethod.CREDIT_CARD]: 'Thẻ tín dụng',
  [PaymentMethod.DEBIT_CARD]: 'Thẻ ghi nợ',
  [PaymentMethod.MOMO]: 'Ví MoMo',
  [PaymentMethod.ZALOPAY]: 'ZaloPay',
  [PaymentMethod.BANK_TRANSFER]: 'Chuyển khoản ngân hàng',
  [PaymentMethod.QR_CODE]: 'QR Code',
  [PaymentMethod.INTERNAL]: 'Giao dịch nội bộ',
  [PaymentMethod.PAYOS]: 'PayOS',
  [PaymentMethod.WALLET]: ""
};

/**
 * Payment Method Names mapping (number -> string name)
 */
export const PaymentMethodNames: Record<PaymentMethod, string> = {
  [PaymentMethod.CASH]: 'cash',
  [PaymentMethod.EBANKING]: 'ebanking',
  [PaymentMethod.CREDIT_CARD]: 'credit_card',
  [PaymentMethod.DEBIT_CARD]: 'debit_card',
  [PaymentMethod.MOMO]: 'momo',
  [PaymentMethod.ZALOPAY]: 'zalopay',
  [PaymentMethod.BANK_TRANSFER]: 'bank_transfer',
  [PaymentMethod.QR_CODE]: 'qr_code',
  [PaymentMethod.INTERNAL]: 'internal',
  [PaymentMethod.PAYOS]: 'payos',
  [PaymentMethod.WALLET]: ""
};

/**
 * Utility functions for payment method conversion
 */
export class PaymentMethodUtils {
  /**
   * Get display label by payment method number
   */
  static getLabel(method: PaymentMethod): string {
    return PaymentMethodLabels[method] || 'Unknown';
  }

  /**
   * Get method name by payment method number  
   */
  static getName(method: PaymentMethod): string {
    return PaymentMethodNames[method] || 'unknown';
  }

  /**
   * Get all available payment methods
   */
  static getAllMethods(): Array<{ value: PaymentMethod; label: string; name: string }> {
    return Object.values(PaymentMethod)
      .filter(value => typeof value === 'number')
      .map(value => ({
        value: value as PaymentMethod,
        label: PaymentMethodLabels[value as PaymentMethod],
        name: PaymentMethodNames[value as PaymentMethod],
      }));
  }
}