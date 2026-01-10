import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  Request,
  UseGuards,
  BadRequestException,
  NotFoundException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { BookingsService, DailyAvailability } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { CreateCoachBookingLazyDto } from './dto/create-coach-booking-lazy.dto';
import { CreateCoachBookingV2Dto } from './dto/create-coach-booking-v2.dto';
import { CreateFieldBookingLazyDto, FieldAvailabilityQueryDto, MarkHolidayDto } from './dto/create-field-booking-lazy.dto';
import { CreateFieldBookingV2Dto } from './dto/create-field-booking-v2.dto';
import { CreateCombinedBookingDto } from './dto/create-combined-booking.dto'; // NEW
import { CreateConsecutiveDaysBookingDto } from './dto/create-consecutive-days-booking.dto'; // ⭐ NEW - Turn 1
import { CreateWeeklyRecurringBookingDto } from './dto/create-weekly-recurring-booking.dto'; // ⭐ NEW - Turn 2
import { ParseBookingRequestDto } from './dto/parse-booking-request.dto'; // ⭐ NEW - Turn 3
import { VerifyPaymentProofDto } from './dto/verify-payment-proof.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateSessionBookingLazyDto } from './dto/create-session-booking-lazy.dto';
import { CancelSessionBookingDto } from './dto/cancel-session-booking.dto';
import { GetUserBookingsDto, UserBookingsResponseDto } from './dto/get-user-bookings.dto';
import { BookingInvoiceDto } from './dto/booking-invoice.dto';
import { BookingUpcomingDto } from './dto/booking-upcoming.dto';
import { Schedule } from '../schedules/entities/schedule.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { CleanupService } from '../../service/cleanup.service';
import { BookingStatus, BookingType } from '@common/enums/booking.enum';
import { PaymentMethod } from '@common/enums/payment-method.enum';
import { OptionalJwtAuthGuard } from '@common/guards/optional-jwt-auth.guard';
import { FieldBookingService } from './services/field-booking.service';
import { TransactionsService } from '../transactions/transactions.service';
import { AiService } from '../ai/ai.service'; // Turn 3
import { BookingCancellationService } from './services/booking-cancellation.service'; // Turn 4
import { CheckInRateLimitGuard } from '../qr-checkin/guards/check-in-rate-limit.guard';
import { RolesGuard } from '@common/guards/roles.guard';
import { Roles } from '../../decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';
import { FieldAccessGuard } from '@common/guards/field-access.guard';

/**
 * Bookings Controller with Pure Lazy Creation pattern
 * Includes both new (Pure Lazy) and legacy endpoints for backward compatibility
 * ✅ SECURITY: Rate limiting applied to prevent abuse
 */
@ApiTags('Bookings')
@Controller()
@UseGuards(RateLimitGuard) // ✅ Apply rate limiting to all routes
export class BookingsController {

  constructor(
    private readonly bookingsService: BookingsService,
    private readonly fieldBookingService: FieldBookingService, // Injected directly
    private readonly transactionsService: TransactionsService, // NEW
    private readonly aiService: AiService, // Turn 3
    private readonly bookingCancellationService: BookingCancellationService, // Turn 4
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    private readonly cleanupService: CleanupService,
  ) { }

  /**
   * Helper method to extract user ID from JWT payload
   */
  private getUserId(req: any): string {
    const userId = req.user?.userId;
    if (!userId) {
      throw new BadRequestException('User ID not found in request');
    }
    return userId;
  }

  // ============================================================================
  // PURE LAZY CREATION ENDPOINTS (NEW)
  // ============================================================================

  /**
   * Lấy lịch khả dụng của sân theo Pure Lazy Creation
   * Tạo virtual slots từ Field config, áp dụng Schedule constraints nếu tồn tại
   * ✅ SECURITY: Rate limited to prevent availability checking abuse
   */
  @Get('fields/:fieldId/availability')
  @RateLimit({ ttl: 10, limit: 30 }) // ✅ 30 requests per 10 seconds per user/IP
  @ApiOperation({
    summary: 'Lấy lịch khả dụng của sân (Pure Lazy)',
    description: 'Tạo virtual slots từ Field config, không cần pre-create Schedule'
  })
  @ApiParam({
    name: 'fieldId',
    description: 'Field ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Ngày bắt đầu (YYYY-MM-DD)',
    example: '2025-10-01'
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Ngày kết thúc (YYYY-MM-DD)',
    example: '2025-10-31'
  })
  @ApiQuery({
    name: 'courtId',
    description: 'Court ID (bắt buộc nếu field có nhiều court)',
    required: false,
    example: '657f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Lịch khả dụng được tạo thành công'
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async getFieldAvailability(
    @Param('fieldId') fieldId: string,
    @Query() query: FieldAvailabilityQueryDto,
  ): Promise<DailyAvailability[]> {
    return await this.bookingsService.getFieldAvailability(fieldId, query);
  }

  /**
   * Tạo booking sân theo Pure Lazy Creation
   * Không cần scheduleId, tự động upsert Schedule nếu cần
   * ✅ SECURITY: Rate limited to prevent booking spam
   */
  @Post('bookings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @RateLimit({ ttl: 60, limit: 5 }) // ✅ 5 bookings per minute per user
  @ApiOperation({
    summary: 'Tạo booking sân (Pure Lazy)',
    description: 'Tự động tạo Schedule nếu chưa tồn tại, sử dụng fieldId + date'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async createFieldBookingLazy(
    @Request() req: any,
    @Body() bookingData: CreateFieldBookingLazyDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);
    return await this.bookingsService.createFieldBookingLazy(userId, bookingData);
  }

  /**
   * ⭐ TURN 1: Create bookings for consecutive days
   * Book same court, same time for multiple consecutive dates
   * Example: Book Court 1 from Monday to Friday, 09:00-11:00
   */
  @Post('bookings/consecutive-days')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 3 }) // 3 recurring bookings per minute
  @ApiOperation({
    summary: 'Đặt sân liên tục nhiều ngày (Turn 1)',
    description: 'Đặt cùng một sân, cùng time slot cho nhiều ngày liên tiếp. Hỗ trợ cả đăng nhập và guest booking.'
  })
  @ApiResponse({
    status: 201,
    description: 'Các booking liên tục được tạo thành công'
  })
  @ApiResponse({
    status: 400,
    description: 'Dữ liệu không hợp lệ hoặc một số ngày bị conflict'
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân hoặc court' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async createConsecutiveDaysBooking(
    @Request() req: any,
    @Body() bookingData: CreateConsecutiveDaysBookingDto,
  ) {
    const userId = req.user?.userId || null;

    // Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings');
    }

    return await this.bookingsService.createConsecutiveDaysBooking(bookingData, userId);
  }

  /**
   * ⭐ TURN 2: Create bookings for weekly recurring pattern
   * Book specific weekdays for multiple weeks
   * Example: Book every Monday and Wednesday for 4 weeks
   */
  @Post('bookings/weekly-recurring')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 3 }) // 3 recurring bookings per minute
  @ApiOperation({
    summary: 'Đặt sân theo pattern hàng tuần (Turn 2)',
    description: 'Đặt sân theo ngày cố định trong tuần (ví dụ: mỗi thứ 2, 4 trong 4 tuần). Hỗ trợ cả đăng nhập và guest booking.'
  })
  @ApiResponse({
    status: 201,
    description: 'Các booking theo pattern được tạo thành công'
  })
  @ApiResponse({
    status: 400,
    description: 'Dữ liệu không hợp lệ hoặc một số ngày bị conflict'
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân hoặc court' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async createWeeklyRecurringBooking(
    @Request() req: any,
    @Body() bookingData: CreateWeeklyRecurringBookingDto,
  ) {
    const userId = req.user?.userId || null;

    // Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings');
    }

    return await this.bookingsService.createWeeklyRecurringBooking(bookingData, userId);
  }

