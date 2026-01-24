import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

export interface CheckInTokenPayload {
  bookingId?: string; // Optional - for single bookings
  recurringGroupId?: string; // Optional - for recurring/batch bookings
  fieldId?: string; // Optional - for field QR codes
  timestamp: number;
  bookingDate?: string; // ISO date string for email-based tokens
  type?: 'dynamic' | 'email' | 'field'; // Token type
  iat?: number;
  exp?: number;
}

export interface TimeWindowResult {
  canGenerate: boolean;
  canGenerateAt?: Date;
  windowEndsAt?: Date;
  message?: string;
}

export interface DateValidationResult {
  canCheckIn: boolean;
  message?: string;
}

@Injectable()
export class QrCheckinService {
  private readonly logger = new Logger(QrCheckinService.name);
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
   * Generate a static JWT token for email-based QR check-in
   * This token has long expiry (30 days) but includes booking date for validation
   * @param bookingId - The booking ID
   * @param bookingDate - The booking date (Date object)
   * @returns JWT token string
   */
  async generateStaticCheckInToken(
    bookingId: string,
    bookingDate: Date,
  ): Promise<string> {
    // Convert date to ISO date string (date-only, no time)
    const dateOnly = new Date(bookingDate);
    dateOnly.setHours(0, 0, 0, 0);
    const bookingDateStr = dateOnly.toISOString().split('T')[0];

    const payload: CheckInTokenPayload = {
      bookingId,
      bookingDate: bookingDateStr,
      type: 'email',
      timestamp: Date.now(),
    };

    // Long expiry for email tokens (30 days)
    const token = await this.jwtService.signAsync(payload, {
      expiresIn: '30d',
    });

    return token;
  }

  /**
   * Generate a recurring group QR token for batch bookings
   * This token contains the recurringGroupId instead of individual bookingId
   * Used when user books multiple dates and receives a single QR code
   * @param recurringGroupId - The recurring group ID
   * @param startDate - The first booking date in the group
   * @returns JWT token string
   */
  async generateRecurringGroupToken(
    recurringGroupId: string,
    startDate: Date,
  ): Promise<string> {
    // Convert date to ISO date string (date-only, no time)
    const dateOnly = new Date(startDate);
    dateOnly.setHours(0, 0, 0, 0);
    const startDateStr = dateOnly.toISOString().split('T')[0];

    const payload: CheckInTokenPayload = {
      recurringGroupId, // Use recurringGroupId instead of bookingId
      bookingDate: startDateStr, // Store start date for reference
      type: 'email',
      timestamp: Date.now(),
    };

    // Long expiry for email tokens (30 days)
    const token = await this.jwtService.signAsync(payload, {
      expiresIn: '30d',
    });

    return token;
  }

  /**
   * Generate a long-lived JWT token for field QR code
   * This token is static and can be regenerated if compromised
   * @param fieldId - The field ID
   * @returns JWT token string (valid for 365 days)
   */
  async generateFieldQrToken(fieldId: string): Promise<string> {
    const payload: CheckInTokenPayload = {
      fieldId,
      type: 'field',
      timestamp: Date.now(),
    };

    // Long expiry for field tokens (365 days)
    // Can be regenerated by field owner if needed
    const token = await this.jwtService.signAsync(payload, {
      expiresIn: '365d',
    });

    return token;
  }

