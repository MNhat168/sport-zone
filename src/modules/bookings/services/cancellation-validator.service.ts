import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Booking } from '../entities/booking.entity';
import { BookingStatus } from '@common/enums/booking.enum';
import {
  CancellationRole,
  CANCELLATION_HARD_RULES,
  getCancellationRule,
  calculateUserRefund,
  calculatePenalty,
  PLATFORM_FEE_REFUNDABLE,
} from '../config/cancellation-rules.config';

export interface CancellationEligibility {
  /** Whether cancellation is allowed */
  allowed: boolean;
  /** Error message if not allowed */
  errorMessage?: string;
  /** Hours until booking start (negative if booking has started) */
  hoursUntilStart: number;
  /** Whether booking has started */
  hasStarted: boolean;
  /** Whether booking is completed */
  isCompleted: boolean;
}

export interface CancellationInfo {
  /** Eligibility check result */
  eligibility: CancellationEligibility;
  /** Refund amount for User (if applicable) */
  refundAmount?: number;
  /** Refund percentage for User */
  refundPercentage?: number;
  /** Penalty amount for Owner/Coach (if applicable) */
  penaltyAmount?: number;
  /** Penalty percentage for Owner/Coach */
  penaltyPercentage?: number;
  /** Slot value (bookingAmount + platformFee) */
  slotValue?: number;
  /** Warning message to display to user */
  warningMessage?: string;
}

/**
 * Cancellation Validator Service
 * Validates cancellation eligibility and calculates refund/penalty amounts
 */
@Injectable()
export class CancellationValidatorService {
  private readonly logger = new Logger(CancellationValidatorService.name);

  /**
   * Combine booking date and start time to create DateTime in Vietnam timezone
   * @param booking - Booking entity
   * @returns Date object representing booking start time in Vietnam timezone
   */
  private combineBookingDateTime(booking: Booking): Date {
    const date = new Date(booking.date);
    const [hours, minutes] = booking.startTime.split(':').map(Number);
    
    // Get date string in YYYY-MM-DD format
    const dateStr = date.toISOString().split('T')[0];
    const timeStr = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
    
    // Construct ISO string with Vietnam timezone (+07:00)
    return new Date(`${dateStr}T${timeStr}+07:00`);
  }

  /**
   * Calculate hours until booking start
   * @param booking - Booking entity
   * @returns Hours until booking start (negative if booking has started)
   */
  calculateHoursUntilStart(booking: Booking): number {
    const bookingStartTime = this.combineBookingDateTime(booking);
    const now = new Date();
    
    const diffMs = bookingStartTime.getTime() - now.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    
    return diffHours;
  }

  /**
   * Check if booking has started
   * @param booking - Booking entity
   * @returns True if booking has started
   */
  hasBookingStarted(booking: Booking): boolean {
    const hoursUntilStart = this.calculateHoursUntilStart(booking);
    return hoursUntilStart <= 0;
  }

  /**
   * Check if booking is completed
   * @param booking - Booking entity
   * @returns True if booking is completed
   */
  isBookingCompleted(booking: Booking): boolean {
    return booking.status === BookingStatus.COMPLETED;
  }

  /**
   * Validate cancellation eligibility
   * @param booking - Booking entity
   * @param role - Cancellation role (USER, OWNER, COACH)
   * @returns Eligibility result
   */
  validateCancellationEligibility(
    booking: Booking,
    role: CancellationRole
  ): CancellationEligibility {
    const hoursUntilStart = this.calculateHoursUntilStart(booking);
    const hasStarted = hoursUntilStart <= 0;
    const isCompleted = this.isBookingCompleted(booking);

    // Hard rule: Cannot cancel if booking has started or is completed
    if (hasStarted || isCompleted) {
      return {
        allowed: false,
        errorMessage: hasStarted
          ? 'Không thể hủy booking đã bắt đầu. Vui lòng liên hệ CSKH để được hỗ trợ.'
          : 'Không thể hủy booking đã hoàn thành.',
        hoursUntilStart,
        hasStarted,
        isCompleted,
      };
    }

    // Check if booking status allows cancellation
    const status = booking.status?.toLowerCase();
    if (!CANCELLATION_HARD_RULES.ALLOWED_STATUSES.includes(status as any)) {
      return {
        allowed: false,
        errorMessage: `Không thể hủy booking với trạng thái: ${status}. Chỉ có thể hủy booking ở trạng thái: ${CANCELLATION_HARD_RULES.ALLOWED_STATUSES.join(', ')}`,
        hoursUntilStart,
        hasStarted,
        isCompleted,
      };
    }

    // Additional role-specific validations
    if (role === CancellationRole.USER) {
      // User can only cancel their own bookings
      // This is checked at service level, not here
    } else if (role === CancellationRole.COACH) {
      // Coach can only cancel accepted bookings
      if (booking.coachStatus !== 'accepted') {
        return {
          allowed: false,
          errorMessage: 'Chỉ có thể hủy booking đã được chấp nhận.',
          hoursUntilStart,
          hasStarted,
          isCompleted,
        };
      }
    }

    return {
      allowed: true,
      hoursUntilStart,
      hasStarted,
      isCompleted,
    };
  }

