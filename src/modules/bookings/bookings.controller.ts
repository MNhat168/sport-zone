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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { BookingsService, DailyAvailability } from './bookings.service';
import { Booking } from './entities/booking.entity';
import { CreateFieldBookingLazyDto, FieldAvailabilityQueryDto, MarkHolidayDto } from './dto/create-field-booking-pure-lazy.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateFieldBookingDto } from './dto/create-field-booking.dto';
import { CreateSessionBookingDto } from './dto/create-session-booking.dto';
import { CreateSessionBookingLazyDto } from './dto/create-session-booking-lazy.dto';
import { CancelSessionBookingDto } from './dto/cancel-session-booking.dto';
import { Schedule } from '../schedules/entities/schedule.entity';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

/**
 * Bookings Controller with Pure Lazy Creation pattern
 * Includes both new (Pure Lazy) and legacy endpoints for backward compatibility
 */
@ApiTags('Bookings')
@Controller()
export class BookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    @InjectModel(Schedule.name) private readonly scheduleModel: Model<Schedule>,
  ) {}

  /**
   * Helper method to extract user ID from JWT payload
   */
  private getUserId(req: any): string {
    const userId = req.user?.userId || req.user?._id || req.user?.id;
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
   */
  @Get('fields/:fieldId/availability')
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
  @ApiResponse({ 
    status: 200, 
    description: 'Lịch khả dụng được tạo thành công'
  })
  @ApiResponse({ status: 400, description: 'Dữ liệu đầu vào không hợp lệ' })
  @ApiResponse({ status: 404, description: 'Không tìm thấy sân' })
  async getFieldAvailability(
    @Param('fieldId') fieldId: string,
    @Query() query: FieldAvailabilityQueryDto,
  ): Promise<DailyAvailability[]> {
    return await this.bookingsService.getFieldAvailability(fieldId, query);
  }

  /**
   * Tạo booking sân theo Pure Lazy Creation
   * Không cần scheduleId, tự động upsert Schedule nếu cần
   */
  @Post('bookings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
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
  async createFieldBookingLazy(
    @Request() req: any,
    @Body() bookingData: CreateFieldBookingLazyDto,
  ): Promise<Booking> {
    const userId = this.getUserId(req);
    return await this.bookingsService.createFieldBookingLazy(userId, bookingData);
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

  // ============================================================================
  // LEGACY/BACKWARD COMPATIBILITY ENDPOINTS
  // ============================================================================

  /**
   * Accept/Decline coaching booking (legacy)
   */
  @Patch('bookings/:id/coach-status')
  @ApiOperation({ 
    summary: 'Accept/Decline coaching booking (legacy)', 
    description: 'Coach accepts or declines a booking request' 
  })
  async setCoachStatus(
    @Param('id') bookingId: string,
    @Body() body: { coachId: string; status: 'accepted' | 'declined' },
  ) {
    if (!body || !body.coachId || !body.status) {
      throw new BadRequestException('coachId and status are required');
    }
    
    return this.bookingsService.updateCoachStatus(
      bookingId,
      body.coachId,
      body.status,
    );
  }

  /**
   * Get all bookings of a coach (legacy)
   */
  @Get('bookings/coach/:coachId')
  @ApiOperation({ 
    summary: 'Get all bookings for a coach (legacy)', 
    description: 'Retrieve all bookings associated with a specific coach' 
  })
  async getBookingsByCoachId(@Param('coachId') coachId: string): Promise<Booking[]> {
    return this.bookingsService.getByRequestedCoachId(coachId);
  }

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
   * Create session booking (legacy - requires scheduleId)
   * @deprecated Use POST /bookings/session with CreateSessionBookingLazyDto instead
   */
  @UseGuards(AuthGuard('jwt'))
  @Post('bookings/session/legacy')
  @ApiBearerAuth()
  @ApiOperation({ 
    summary: 'Create session booking (legacy)', 
    description: 'Legacy endpoint - requires scheduleId. Use POST /bookings/session instead for Pure Lazy Creation' 
  })
  async createSessionBookingLegacy(
    @Request() req,
    @Body() body: CreateSessionBookingDto,
  ) {
    const userId = this.getUserId(req);
    
    // Fetch schedules to extract field, coach, and date for Pure Lazy Creation compatibility
    const [fieldSchedule, coachSchedule] = await Promise.all([
      this.scheduleModel.findById(body.fieldScheduleId).exec(),
      this.scheduleModel.findById(body.coachScheduleId).exec(),
    ]);
    
    if (!fieldSchedule || !coachSchedule) {
      throw new BadRequestException('Field schedule or coach schedule not found');
    }
    
    return this.bookingsService.createSessionBooking({
      user: userId,
      field: fieldSchedule.field.toString(),
      coach: coachSchedule.coach?.toString() || '',
      date: fieldSchedule.date, // Assuming field and coach schedules are for the same date
      fieldStartTime: body.fieldStartTime,
      fieldEndTime: body.fieldEndTime,
      coachStartTime: body.coachStartTime,
      coachEndTime: body.coachEndTime,
      fieldPrice: body.fieldPrice,
      coachPrice: body.coachPrice,
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
}