  /**
   * Validate a QR check-in token
   * @param token - The JWT token to validate
   * @returns Decoded token payload
   */
  async validateCheckInToken(token: string): Promise<CheckInTokenPayload> {
    // Log JWT secret configuration status (first 4 chars only for security)
    const qrSecret = this.configService.get<string>('QR_CHECKIN_SECRET');
    const jwtSecret = this.configService.get<string>('JWT_SECRET');
    const secretInUse = qrSecret || jwtSecret;
    const secretPreview = secretInUse 
      ? `${secretInUse.substring(0, 4)}...${secretInUse.length} chars` 
      : 'NOT CONFIGURED';
    this.logger.debug(`[Token Validation] JWT Secret: ${secretPreview}, Using: ${qrSecret ? 'QR_CHECKIN_SECRET' : 'JWT_SECRET'}`);

    // Validate token format
    if (!token || typeof token !== 'string') {
      this.logger.error('[Token Validation] Token is empty or not a string');
      throw new HttpException('Mã QR không hợp lệ: Token không tồn tại', HttpStatus.UNAUTHORIZED);
    }

    // Validate JWT format (should have 3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      const tokenPreview = token.length > 20 
        ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}` 
        : token.substring(0, 10);
      this.logger.error(`[Token Validation] Invalid JWT format. Parts: ${tokenParts.length}, Length: ${token.length}, Preview: ${tokenPreview}`);
      throw new HttpException('Mã QR không hợp lệ: Định dạng token không đúng', HttpStatus.UNAUTHORIZED);
    }

    // Log token metadata (first and last 10 chars only for security)
    const tokenPreview = token.length > 20 
      ? `${token.substring(0, 10)}...${token.substring(token.length - 10)}` 
      : token.substring(0, Math.min(20, token.length));
    this.logger.debug(`[Token Validation] Token metadata - Length: ${token.length}, Preview: ${tokenPreview}`);

    try {
      const decoded = await this.jwtService.verifyAsync<CheckInTokenPayload>(token);
      this.logger.debug(`[Token Validation] Token decoded successfully. Type: ${decoded.type}, FieldId: ${decoded.fieldId || 'N/A'}, BookingId: ${decoded.bookingId || 'N/A'}`);

      // If this is a field token, no date/time validation needed
      // Field QR codes can be used anytime
      if (decoded.type === 'field') {
        return decoded;
      }

      // If this is an email-based token, validate the date
      if (decoded.type === 'email' && decoded.bookingDate) {
        const dateValidation = this.canCheckInOnDate(decoded.bookingDate);
        if (!dateValidation.canCheckIn) {
          throw new HttpException(
            dateValidation.message || 'Không thể check-in vào thời điểm này',
            HttpStatus.FORBIDDEN,
          );
        }
      }

      return decoded;
    } catch (error) {
      // Re-throw HttpException as-is
      if (error instanceof HttpException) {
        this.logger.debug(`[Token Validation] HttpException re-thrown: ${error.message}`);
        throw error;
      }

      // Log detailed error information
      const errorName = error?.name || 'UnknownError';
      const errorMessage = error?.message || 'Unknown error';
      const errorStack = error?.stack || 'No stack trace';
      
      this.logger.error(`[Token Validation] JWT verification failed`, {
        errorName,
        errorMessage,
        errorStack: errorStack.substring(0, 500), // Limit stack trace length
        tokenLength: token.length,
        tokenPreview,
        secretConfigured: !!secretInUse,
      });

      // Handle specific JWT error types
      if (errorName === 'TokenExpiredError') {
        this.logger.warn(`[Token Validation] Token expired`);
        throw new HttpException('Mã QR đã hết hạn', HttpStatus.BAD_REQUEST);
      }

      if (errorName === 'JsonWebTokenError') {
        this.logger.warn(`[Token Validation] Invalid JWT: ${errorMessage}`);
        throw new HttpException(`Mã QR không hợp lệ: ${errorMessage}`, HttpStatus.UNAUTHORIZED);
      }

      if (errorName === 'NotBeforeError') {
        this.logger.warn(`[Token Validation] Token not active yet: ${errorMessage}`);
        throw new HttpException('Mã QR chưa có hiệu lực', HttpStatus.BAD_REQUEST);
      }

      // Generic error for other JWT errors
      this.logger.error(`[Token Validation] Unexpected JWT error: ${errorName} - ${errorMessage}`);
      throw new HttpException('Mã QR không hợp lệ', HttpStatus.UNAUTHORIZED);
    }
  }

  /**
   * Check if check-in is allowed based on booking date
   * Same-day only validation (no grace period)
   * @param bookingDateStr - ISO date string from token (YYYY-MM-DD)
   * @param currentDate - Current date (defaults to now, for testing)
   * @returns DateValidationResult
   */
  canCheckInOnDate(
    bookingDateStr: string,
    currentDate: Date = new Date(),
  ): DateValidationResult {
    // Parse booking date and current date to date-only (ignore time)
    const bookingDate = new Date(bookingDateStr);
    bookingDate.setHours(0, 0, 0, 0);

    const today = new Date(currentDate);
    today.setHours(0, 0, 0, 0);

    const bookingTime = bookingDate.getTime();
    const todayTime = today.getTime();

    // Check if today is before booking date
    if (todayTime < bookingTime) {
      const daysUntil = Math.ceil((bookingTime - todayTime) / (24 * 60 * 60 * 1000));
      return {
        canCheckIn: false,
        message: `Chưa đến ngày check-in. Vui lòng check-in vào ngày ${bookingDateStr} (còn ${daysUntil} ngày).`,
      };
    }

    // Check if today is after booking date (no grace period)
    if (todayTime > bookingTime) {
      return {
        canCheckIn: false,
        message: `Đã quá ngày check-in. Mã QR chỉ có hiệu lực vào ngày ${bookingDateStr}.`,
      };
    }

    // Same day - allow check-in
    return {
      canCheckIn: true,
    };
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
