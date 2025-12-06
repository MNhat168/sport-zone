/**
 * Transaction Status
 */
export enum TransactionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
}

/**
 * Transaction Type – FULLY COVER ALL CASES
 */
export enum TransactionType {
  PAYMENT = 'payment',               // Khách → hệ thống
  REFUND_FULL = 'refund_full',
  REFUND_PARTIAL = 'refund_partial',
  REVERSAL = 'reversal',             // Chargeback
  ADJUSTMENT = 'adjustment',         // Manual ±
  PAYOUT = 'payout',                 // Hệ thống → coach / field owner
  FEE = 'fee',                       // Phí hệ thống thu
}