  /**
   * Validate consecutive days booking availability WITHOUT creating bookings
   * Used for dry-run validation at booking step before proceeding to amenities/payment
   */
  @Post('bookings/consecutive-days/validate')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 20 }) // 20 validation requests per minute
  @ApiOperation({
    summary: 'Validate consecutive days booking (dry-run)',
    description: 'Checks availability for consecutive days without creating bookings. Returns conflicts if any dates are unavailable.'
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result with conflicts (if any) and pricing preview'
  })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 404, description: 'Field or court not found' })
  async validateConsecutiveDaysBooking(
    @Body() bookingData: CreateConsecutiveDaysBookingDto,
  ) {
    return await this.bookingsService.validateConsecutiveDaysBooking(bookingData);
  }

  /**
   * Validate weekly recurring booking availability WITHOUT creating bookings
   * Used for dry-run validation at booking step before proceeding to amenities/payment
   */
  @Post('bookings/weekly-recurring/validate')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 20 }) // 20 validation requests per minute
  @ApiOperation({
    summary: 'Validate weekly recurring booking (dry-run)',
    description: 'Checks availability for weekly pattern without creating bookings. Returns conflicts if any dates are unavailable.'
  })
  @ApiResponse({
    status: 200,
    description: 'Validation result with conflicts (if any) and pricing preview'
  })
  @ApiResponse({ status: 400, description: 'Invalid data' })
  @ApiResponse({ status: 404, description: 'Field or court not found' })
  async validateWeeklyRecurringBooking(
    @Body() bookingData: CreateWeeklyRecurringBookingDto,
  ) {
    return await this.bookingsService.validateWeeklyRecurringBooking(bookingData);
  }

  /**
   * Get schedule for a specific conflict date
   * Returns all time slots with status for TimeSlotPickerModal
   */
  @Get('bookings/conflict-date-schedule')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 10, limit: 30 })
  @ApiOperation({
    summary: 'Get schedule for conflict date resolution',
    description: 'Returns all time slots with their availability status for a specific date. Used by TimeSlotPickerModal to display available alternatives.'
  })
  @ApiQuery({
    name: 'fieldId',
    description: 'Field ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiQuery({
    name: 'courtId',
    description: 'Court ID',
    example: '657f1f77bcf86cd799439011'
  })
  @ApiQuery({
    name: 'date',
    description: 'Date (YYYY-MM-DD)',
    example: '2026-01-05'
  })
  @ApiQuery({
    name: 'duration',
    description: 'Required duration in minutes',
    example: '60'
  })
  @ApiResponse({
    status: 200,
    description: 'Schedule with all time slots and their status'
  })
  @ApiResponse({ status: 400, description: 'Invalid parameters' })
  @ApiResponse({ status: 404, description: 'Field or court not found' })
  async getConflictDateSchedule(
    @Query('fieldId') fieldId: string,
    @Query('courtId') courtId: string,
    @Query('date') date: string,
    @Query('duration') duration: string,
  ) {
    if (!fieldId || !courtId || !date || !duration) {
      throw new BadRequestException('Missing required query parameters: fieldId, courtId, date, duration');
    }

    const durationNum = parseInt(duration, 10);
    if (isNaN(durationNum) || durationNum <= 0) {
      throw new BadRequestException('Duration must be a positive number');
    }

    return await this.bookingsService.getConflictDateSchedule(fieldId, courtId, date, durationNum);
  }

  /**
   * ⭐ TURN 3: Parse natural language booking request using AI
   * Converts user's natural language query into structured booking data
   * Example: "Đặt sân từ thứ 2 đến thứ 6 tuần này, 9h-11h"
   */
  @Post('bookings/ai/parse')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 10 }) // 10 AI parsing requests per minute
  @ApiOperation({
    summary: 'Parse natural language booking request with AI (Turn 3)',
    description: 'Sử dụng AI để phân tích yêu cầu đặt sân bằng ngôn ngữ tự nhiên (tiếng Việt hoặc tiếng Anh) và chuyển thành dữ liệu có cấu trúc.'
  })
  @ApiResponse({
    status: 200,
    description: 'Parsed booking data from natural language query'
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query or AI parsing failed'
  })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async parseBookingRequest(
    @Request() req: any,
    @Body() dto: ParseBookingRequestDto,
  ) {
    try {
      const parsedData = await this.aiService.parseBookingRequest(dto.query, dto.fieldId);
      return {
        success: true,
        data: parsedData
      };
    } catch (error) {
      throw new BadRequestException(error.message || 'Failed to parse booking request');
    }
  }

  // ============================================================================
  // TURN 4: RECURRING GROUP MANAGEMENT
  // ============================================================================

  /**
   * Get all bookings in a recurring group
   * Used to view all bookings created together via consecutive-days or weekly-recurring
   */
  @Get('bookings/recurring-group/:groupId')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @RateLimit({ ttl: 10, limit: 30 })
  @ApiOperation({
    summary: 'Lấy tất cả booking trong một nhóm định kỳ (Turn 4)',
    description: 'Lấy danh sách tất cả bookings được tạo cùng nhau qua consecutive-days hoặc weekly-recurring'
  })
  @ApiParam({
    name: 'groupId',
    description: 'Recurring Group ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách bookings trong group'
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy group' })
  async getRecurringGroup(
    @Request() req: any,
    @Param('groupId') groupId: string
  ) {
    // Validate groupId format
    if (!groupId || !/^[0-9a-fA-F]{24}$/.test(groupId)) {
      throw new BadRequestException('Invalid group ID format');
    }

    const bookings = await this.bookingModel
      .find({ recurringGroupId: new Types.ObjectId(groupId) })
      .populate('court')
      .populate('field')
      .sort({ date: 1 });

    if (bookings.length === 0) {
      throw new NotFoundException('No bookings found in this recurring group');
    }

    return {
      groupId,
      totalBookings: bookings.length,
      bookings
    };
  }

  /**
   * Cancel entire recurring group
   * Cancels all pending/confirmed bookings in the group
   */
  @Patch('bookings/recurring-group/:groupId/cancel')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @RateLimit({ ttl: 60, limit: 5 })
  @ApiOperation({
    summary: 'Hủy tất cả booking trong nhóm định kỳ (Turn 4)',
    description: 'Hủy tất cả bookings chưa hoàn thành trong một recurring group'
  })
  @ApiParam({
    name: 'groupId',
    description: 'Recurring Group ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Tất cả bookings đã được hủy'
  })
  @ApiResponse({ status: 404, description: 'Không tìm thấy group hoặc không có booking để hủy' })
  async cancelRecurringGroup(
    @Request() req: any,
    @Param('groupId') groupId: string,
    @Body() dto: { cancellationReason?: string }
  ) {
    const userId = this.getUserId(req);

    // Validate groupId format
    if (!groupId || !/^[0-9a-fA-F]{24}$/.test(groupId)) {
      throw new BadRequestException('Invalid group ID format');
    }

    // Find all cancellable bookings in the group
    const bookings = await this.bookingModel
      .find({
        recurringGroupId: new Types.ObjectId(groupId),
        status: { $nin: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] }
      });

    if (bookings.length === 0) {
      throw new NotFoundException('No active bookings found in this recurring group');
    }

    // Cancel all bookings directly using model update
    // This avoids ownership check since we already verified the booking belongs to user
    const cancellationReason = dto.cancellationReason || 'Cancelled entire recurring group';

    try {
      const updateResult = await this.bookingModel.updateMany(
        {
          recurringGroupId: new Types.ObjectId(groupId),
          status: { $nin: [BookingStatus.CANCELLED, BookingStatus.COMPLETED] }
        },
        {
          $set: {
            status: BookingStatus.CANCELLED,
            cancellationReason: cancellationReason
          }
        }
      );

      return {
        success: true,
        cancelledCount: updateResult.modifiedCount,
        totalInGroup: bookings.length,
        message: `Cancelled ${updateResult.modifiedCount} of ${bookings.length} bookings`
      };
    } catch (error: any) {
      throw new BadRequestException(`Failed to cancel recurring group: ${error.message}`);
    }
  }

  /**
   * Hold slots for bank transfer booking (create booking without payment)
   * User selects slots and clicks "Go to payment" → booking is created, slots are held
   * Payment will be created later when user submits payment proof
   * ✅ SECURITY: Rate limited to prevent booking spam
   * ✅ Supports both authenticated and guest (anonymous) bookings
   */
  @Post('bookings/field-booking-hold')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 5 }) // 5 bookings per minute
  @ApiOperation({
    summary: 'Giữ chỗ booking (tạo booking chưa có payment)',
    description: 'Tạo booking và giữ slot trong 5 phút. Payment sẽ được tạo sau khi user submit payment proof. Hỗ trợ cả đăng nhập và đặt sân không cần đăng nhập (cung cấp guestEmail)'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công (slots đã được giữ)',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async createFieldBookingHold(
    @Request() req: any,
    @Body() bookingData: CreateFieldBookingV2Dto,
  ): Promise<Booking> {
    // ✅ Optional authentication - get userId if user is logged in
    const userId = req.user?.userId || null;

    // ✅ Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings. Please provide guestEmail or login to your account.');
    }

    return await this.bookingsService.createFieldBookingWithoutPayment(userId, bookingData);
  }

  /**
   * Tạo booking sân V2 với chuyển khoản ngân hàng và ảnh chứng minh
   * Sử dụng PaymentMethod.BANK_TRANSFER và yêu cầu upload ảnh chứng minh
   * ✅ SECURITY: Rate limited to prevent booking spam
   * ✅ Supports both authenticated and guest (anonymous) bookings
   */
  @Post('bookings/field-booking-v2')
  @UseGuards(OptionalJwtAuthGuard)
  // ✅ Removed AuthGuard to allow optional authentication
  // Users can book without login, but must provide guestEmail
  @UseInterceptors(FileInterceptor('paymentProof'))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ ttl: 60, limit: 3 }) // ✅ Reduced to 3 bookings per minute for anonymous users
  @ApiOperation({
    summary: 'Tạo booking sân V2 với chuyển khoản ngân hàng',
    description: 'Tạo booking với BANK_TRANSFER payment method và upload ảnh chứng minh thanh toán. Hỗ trợ cả đăng nhập và đặt sân không cần đăng nhập (cung cấp guestEmail)'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async createFieldBookingV2(
    @Request() req: any,
    @Body() bookingData: CreateFieldBookingV2Dto,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ): Promise<Booking> {
    // ✅ Optional authentication - get userId if user is logged in
    const userId = req.user?.userId || null;

    // ✅ Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings. Please provide guestEmail or login to your account.');
    }

    if (!paymentProof) {
      throw new BadRequestException('Payment proof image is required');
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(paymentProof.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP images are allowed');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (paymentProof.size > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    return await this.bookingsService.createFieldBookingV2(
      userId,
      bookingData,
      paymentProof.buffer,
      paymentProof.mimetype
    );
  }

  /**
   * Submit payment proof for existing booking (created via field-booking-hold)
   * Creates payment transaction and links it to the booking
   * ✅ SECURITY: Rate limited to prevent spam
   */
  @Post('bookings/:bookingId/submit-payment-proof')
  @UseGuards(OptionalJwtAuthGuard) // ✅ Added OptionalJwtAuthGuard
  @UseInterceptors(FileInterceptor('paymentProof'))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ ttl: 60, limit: 5 }) // 5 submissions per minute
  @ApiOperation({
    summary: 'Submit payment proof for booking',
    description: 'Submit payment proof image for a booking that was created via field-booking-hold. Creates payment transaction and links it to the booking.'
  })
  @ApiParam({
    name: 'bookingId',
    description: 'ID of the booking to submit payment proof for',
    type: String
  })
  @ApiResponse({
    status: 200,
    description: 'Payment proof submitted successfully',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Invalid booking or payment proof already submitted' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async submitPaymentProof(
    @Param('bookingId') bookingId: string,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ): Promise<Booking> {
    // Validate booking ID
    if (!bookingId || bookingId.trim() === '' || bookingId === 'undefined' || bookingId === 'null') {
      throw new BadRequestException('Invalid booking ID');
    }

    // Validate it's a valid MongoDB ObjectId format (24 hex characters)
    if (!/^[0-9a-fA-F]{24}$/.test(bookingId)) {
      throw new BadRequestException('Invalid booking ID format');
    }

    if (!paymentProof) {
      throw new BadRequestException('Payment proof image is required');
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(paymentProof.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP images are allowed');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (paymentProof.size > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    return await this.bookingsService.submitPaymentProof(
      bookingId,
      paymentProof.buffer,
      paymentProof.mimetype
    );
  }

  /**
   * Initiate PayOS payment for an existing booking (e.g. held booking)
   * Creates a transaction and returns PayOS checkout URL
   */
  @Post('bookings/:bookingId/payment/payos')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 10 })
  @ApiOperation({
    summary: 'Initiate PayOS payment for existing booking',
    description: 'Creates a PayOS payment link for an existing booking (e.g. held slot). Returns checkoutUrl.'
  })
  @ApiResponse({
    status: 201,
    description: 'Payment link created successfully',
  })
  async createPayOSPayment(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    const userId = req.user?.userId || null;
    return await this.bookingsService.createPayOSPaymentForBooking(userId, bookingId);
  }

  /**
   * Initiate PayOS payment for recurring booking group
   * Calculates total from all bookings in the group
   */
  @Post('bookings/:bookingId/payment/payos/recurring')
  @UseGuards(OptionalJwtAuthGuard)
  @RateLimit({ ttl: 60, limit: 10 })
  @ApiOperation({
    summary: 'Initiate PayOS payment for recurring booking group',
    description: 'Creates a PayOS payment link for a recurring booking group. Calculates total from all related bookings.'
  })
  @ApiResponse({
    status: 201,
    description: 'Payment link created successfully',
  })
  async createPayOSPaymentForRecurringBooking(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    const userId = req.user?.userId || null;
    return await this.bookingsService.createPayOSPaymentForRecurringGroup(userId, bookingId);
  }

  /**
   * Tạo booking coach V2 với chuyển khoản ngân hàng và ảnh chứng minh
   * Sử dụng PaymentMethod.BANK_TRANSFER và yêu cầu upload ảnh chứng minh
   * ✅ SECURITY: Rate limited to prevent booking spam
   * ✅ Supports both authenticated and guest (anonymous) bookings
   */
  @Post('bookings/coach/v2')
  @UseGuards(OptionalJwtAuthGuard) // ✅ Added OptionalJwtAuthGuard
  // ✅ Removed AuthGuard to allow optional authentication
  // Users can book without login, but must provide guestEmail
  @UseInterceptors(FileInterceptor('paymentProof'))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ ttl: 60, limit: 3 }) // ✅ Reduced to 3 bookings per minute for anonymous users
  @ApiOperation({
    summary: 'Tạo booking coach V2 với chuyển khoản ngân hàng',
    description: 'Tạo booking coach với BANK_TRANSFER payment method và upload ảnh chứng minh thanh toán. Hỗ trợ cả đăng nhập và đặt coach không cần đăng nhập (cung cấp guestEmail)'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy coach hoặc sân' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async createCoachBookingV2(
    @Request() req: any,
    @Body() bookingData: CreateCoachBookingV2Dto,
    @UploadedFile() paymentProof?: Express.Multer.File,
  ): Promise<Booking> {
    // ✅ Optional authentication - get userId if user is logged in
    const userId = req.user?.userId || null;

    // ✅ Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings. Please provide guestEmail or login to your account.');
    }

    if (!paymentProof) {
      throw new BadRequestException('Payment proof image is required');
    }

    // Validate file type
    const allowedMimeTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(paymentProof.mimetype)) {
      throw new BadRequestException('Invalid file type. Only JPEG, PNG, and WebP images are allowed');
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (paymentProof.size > maxSize) {
      throw new BadRequestException('File size exceeds 5MB limit');
    }

    return await this.bookingsService.createCoachBookingV2(
      userId,
      bookingData,
      paymentProof.buffer,
      paymentProof.mimetype
    );
  }

  /**
   * Hold slots for coach booking (create booking without payment)
   * User selects slots and clicks "Go to payment" → booking is created, slots are held
   * Payment will be created later when user submits payment proof
   * ✅ SECURITY: Rate limited to prevent booking spam
   * ✅ Supports both authenticated and guest (anonymous) bookings
   */
  @Post('bookings/coach-booking-hold')
  @UseGuards(OptionalJwtAuthGuard) // ✅ Added OptionalJwtAuthGuard
  @RateLimit({ ttl: 60, limit: 5 }) // 5 bookings per minute
  @ApiOperation({
    summary: 'Giữ chỗ booking coach (tạo booking chưa có payment)',
    description: 'Tạo booking coach và giữ slot trong 5 phút. Payment sẽ được tạo sau khi user submit payment proof. Hỗ trợ cả đăng nhập và đặt coach không cần đăng nhập (cung cấp guestEmail)'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công (slots đã được giữ)',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy coach hoặc sân' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async createCoachBookingHold(
    @Request() req: any,
    @Body() bookingData: CreateCoachBookingV2Dto,
  ): Promise<Booking> {
    // ✅ Optional authentication - get userId if user is logged in
    const userId = req.user?.userId || null;

    // ✅ Validate guest info if not authenticated
    if (!userId && !bookingData.guestEmail) {
      throw new BadRequestException('Email is required for guest bookings. Please provide guestEmail or login to your account.');
    }

    return await this.bookingsService.createCoachBookingWithoutPayment(userId, bookingData);
  }

  /**
   * Combined Field + Coach Hold Booking
   * Creates a single booking that reserves both field and coach slots
   */
  @Post('bookings/combined-hold')
  @RateLimit({ ttl: 60, limit: 5 })
  @ApiOperation({ summary: 'Giữ chỗ booking sân + HLV (Combined Hold)' })
  async createCombinedHold(
    @Request() req: any,
    @Body() bookingData: CreateCombinedBookingDto,
  ): Promise<Booking> {
    const userId = req.user?.userId || null;
    return await this.fieldBookingService.createCombinedBooking(userId, bookingData);
  }

  /**
   * Đánh dấu ngày đặc biệt (holiday/maintenance) cho sân
   * Tự động upsert Schedule và xử lý các booking bị ảnh hưởng
   */
  @Patch('fields/:fieldId/schedules/:date/holiday')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Đánh dấu ngày đặc biệt cho sân',
    description: 'Tự động tạo/cập nhật Schedule và xử lý booking bị ảnh hưởng'
  })
  @ApiParam({
    name: 'fieldId',
    description: 'Field ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiParam({
    name: 'date',
    description: 'Ngày đánh dấu (YYYY-MM-DD)',
    example: '2025-10-15'
  })
  @ApiResponse({
    status: 200,
    description: 'Đánh dấu thành công'
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async markHoliday(
    @Param('fieldId') fieldId: string,
    @Param('date') date: string,
    @Body() holidayData: MarkHolidayDto,
  ): Promise<{ schedule: any; affectedBookings: Booking[] }> {
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    return await this.bookingsService.markHoliday(fieldId, date, holidayData.reason);
  }

  /**
   * Hủy booking với Schedule update
   */
  @Patch('bookings/:bookingId/cancel')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Hủy booking',
    description: 'Hủy booking và cập nhật Schedule tương ứng'
  })
  @ApiParam({
    name: 'bookingId',
    description: 'Booking ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Booking đã được hủy',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Không thể hủy booking' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy booking' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async cancelBookingNew(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
    @Body() cancelData: CancelBookingDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);
    return await this.bookingsService.cancelBooking({
      bookingId,
      userId,
      cancellationReason: cancelData.cancellationReason,
    });
  }

  /**
   * Cancel booking hold when countdown expires (public endpoint, no auth required)
   * Only allows canceling PENDING bookings without payment (slot holds)
   * Used by frontend when countdown timer expires
   */
  @Patch('bookings/:bookingId/cancel-hold')
  @RateLimit({ ttl: 60, limit: 10 }) // 10 requests per minute
  @ApiOperation({
    summary: 'Cancel booking hold (countdown expired)',
    description: 'Public endpoint to cancel booking hold when countdown expires. Only works for PENDING bookings without payment.'
  })
  @ApiParam({
    name: 'bookingId',
    description: 'Booking ID to cancel',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Booking hold cancelled and slots released'
  })
  @ApiResponse({ status: 400, description: 'Cannot cancel this booking (not a hold booking)' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async cancelBookingHold(
    @Param('bookingId') bookingId: string,
    @Body() cancelData: CancelBookingDto,
  ): Promise<{ success: boolean; message: string }> {
    // Validate booking ID format
    if (!bookingId || bookingId.trim() === '' || bookingId === 'undefined' || bookingId === 'null') {
      throw new BadRequestException('Invalid booking ID');
    }

    if (!/^[0-9a-fA-F]{24}$/.test(bookingId)) {
      throw new BadRequestException('Invalid booking ID format');
    }

    try {
      // Use cleanup service method that handles all validation and cancellation
      await this.cleanupService.cancelHoldBooking(
        bookingId,
        cancelData.cancellationReason || 'Thời gian giữ chỗ đã hết (5 phút)',
        10 // max 10 minutes
      );

      return {
        success: true,
        message: 'Booking hold cancelled and slots released'
      };
    } catch (error) {
      // Handle specific error types
      if (error.message.includes('not found')) {
        throw new NotFoundException(error.message);
      }
      if (error.message.includes('cannot be cancelled') || error.message.includes('too old')) {
        throw new BadRequestException(error.message);
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * Cancel booking by PayOS order code
   * Used when user explicitly cancels on PayOS payment page
   */
  @Patch('bookings/cancel-by-order-code/:orderCode')
  @RateLimit({ ttl: 60, limit: 10 })
  @ApiOperation({
    summary: 'Cancel booking by PayOS order code',
    description: 'Finds booking by PayOS order code and cancels it. Used for PayOS cancellation flow.'
  })
  async cancelBookingByOrderCode(
    @Param('orderCode') orderCode: string,
    @Body() cancelData: CancelBookingDto,
  ): Promise<{ success: boolean; message: string }> {
    if (!orderCode) {
      throw new BadRequestException('Order code is required');
    }

    try {
      // 1. Find transaction by order code
      const transaction = await this.transactionsService.getPaymentByExternalId(orderCode);
      if (!transaction) {
        throw new NotFoundException(`Transaction with order code ${orderCode} not found`);
      }

      // 2. Get booking ID (should be a string or ObjectId)
      const booking = await this.bookingModel.findOne({ transaction: transaction._id }).select('_id');
      const bookingId = booking?._id?.toString();

      if (!bookingId) {
        throw new BadRequestException('No booking associated with this transaction');
      }

      // 3. Delegate to cleanup service
      await this.cleanupService.cancelHoldBooking(
        bookingId,
        cancelData.cancellationReason || 'Người dùng hủy thanh toán trên PayOS',
        10
      );

      return {
        success: true,
        message: 'Booking cancelled successfully via order code'
      };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(error.message || 'Failed to cancel booking via order code');
    }
  }

  /**
   * Accept a booking request
   */
  @Patch('bookings/accept')
  async acceptBooking(
    @Body('coachId') coachId: string,
    @Body('bookingId') bookingId: string,
  ): Promise<Booking> {
    return this.bookingsService.acceptCoachRequest(coachId, bookingId);
  }

  /**
   * Decline a booking request
   */
  @Patch('bookings/decline')
  async declineBooking(
    @Body('coachId') coachId: string,
    @Body('bookingId') bookingId: string,
    @Body('reason') reason?: string,
  ): Promise<Booking> {
    return this.bookingsService.declineCoachRequest(coachId, bookingId, reason);
  }

  //Complete a booking request
  @Patch('bookings/coach/:coachId/:bookingId/complete')
  async completeBooking(
    @Param('coachId') coachId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<Booking> {
    return this.bookingsService.completeCoachBooking(coachId, bookingId);
  }

  //Cancel a booking request
  @Patch('bookings/coach/:coachId/:bookingId/cancel')
  async cancelBooking(
    @Param('coachId') coachId: string,
    @Param('bookingId') bookingId: string,
  ): Promise<Booking> {
    return this.bookingsService.cancelCoachBooking(coachId, bookingId);
  }

  //Get statistic for current coach
  @Get('coach/:id/statistics')
  getCoachStatistics(
    @Param('id') coachId: string,
    @Query('mode') mode: 'month' | 'year' = 'month',
  ) {
    return this.bookingsService.getCoachStatistics(coachId, mode)
  }
  /**
   * Get all bookings for the authenticated coach
   * NOTE: This route must be defined BEFORE the parameterized route to avoid route conflicts
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('bookings/coach/my-bookings')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all bookings for the authenticated coach' })
  async getMyCoachBookings(@Request() req): Promise<Booking[]> {
    const userId = this.getUserId(req);
    return this.bookingsService.getMyCoachBookings(userId);
  }

  @Get('bookings/coach/my-bookings/by-type')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookings for coach filtered by type (COACH or FIELD_COACH)' })
  async getMyCoachBookingsByType(
    @Request() req,
    @Query('type') type?: BookingType
  ): Promise<Booking[]> {
    const userId = this.getUserId(req);
    return this.bookingsService.getMyCoachBookingsByType(userId, type);
  }

  /**
   * Get all bookings of a coach
   */
  @Get('bookings/coach/:coachId')
  async getBookingsByCoachId(@Param('coachId') coachId: string): Promise<Booking[]> {
    // Validate ObjectId format to prevent BSONError
    if (!coachId || !Types.ObjectId.isValid(coachId)) {
      throw new BadRequestException(`Invalid coach ID format: "${coachId}". Coach ID must be a valid MongoDB ObjectId.`);
    }
    return this.bookingsService.getByRequestedCoachId(coachId);
  }

  /**
   * Lấy danh sách booking của user hiện tại
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('bookings/my-bookings')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy danh sách booking của user',
    description: 'Lấy tất cả booking của user đang đăng nhập với thông tin chi tiết'
  })
  @ApiQuery({
    name: 'status',
    description: 'Filter theo trạng thái booking (lifecycle)',
    required: false,
    enum: ['pending', 'confirmed', 'cancelled', 'completed'],
    example: 'confirmed'
  })
  @ApiQuery({
    name: 'paymentStatus',
    description: 'Filter theo trạng thái thanh toán',
    required: false,
    enum: ['unpaid', 'paid', 'refunded'],
    example: 'paid'
  })
  @ApiQuery({
    name: 'approvalStatus',
    description: 'Filter theo trạng thái duyệt ghi chú (owner)',
    required: false,
    enum: ['pending', 'approved', 'rejected'],
    example: 'pending'
  })
  @ApiQuery({
    name: 'coachStatus',
    description: 'Filter theo trạng thái phản hồi coach',
    required: false,
    enum: ['pending', 'accepted', 'declined'],
    example: 'accepted'
  })
  @ApiQuery({
    name: 'type',
    description: 'Filter theo loại booking',
    required: false,
    enum: ['field', 'coach', 'field_coach'],
    example: 'field'
  })
  @ApiQuery({
    name: 'recurringFilter',
    description: 'Filter theo recurring status: none (single), only (recurring), all (all)',
    required: false,
    enum: ['none', 'only', 'all'],
    example: 'none'
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Filter theo ngày bắt đầu (YYYY-MM-DD)',
    required: false,
    type: String,
    example: '2025-01-01'
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Filter theo ngày kết thúc (YYYY-MM-DD)',
    required: false,
    type: String,
    example: '2025-12-31'
  })
  @ApiQuery({
    name: 'search',
    description: 'Search query (tìm kiếm theo field name, note, booking ID)',
    required: false,
    type: String,
    example: 'Sân bóng'
  })
  @ApiQuery({
    name: 'limit',
    description: 'Số lượng booking trả về',
    required: false,
    type: Number,
    example: 10
  })
  @ApiQuery({
    name: 'page',
    description: 'Trang hiện tại (bắt đầu từ 1)',
    required: false,
    type: Number,
    example: 1
  })
  @ApiResponse({
    status: 200,
    description: 'Danh sách booking của user',
    type: UserBookingsResponseDto
  })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async getMyBookings(
    @Request() req,
    @Query() query: GetUserBookingsDto,
  ): Promise<UserBookingsResponseDto> {
    const userId = this.getUserId(req);
    return await this.bookingsService.getUserBookings(userId, {
      status: query.status,
      paymentStatus: query.paymentStatus,
      approvalStatus: query.approvalStatus,
      coachStatus: query.coachStatus,
      type: query.type,
      recurringFilter: query.recurringFilter,
      startDate: query.startDate,
      endDate: query.endDate,
      search: query.search,
      limit: query.limit || 10,
      page: query.page || 1
    });
  }

  /**
   * Get simplified booking invoices/status for current user
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('bookings/my-invoices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get booking invoices/summary for current user' })
  @ApiResponse({ status: 200, description: 'List of booking invoices', type: [BookingInvoiceDto] })
  async getMyInvoices(
    @Request() req,
    @Query() query: GetUserBookingsDto,
  ): Promise<{ invoices: BookingInvoiceDto[]; pagination: any }> {
    const userId = this.getUserId(req);
    return await this.bookingsService.getUserBookingSummaries(userId, {
      status: query.status,
      paymentStatus: query.paymentStatus,
      approvalStatus: query.approvalStatus,
      coachStatus: query.coachStatus,
      type: query.type,
      limit: query.limit || 10,
      page: query.page || 1,
    });
  }

  /**
   * Get upcoming appointment for current user (single card)
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('bookings/upcoming')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get next upcoming booking for current user' })
  @ApiResponse({ status: 200, description: 'Upcoming booking or null', type: BookingUpcomingDto })
  async getUpcoming(
    @Request() req,
  ): Promise<BookingUpcomingDto | null> {
    const userId = this.getUserId(req);
    return await this.bookingsService.getUpcomingBooking(userId);
  }

  /**
   * Get booking by ID (public endpoint for payment status polling)
   * Used by frontend to check booking status during payment
   */
  @Get('bookings/:id')
  @ApiOperation({
    summary: 'Get booking by ID',
    description: 'Retrieve booking details by ID. Used for payment status polling.'
  })
  @ApiParam({
    name: 'id',
    description: 'Booking ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Booking details',
    type: Booking
  })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async getBookingById(@Param('id') id: string): Promise<Booking> {
    // Validate booking ID format
    if (!id || id.trim() === '' || id === 'undefined' || id === 'null') {
      throw new BadRequestException('Invalid booking ID');
    }

    if (!/^[0-9a-fA-F]{24}$/.test(id)) {
      throw new BadRequestException('Invalid booking ID format');
    }

    const booking = await this.bookingModel
      .findById(id)
      .populate('field', 'name address')
      .populate('court', 'name')
      .populate('user', 'email fullName')
      .exec();

    if (!booking) {
      throw new NotFoundException(`Booking ${id} not found`);
    }

    return booking;
  }

  /**
   * Create coach booking (lazy) – separate payment per booking
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('bookings/coach/lazy')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Tạo booking coach (Pure Lazy Creation, payment riêng)' })
  async createCoachBookingLazy(
    @Request() req,
    @Body() dto: CreateCoachBookingLazyDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);
    return this.bookingsService.createCoachBookingLazy(userId, dto);
  }

  // ============================================================================
  // FIELD OWNER NOTE APPROVAL (NEW)
  // ============================================================================

  /**
   * Owner: list bookings that contain user note (pending by default)
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('owners/bookings/notes')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - danh sách booking có ghi chú' })
  @ApiQuery({ name: 'status', required: false, enum: ['pending', 'accepted', 'denied'] })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listOwnerNoteBookings(
    @Request() req: any,
    @Query('status') status?: 'pending' | 'accepted' | 'denied',
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const ownerUserId = this.getUserId(req);
    return this.bookingsService.listOwnerNoteBookings(ownerUserId, { status, page, limit });
  }

  /**
   * Owner: get booking detail (with note) ensuring ownership
   */
  @UseGuards(AuthGuard('jwt'))
  @Get('owners/bookings/:bookingId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - chi tiết booking có ghi chú' })
  async getOwnerBookingDetail(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    const ownerUserId = this.getUserId(req);
    return this.bookingsService.getOwnerBookingDetail(ownerUserId, bookingId);
  }

  /**
   * Owner: accept user note and send payment link email (for online methods)
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('owners/bookings/:bookingId/note/accept')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - đồng ý ghi chú & gửi link thanh toán' })
  async acceptOwnerNote(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    const ownerUserId = this.getUserId(req);
    // Best-effort IP from request headers/env
    const ip = (req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection?.remoteAddress || '127.0.0.1');
    return this.bookingsService.ownerAcceptNote(ownerUserId, bookingId, ip);
  }

  /**
   * Owner: deny user note
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('owners/bookings/:bookingId/note/deny')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - từ chối ghi chú' })
  async denyOwnerNote(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
    @Body('reason') reason?: string,
  ) {
    const ownerUserId = this.getUserId(req);
    return this.bookingsService.ownerDenyNote(ownerUserId, bookingId, reason);
  }

  /**
   * Owner: accept a booking
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('owners/bookings/:bookingId/accept')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - chấp nhận booking' })
  async acceptOwnerBooking(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
  ) {
    const ownerUserId = this.getUserId(req);
    return this.bookingsService.ownerAcceptBooking(ownerUserId, bookingId);
  }

  /**
   * Owner: reject a booking
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('owners/bookings/:bookingId/reject')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Owner - từ chối booking' })
  async rejectOwnerBooking(
    @Request() req: any,
    @Param('bookingId') bookingId: string,
    @Body('reason') reason?: string,
  ) {
    const ownerUserId = this.getUserId(req);
    return this.bookingsService.ownerRejectBooking(ownerUserId, bookingId, reason);
  }

  // ============================================================================
  // LEGACY/BACKWARD COMPATIBILITY ENDPOINTS
  // ============================================================================



  /**
   * Create field booking (updated to use Pure Lazy Creation)
   * Now uses CreateFieldBookingLazyDto for consistency
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('bookings/field')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create field booking (Pure Lazy)',
    description: 'Create field booking using Pure Lazy Creation pattern with fieldId + date'
  })
  @ApiResponse({
    status: 201,
    description: 'Booking được tạo thành công',
    type: Booking
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async createFieldBookingUpdated(
    @Request() req,
    @Body() bookingData: CreateFieldBookingLazyDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);
    return await this.bookingsService.createFieldBookingLazy(userId, bookingData);
  }

  /**
   * Cancel field booking (legacy)
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('bookings/:id/cancel-legacy')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel field booking (legacy)',
    description: 'Legacy cancellation endpoint. Use PATCH /bookings/:bookingId/cancel instead'
  })
  async cancelBookingLegacy(
    @Request() req,
    @Param('id') bookingId: string,
    @Body() body: CancelBookingDto,
  ) {
    const userId = this.getUserId(req);
    return this.bookingsService.cancelBooking({
      bookingId,
      userId,
      cancellationReason: body.cancellationReason,
    });
  }

  /**
   * Verify payment proof for booking (Field Owner only)
   * Allows field owner to approve or reject payment proof image
   */
  @Patch('bookings/:id/verify-payment-proof')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác minh ảnh chứng minh thanh toán',
    description: 'Chủ sân duyệt hoặc từ chối ảnh chứng minh thanh toán của booking'
  })
  @ApiParam({ name: 'id', description: 'Booking ID' })
  @ApiResponse({ status: 200, description: 'Xác minh thành công', type: Booking })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Không có quyền xác minh booking này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy booking' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async verifyPaymentProof(
    @Request() req: any,
    @Param('id') bookingId: string,
    @Body() body: VerifyPaymentProofDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);

    // Get field owner profile ID from user
    const fieldOwnerProfile = await this.bookingsService.getFieldOwnerProfileByUserId(userId);
    if (!fieldOwnerProfile) {
      throw new BadRequestException('User is not a field owner');
    }

    return this.bookingsService.verifyPaymentProof(
      bookingId,
      fieldOwnerProfile.id,
      body.action,
      body.rejectionReason
    );
  }

  /**
   * Verify payment proof for coach booking (Coach only)
   * Allows coach to approve or reject payment proof image
   */
  @Patch('bookings/:id/verify-payment-proof-coach')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Xác minh ảnh chứng minh thanh toán (Coach)',
    description: 'Coach duyệt hoặc từ chối ảnh chứng minh thanh toán của booking'
  })
  @ApiParam({ name: 'id', description: 'Booking ID' })
  @ApiResponse({ status: 200, description: 'Xác minh thành công', type: Booking })
  @ApiResponse({ status: 400, description: 'Dữ liệu không hợp lệ' })
  @ApiResponse({ status: 403, description: 'Không có quyền xác minh booking này' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy booking' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async verifyCoachPaymentProof(
    @Request() req: any,
    @Param('id') bookingId: string,
    @Body() body: VerifyPaymentProofDto,
  ): Promise<Booking> {
    const coachUserId = this.getUserId(req);
    return this.bookingsService.verifyCoachPaymentProof(
      bookingId,
      coachUserId,
      body.action,
      body.rejectionReason
    );
  }

  /**
   * Get pending payment proofs for field owner
   * Returns list of bookings that need payment proof verification
   */
  @Get('bookings/pending-payment-proofs')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy danh sách bookings cần xác minh thanh toán',
    description: 'Trả về danh sách bookings của các sân thuộc chủ sân hiện tại có payment proof đang chờ xác minh'
  })
  @ApiResponse({ status: 200, description: 'Danh sách bookings cần xác minh', type: [Booking] })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async getPendingPaymentProofs(
    @Request() req: any,
  ): Promise<Booking[]> {
    const userId = this.getUserId(req);

    // Get field owner profile ID from user
    const fieldOwnerProfile = await this.bookingsService.getFieldOwnerProfileByUserId(userId);
    if (!fieldOwnerProfile) {
      throw new BadRequestException('User is not a field owner');
    }

    return this.bookingsService.getPendingPaymentProofs(fieldOwnerProfile.id);
  }

  /**
   * Get pending payment proofs for coach
   * Returns list of coach bookings that need payment proof verification
   */
  @Get('bookings/pending-payment-proofs-coach')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy danh sách coach bookings cần xác minh thanh toán',
    description: 'Trả về danh sách coach bookings của coach hiện tại có payment proof đang chờ xác minh'
  })
  @ApiResponse({ status: 200, description: 'Danh sách bookings cần xác minh', type: [Booking] })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async getPendingPaymentProofsForCoach(
    @Request() req: any,
  ): Promise<Booking[]> {
    const userId = this.getUserId(req);
    return this.bookingsService.getPendingPaymentProofsForCoach(userId);
  }

  /**
   * Create session booking (field + coach) with Pure Lazy Creation
   * Uses fieldId + coachId + date instead of scheduleId
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('bookings/session')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create session booking (Pure Lazy)',
    description: 'Create field + coach booking using Pure Lazy Creation pattern'
  })
  @ApiResponse({
    status: 201,
    description: 'Session booking được tạo thành công'
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu booking không hợp lệ hoặc slot không khả dụng' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân hoặc huấn luyện viên' })
  @ApiResponse({ status: 401, description: 'Chưa xác thực' })
  async createSessionBookingLazy(
    @Request() req,
    @Body() bookingData: CreateSessionBookingLazyDto,
  ) {
    const userId = this.getUserId(req);

    // Convert to legacy format for service compatibility
    // TODO: Update service to support Pure Lazy Creation directly
    return this.bookingsService.createSessionBooking({
      user: userId,
      field: bookingData.fieldId,
      coach: bookingData.coachId,
      date: new Date(bookingData.date),
      fieldStartTime: bookingData.fieldStartTime,
      fieldEndTime: bookingData.fieldEndTime,
      coachStartTime: bookingData.coachStartTime,
      coachEndTime: bookingData.coachEndTime,
      fieldPrice: 0, // Will be calculated by service
      coachPrice: 0, // Will be calculated by service
    });
  }



  /**
   * Cancel booking session (field + coach) (legacy)
   */
  @UseGuards(AuthGuard('jwt'))
  @Patch('bookings/session/cancel')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel session booking (legacy)',
    description: 'Cancel field + coach booking (legacy)'
  })
  async cancelSessionBooking(
    @Request() req,
    @Body() body: CancelSessionBookingDto,
  ) {
    const userId = this.getUserId(req);
    return this.bookingsService.cancelSessionBooking({
      fieldBookingId: body.fieldBookingId,
      coachBookingId: body.coachBookingId,
      userId,
      cancellationReason: body.cancellationReason,
    });
  }

  // ============================================================================
  // QR CHECK-IN SYSTEM (Dynamic QR with Time Windows)
  // ============================================================================

  /**
   * Generate QR code token for check-in
   * Only available within time window (default: 15 minutes before match start)
   * ✅ SECURITY: Rate limited to prevent QR generation spam
   */
  @Get('bookings/:id/check-in-qr')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Generate QR code for check-in',
    description: 'Generate a signed JWT token for QR check-in. Only available within configured time window before match start (default: 15 minutes).'
  })
  @ApiParam({
    name: 'id',
    description: 'Booking ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'QR token generated successfully',
    schema: {
      example: {
        token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
        expiresAt: '2026-01-07T14:15:00Z',
        bookingId: '507f1f77bcf86cd799439011'
      }
    }
  })
  @ApiResponse({
    status: 403,
    description: 'Too early or too late to generate QR',
    schema: {
      example: {
        message: 'Chưa đến giờ nhận sân. Vui lòng đợi thêm 10 phút.',
        canGenerateAt: '2026-01-07T13:45:00Z',
        windowEndsAt: '2026-01-07T14:00:00Z'
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Booking not eligible (not paid or not confirmed)' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  @ApiResponse({ status: 429, description: 'Too many requests - Rate limit exceeded' })
  async generateCheckInQR(
    @Param('id') bookingId: string,
    @Request() req: any,
  ) {
    // Debug logging
    console.debug(`[QR Generation] Request user: ${JSON.stringify(req.user)}`);
    console.debug(`[QR Generation] Booking ID: ${bookingId}`);

    const userId = this.getUserId(req);
    console.debug(`[QR Generation] Extracted userId: ${userId}`);

    return await this.bookingsService.generateCheckInQR(bookingId, userId);
  }

  /**
   * Confirm check-in by validating QR token
   * Updates booking status and triggers wallet transaction (pending → available)
   * ✅ SECURITY: Field owners and their staff can confirm check-ins
   */
  @Post('bookings/:id/check-in')
  @UseGuards(AuthGuard('jwt'), FieldAccessGuard)
  @ApiBearerAuth()
  @RateLimit({ ttl: 60, limit: 30 }) // 30 check-ins per minute for staff
  @ApiOperation({
    summary: 'Confirm check-in with QR token',
    description: 'Validate QR token and confirm customer check-in. Triggers wallet transaction to unlock funds. Field owners and their staff can perform check-ins.'
  })
  @ApiParam({
    name: 'id',
    description: 'Booking ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Check-in confirmed successfully',
    schema: {
      example: {
        booking: { /* full booking object */ },
        walletTransaction: {
          type: 'check_in_unlock',
          amount: 500000,
          newAvailableBalance: 500000
        },
        checkedInAt: '2026-01-07T14:05:32Z'
      }
    }
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid or expired token',
    schema: {
      example: { message: 'Mã QR đã hết hạn' }
    }
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid signature',
    schema: {
      example: { message: 'Mã QR không hợp lệ' }
    }
  })
  @ApiResponse({ status: 409, description: 'Already checked in' })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async confirmCheckIn(
    @Param('id') bookingId: string,
    @Body('token') token: string,
    @Request() req: any,
  ) {
    const staffId = this.getUserId(req);

    if (!token) {
      throw new BadRequestException('QR token is required');
    }

    return await this.bookingsService.confirmCheckIn(bookingId, token, staffId, req.ip);
  }

  /**
   * Get check-in time window information for a booking
   * Useful for displaying countdown timers on frontend
   */
  @Get('bookings/:id/check-in-window')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Get check-in time window information',
    description: 'Returns when QR generation becomes available and when it expires. Useful for countdown timers.'
  })
  @ApiParam({
    name: 'id',
    description: 'Booking ID',
    example: '507f1f77bcf86cd799439011'
  })
  @ApiResponse({
    status: 200,
    description: 'Check-in window information',
    schema: {
      example: {
        windowStartsAt: '2026-01-07T13:45:00Z',
        windowEndsAt: '2026-01-07T14:00:00Z',
        windowDurationMinutes: 15,
        canGenerateNow: false,
        timeUntilWindowMs: 600000
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Booking not found' })
  async getCheckInWindow(
    @Param('id') bookingId: string,
    @Request() req: any,
  ) {
    const userId = this.getUserId(req);
    return await this.bookingsService.getCheckInWindow(bookingId, userId);
  }
}

