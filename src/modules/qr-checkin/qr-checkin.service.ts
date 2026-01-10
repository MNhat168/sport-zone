import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface CheckInTokenPayload {
  bookingId: string;
  timestamp: number;
  iat?: number;
  exp?: number;
}

export interface TimeWindowResult {
  canGenerate: boolean;
  canGenerateAt?: Date;
  windowEndsAt?: Date;
  message?: string;
}

@Injectable()
export class QrCheckinService {
  private readonly qrCheckinWindowMinutes: number;
  private readonly qrTokenExpiryMinutes: number;
  private readonly qrCheckinLateWindowMinutes: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.qrCheckinWindowMinutes = parseInt(
      this.configService.get('QR_CHECKIN_WINDOW_MINUTES', '15'),
      10,
    );
    this.qrTokenExpiryMinutes = parseInt(
      this.configService.get('QR_TOKEN_EXPIRY_MINUTES', '10'),
      10,
    );
    // Allow late check-in up to 60 minutes (or booking duration if we knew it)
    // This allows users to check in even if they arrive late
    this.qrCheckinLateWindowMinutes = parseInt(
      this.configService.get('QR_CHECKIN_LATE_WINDOW_MINUTES', '60'),
      10,
    );
  }

  /**
   * Generate a signed JWT token for QR check-in
   * @param bookingId - The booking ID
   * @param startTime - The booking start time
   * @returns JWT token string
   */
  async generateCheckInToken(
    bookingId: string,
    startTime: Date,
  ): Promise<{ token: string; expiresAt: Date }> {
    const timeWindow = this.canGenerateQR(startTime);

    if (!timeWindow.canGenerate) {
      throw new HttpException(
        {
          message: timeWindow.message || 'Chưa đến giờ nhận sân',
          canGenerateAt: timeWindow.canGenerateAt,
          windowEndsAt: timeWindow.windowEndsAt,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    const payload: CheckInTokenPayload = {
      bookingId,
      timestamp: Date.now(),
    };

    const token = await this.jwtService.signAsync(payload, {
      expiresIn: `${this.qrTokenExpiryMinutes}m`,
    });

    const expiresAt = new Date(Date.now() + this.qrTokenExpiryMinutes * 60 * 1000);

    return {
      token,
      expiresAt,
    };
  }

  /**
   * Validate a QR check-in token
   * @param token - The JWT token to validate
   * @returns Decoded token payload
   */
  async validateCheckInToken(token: string): Promise<CheckInTokenPayload> {
    try {
      const decoded = await this.jwtService.verifyAsync<CheckInTokenPayload>(token);
      return decoded;
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new HttpException('Mã QR đã hết hạn', HttpStatus.BAD_REQUEST);
      }
      throw new HttpException('Mã QR không hợp lệ', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Check if current time is within the allowed window to generate QR
   * @param startTime - The booking start time
   * @returns TimeWindowResult with canGenerate status and related times
   */
  canGenerateQR(startTime: Date): TimeWindowResult {
  const now = new Date();
  const startTimeDate = new Date(startTime);

  // Calculate the window start time (e.g., 15 minutes before start)
  const windowStartTime = new Date(
    startTimeDate.getTime() - this.qrCheckinWindowMinutes * 60 * 1000,
  );

  // Calculate late window end time (e.g., 60 minutes after start)
  const lateWindowEndTime = new Date(
    startTimeDate.getTime() + this.qrCheckinLateWindowMinutes * 60 * 1000,
  );

  // Too early - before the window opens
  if (now < windowStartTime) {
    const minutesUntilWindow = Math.ceil(
      (windowStartTime.getTime() - now.getTime()) / (60 * 1000),
    );
    return {
      canGenerate: false,
      canGenerateAt: windowStartTime,
      windowEndsAt: lateWindowEndTime,
      message: `Chưa đến giờ nhận sân. Vui lòng đợi thêm ${minutesUntilWindow} phút.`,
    };
  }

  // Too late - after the late window closed
  if (now > lateWindowEndTime) {
    return {
      canGenerate: false,
      message: 'Đã quá thời gian check-in cho trận đấu này',
    };
  }

    // Within the allowed window (Start window -> Start Time -> Late window)
    return {
      canGenerate: true,
      canGenerateAt: windowStartTime,
      windowEndsAt: lateWindowEndTime,
    };
  }

  /**
   * Get the check-in time window information for a booking
   * @param startTime - The booking start time
   * @returns Object with window start and end times
   */
  getCheckInWindow(startTime: Date): {
  windowStartsAt: Date;
  windowEndsAt: Date;
  windowDurationMinutes: number;
} {
    const startTimeDate = new Date(startTime);
    const windowStartsAt = new Date(
      startTimeDate.getTime() - this.qrCheckinWindowMinutes * 60 * 1000,
    );

    return {
      windowStartsAt,
      windowEndsAt: startTimeDate,
      windowDurationMinutes: this.qrCheckinWindowMinutes,
    };
  }

  /**
   * Calculate time remaining until QR can be generated
   * @param startTime - The booking start time
   * @returns Milliseconds until window opens, or 0 if already open
   */
  getTimeUntilWindow(startTime: Date): number {
    const now = new Date();
    const windowInfo = this.getCheckInWindow(startTime);

    if (now >= windowInfo.windowStartsAt) {
      return 0;
    }

    return windowInfo.windowStartsAt.getTime() - now.getTime();
  }
}
