/**
 * Payment Method Enum
 * Các phương thức thanh toán được hỗ trợ trong hệ thống
 */
export enum PaymentMethod {
  /** Chuyển khoản ngân hàng */
  BANK_TRANSFER = 8,

  /** Giao dịch nội bộ hệ thống (payout, fee) */
  INTERNAL = 10,

  /** Cổng thanh toán PayOS */
  PAYOS = 11,

  /** Ví */
  WALLET = 12,
}

/**
 * Payment Method Labels for UI display
 */
export const PaymentMethodLabels: Record<PaymentMethod, string> = {
  [PaymentMethod.BANK_TRANSFER]: 'Chuyển khoản ngân hàng',
  [PaymentMethod.INTERNAL]: 'Giao dịch nội bộ',
  [PaymentMethod.PAYOS]: 'PayOS',
  [PaymentMethod.WALLET]: "Ví"
};

/**
 * Payment Method Names mapping (number -> string name)
 */
export const PaymentMethodNames: Record<PaymentMethod, string> = {
  [PaymentMethod.BANK_TRANSFER]: 'bank_transfer',
  [PaymentMethod.INTERNAL]: 'internal',
  [PaymentMethod.PAYOS]: 'payos',
  [PaymentMethod.WALLET]: "wallet"
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