  /**
   * Calculate user refund amount
   * @param booking - Booking entity
   * @returns Refund amount and percentage
   */
  calculateUserRefund(booking: Booking): { refundAmount: number; refundPercentage: number } {
    const hoursUntilStart = this.calculateHoursUntilStart(booking);
    const rule = getCancellationRule(hoursUntilStart);
    
    const refundAmount = calculateUserRefund(
      booking.bookingAmount,
      booking.platformFee || 0,
      hoursUntilStart
    );
    
    return {
      refundAmount,
      refundPercentage: rule.userRefundPercentage,
    };
  }

  /**
   * Calculate owner/coach penalty amount
   * @param booking - Booking entity
   * @param role - Cancellation role (OWNER or COACH)
   * @returns Penalty amount and percentage
   */
  calculatePenalty(
    booking: Booking,
    role: CancellationRole.OWNER | CancellationRole.COACH
  ): { penaltyAmount: number; penaltyPercentage: number } {
    const hoursUntilStart = this.calculateHoursUntilStart(booking);
    const slotValue = booking.bookingAmount + (booking.platformFee || 0);
    
    const penaltyAmount = calculatePenalty(slotValue, hoursUntilStart, role);
    const rule = getCancellationRule(hoursUntilStart);
    const penaltyPercentage = role === CancellationRole.OWNER
      ? rule.ownerPenaltyPercentage
      : rule.coachPenaltyPercentage;
    
    return {
      penaltyAmount,
      penaltyPercentage,
    };
  }

  /**
   * Get comprehensive cancellation information
   * @param booking - Booking entity
   * @param role - Cancellation role
   * @returns Complete cancellation info
   */
  getCancellationInfo(booking: Booking, role: CancellationRole): CancellationInfo {
    const eligibility = this.validateCancellationEligibility(booking, role);
    const hoursUntilStart = this.calculateHoursUntilStart(booking);
    const slotValue = booking.bookingAmount + (booking.platformFee || 0);

    const info: CancellationInfo = {
      eligibility,
      slotValue,
    };

    if (!eligibility.allowed) {
      return info;
    }

    // Calculate refund/penalty based on role
    if (role === CancellationRole.USER) {
      const { refundAmount, refundPercentage } = this.calculateUserRefund(booking);
      info.refundAmount = refundAmount;
      info.refundPercentage = refundPercentage;

      // Generate warning message
      if (refundPercentage === 0) {
        info.warningMessage = 'Bạn sẽ không nhận lại tiền nếu hủy booking này (< 6h trước khi bắt đầu).';
      } else if (refundPercentage === 50) {
        info.warningMessage = `Bạn sẽ nhận lại ${refundPercentage}% (${refundAmount.toLocaleString('vi-VN')} đ) nếu hủy booking này.`;
      } else {
        info.warningMessage = `Bạn sẽ nhận lại ${refundPercentage}% (${refundAmount.toLocaleString('vi-VN')} đ) nếu hủy booking này.`;
      }
    } else if (role === CancellationRole.OWNER || role === CancellationRole.COACH) {
      const { penaltyAmount, penaltyPercentage } = this.calculatePenalty(booking, role);
      info.penaltyAmount = penaltyAmount;
      info.penaltyPercentage = penaltyPercentage;

      // Generate warning message
      if (penaltyPercentage === 0) {
        info.warningMessage = 'Bạn sẽ không bị phạt nếu hủy booking này (> 24h trước khi bắt đầu). Khách hàng sẽ nhận 100% refund.';
      } else if (penaltyPercentage === 100) {
        info.warningMessage = `Bạn sẽ bị phạt ${penaltyPercentage}% (${penaltyAmount.toLocaleString('vi-VN')} đ) nếu hủy booking này (< 6h trước khi bắt đầu). Khách hàng sẽ nhận 100% refund.`;
      } else {
        info.warningMessage = `Bạn sẽ bị phạt ${penaltyPercentage}% (${penaltyAmount.toLocaleString('vi-VN')} đ) nếu hủy booking này. Khách hàng sẽ nhận 100% refund.`;
      }
    }

    return info;
  }
}
