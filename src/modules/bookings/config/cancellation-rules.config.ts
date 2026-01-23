/**
 * Cancellation Rules Configuration
 * 
 * Defines business rules for booking cancellations based on:
 * - Time until booking start (hours)
 * - User role (USER, OWNER, COACH)
 * - Refund percentages
 * - Penalty fees
 */

export enum CancellationRole {
  USER = 'user',
  OWNER = 'owner',
  COACH = 'coach',
}

export interface CancellationRule {
  /** Time threshold in hours before booking start */
  hoursThreshold: number;
  /** Refund percentage for User (0-100) */
  userRefundPercentage: number;
  /** Penalty percentage for Owner/Coach (0-100) */
  ownerPenaltyPercentage: number;
  /** Coach penalty percentage (0-100) */
  coachPenaltyPercentage: number;
}

/**
 * Cancellation rules configuration
 * Rules are evaluated in order (first matching rule applies)
 */
export const CANCELLATION_RULES: CancellationRule[] = [
  {
    hoursThreshold: 24,
    userRefundPercentage: 100, // 100% refund (excluding platform fee)
    ownerPenaltyPercentage: 0, // No penalty
    coachPenaltyPercentage: 0, // No penalty
  },
  {
    hoursThreshold: 6,
    userRefundPercentage: 50, // 50% refund
    ownerPenaltyPercentage: 10, // 10% of slot value
    coachPenaltyPercentage: 10, // 10% of slot value
  },
  {
    hoursThreshold: 0,
    userRefundPercentage: 0, // 0% refund
    ownerPenaltyPercentage: 100, // 100% of slot value
    coachPenaltyPercentage: 100, // 100% of slot value
  },
];

/**
 * Hard rules that cannot be overridden
 */
export const CANCELLATION_HARD_RULES = {
  /** Booking statuses that CANNOT be cancelled */
  BLOCKED_STATUSES: ['started', 'completed'],
  /** Booking statuses that CAN be cancelled */
  ALLOWED_STATUSES: ['pending', 'confirmed'],
} as const;

/**
 * Platform fee is NOT refundable for User cancellations
 */
export const PLATFORM_FEE_REFUNDABLE = false;

/**
 * Get cancellation rule based on hours until booking start
 * @param hoursUntilStart - Hours until booking start (can be negative if booking has started)
 * @returns Matching cancellation rule
 */
export function getCancellationRule(hoursUntilStart: number): CancellationRule {
  // Sort rules by threshold descending (highest first)
  const sortedRules = [...CANCELLATION_RULES].sort((a, b) => b.hoursThreshold - a.hoursThreshold);
  
  // Find first rule where hoursUntilStart >= threshold
  for (const rule of sortedRules) {
    if (hoursUntilStart >= rule.hoursThreshold) {
      return rule;
    }
  }
  
  // If booking has started (negative hours), return the most restrictive rule
  return sortedRules[sortedRules.length - 1];
}

/**
 * Calculate user refund amount
 * @param bookingAmount - Base booking amount (excluding platform fee)
 * @param platformFee - Platform fee (NOT refundable)
 * @param hoursUntilStart - Hours until booking start
 * @returns Refund amount
 */
export function calculateUserRefund(
  bookingAmount: number,
  platformFee: number,
  hoursUntilStart: number
): number {
  const rule = getCancellationRule(hoursUntilStart);
  const refundPercentage = rule.userRefundPercentage / 100;
  
  // Only refund bookingAmount, NOT platformFee
  return bookingAmount * refundPercentage;
}

/**
 * Calculate owner/coach penalty amount
 * @param slotValue - Total slot value (bookingAmount + platformFee)
 * @param hoursUntilStart - Hours until booking start
 * @param role - Cancellation role (OWNER or COACH)
 * @returns Penalty amount
 */
export function calculatePenalty(
  slotValue: number,
  hoursUntilStart: number,
  role: CancellationRole.OWNER | CancellationRole.COACH
): number {
  const rule = getCancellationRule(hoursUntilStart);
  const penaltyPercentage = role === CancellationRole.OWNER 
    ? rule.ownerPenaltyPercentage 
    : rule.coachPenaltyPercentage;
  
  return slotValue * (penaltyPercentage / 100);
}
