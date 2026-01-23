import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Request,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor, FileInterceptor, FileFieldsInterceptor } from '@nestjs/platform-express';
import { FieldOwnerService } from './field-owner.service';
import { FieldsService } from '../fields/fields.service';
import { AwsS3Service } from '../../service/aws-s3.service';

import {
  CreateFieldDto,
  FieldsDto,
  OwnerFieldsResponseDto,
  UpdateFieldDto,
} from '../fields/dtos/fields.dto';
import { UpdateFieldVerificationDto } from '../fields/dtos/update-field-verification.dto';
import {
  CreateFieldOwnerProfileDto,
  FieldOwnerProfileDto,
  UpdateFieldOwnerProfileDto,
} from './dtos/field-owner-profile.dto';
import {
  ApproveFieldOwnerRegistrationDto,
  CreateFieldOwnerRegistrationDto,
  FieldOwnerRegistrationResponseDto,
  RejectFieldOwnerRegistrationDto,
  RequestAdditionalInfoRegistrationDto,
} from './dtos/field-owner-registration.dto';
import {
  BankAccountResponseDto,
  CreateBankAccountDto,
  UpdateBankAccountDto,
  UpdateBankAccountStatusDto,
} from './dtos/bank-account.dto';
import type { IFile } from '../../interfaces/file.interface';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { Roles } from 'src/decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';
import { BankAccountStatus } from '@common/enums/bank-account.enum';
import { EkycService } from '../ekyc/ekyc.service';
import {
  CreateEkycSessionDto,
  EkycSessionResponseDto,
  EkycStatusResponseDto,
} from '../ekyc/dto';
import { RateLimit, RateLimitGuard } from '@common/guards/rate-limit.guard';
import { OwnerOnlyGuard } from '../../common/guards/owner-only.guard';
import { StaffAccountService } from './services/staff-account.service';
import {
  CreateStaffAccountDto,
  UpdateStaffAccountDto,
  StaffAccountResponseDto,
  ListStaffAccountsQueryDto,
} from './dtos/staff-account.dto';

@ApiTags('Field Owner')
@Controller('field-owner')
export class FieldOwnerController {
  private readonly logger = new Logger(FieldOwnerController.name);

  constructor(
    private readonly fieldOwnerService: FieldOwnerService,
    private readonly fieldsService: FieldsService,
    private readonly awsS3Service: AwsS3Service,
    private readonly ekycService: EkycService,
    private readonly staffAccountService: StaffAccountService,
  ) { }

  private async getOwnerProfileId(userId: string): Promise<string> {
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found. Please create a profile first.');
    }
    return profile.id;
  }

  @Get('fields')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current owner fields' })
  async getMyFields(
    @Request() req: any,
    @Query('name') name?: string,
    @Query('sportType') sportType?: string,
    @Query('isActive') isActive?: boolean,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ): Promise<OwnerFieldsResponseDto> {
    const ownerId = req.user.userId;
    return this.fieldOwnerService.findByOwner(ownerId, {
      name,
      sportType,
      isActive,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Post('profile')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create field owner profile' })
  async createFieldOwnerProfile(
    @Request() req: any,
    @Body() createDto: CreateFieldOwnerProfileDto,
  ): Promise<FieldOwnerProfileDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    return this.fieldOwnerService.createFieldOwnerProfile(userId, createDto);
  }

  @Post('confirm-policy')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm field owner has read platform policy' })
  async confirmPolicy(@Request() req: any): Promise<{ success: boolean }> {
    const userId = req.user.userId;
    await this.fieldOwnerService.confirmPolicy(userId);
    return { success: true };
  }

  @Get('profile')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current field owner profile' })
  async getMyFieldOwnerProfile(@Request() req: any): Promise<FieldOwnerProfileDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return profile;
  }

  @Patch('profile')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update field owner profile' })
  async updateFieldOwnerProfile(
    @Request() req: any,
    @Body() updateDto: UpdateFieldOwnerProfileDto,
  ): Promise<FieldOwnerProfileDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    return this.fieldOwnerService.updateFieldOwnerProfile(userId, updateDto);
  }

  @Post('fields')
  @UseInterceptors(FilesInterceptor('images', 10))
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: 'Create new field (owner)' })
  async createField(
    @Request() req,
    @Body() createFieldDto: CreateFieldDto,
    @UploadedFiles() files?: IFile[],
  ): Promise<FieldsDto> {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    return this.fieldOwnerService.create(createFieldDto, ownerId, files);
  }

  @Post('fields/with-images')
  @UseInterceptors(FilesInterceptor('images', 10))
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Create new field with images (multipart/form-data)' })
  async createFieldWithImages(
    @Request() req,
    @Body() createFieldDto: CreateFieldDto,
    @UploadedFiles() files?: IFile[],
  ): Promise<FieldsDto> {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);

    // WORKAROUND: NestJS @Type decorator loses nested object data for multipart/form-data
    // Manually parse location from raw body if it came as string
    const rawBody = req.body;
    if (rawBody?.location && typeof rawBody.location === 'string') {
      try {
        createFieldDto.location = JSON.parse(rawBody.location);
      } catch (error) {
        this.logger.error('Failed to parse location JSON:', error);
        throw new BadRequestException('Invalid location format - must be valid JSON');
      }
    }

    // WORKAROUND: Parse operatingHours from raw body if it came as string
    if (rawBody?.operatingHours && typeof rawBody.operatingHours === 'string') {
      try {
        createFieldDto.operatingHours = JSON.parse(rawBody.operatingHours);
      } catch (error) {
        this.logger.error('Failed to parse operatingHours JSON:', error);
        throw new BadRequestException('Invalid operatingHours format - must be valid JSON');
      }
    }

    // WORKAROUND: Parse priceRanges from raw body if it came as string
    if (rawBody?.priceRanges && typeof rawBody.priceRanges === 'string') {
      try {
        createFieldDto.priceRanges = JSON.parse(rawBody.priceRanges);
      } catch (error) {
        this.logger.error('Failed to parse priceRanges JSON:', error);
        throw new BadRequestException('Invalid priceRanges format - must be valid JSON');
      }
    }

    return this.fieldOwnerService.create(createFieldDto, ownerId, files);
  }

  @Patch('fields/:id')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'avatar', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
  ]))
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiOperation({ summary: 'Update field info' })
  async updateField(
    @Request() req,
    @Param('id') id: string,
    @Body() updateFieldDto: UpdateFieldDto,
    @UploadedFiles() files?: { avatar?: IFile[], gallery?: IFile[] },
  ): Promise<FieldsDto> {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    return this.fieldOwnerService.update(id, updateFieldDto, ownerId, files);
  }

  @Patch('fields/:id/with-images')
  @UseInterceptors(FileFieldsInterceptor([
    { name: 'avatar', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
  ]))
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Update field with images (multipart/form-data)' })
  async updateFieldWithImages(
    @Request() req,
    @Param('id') id: string,
    @Body() updateFieldDto: UpdateFieldDto,
    @UploadedFiles() files?: { avatar?: IFile[], gallery?: IFile[] },
  ): Promise<FieldsDto> {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    return this.fieldOwnerService.update(id, updateFieldDto, ownerId, files);
  }

  @Delete('fields/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete field' })
  async deleteField(
    @Request() req,
    @Param('id') id: string,
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    return this.fieldOwnerService.delete(id, ownerId);
  }

  @Post('fields/:id/schedule-price-update')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Schedule price update (owner only)' })
  async schedulePriceUpdate(
    @Request() req,
    @Param('id') fieldId: string,
    @Body() body: {
      newOperatingHours: { day: string; start: string; end: string; duration: number }[];
      newPriceRanges: { day: string; start: string; end: string; multiplier: number }[];
      newBasePrice: number;
      effectiveDate: string;
    },
  ) {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    const effectiveDate = new Date(body.effectiveDate);
    return this.fieldOwnerService.schedulePriceUpdate(
      fieldId,
      body.newOperatingHours,
      body.newPriceRanges,
      body.newBasePrice,
      effectiveDate,
      ownerId,
    );
  }

  @Delete('fields/:id/scheduled-price-update')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cancel scheduled price update (owner only)' })
  async cancelScheduledPriceUpdate(
    @Request() req,
    @Param('id') fieldId: string,
    @Body() body: { effectiveDate: string },
  ): Promise<{ success: boolean }> {
    const effectiveDate = new Date(body.effectiveDate);
    const success = await this.fieldOwnerService.cancelScheduledPriceUpdate(fieldId, effectiveDate);
    return { success };
  }

  @Get('fields/:id/scheduled-price-updates')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List scheduled price updates' })
  async getScheduledPriceUpdates(@Param('id') fieldId: string) {
    return this.fieldOwnerService.getScheduledPriceUpdates(fieldId);
  }

  @Get('bookings/today')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get today bookings for owner' })
  async getTodayBookings(@Request() req: any) {
    const userId = req.user.userId;
    return this.fieldOwnerService.getTodayBookingsByOwner(userId);
  }

  @Get('bookings')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookings for owner with filters' })
  async getAllBookings(
    @Request() req: any,
    @Query('fieldName') fieldName?: string,
    @Query('status') status?: string,
    @Query('transactionStatus') transactionStatus?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const userId = req.user.userId;
    return this.fieldOwnerService.getAllBookingsByOwner(userId, {
      fieldName,
      status,
      transactionStatus,
      startDate,
      endDate,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Get('bookings/by-type')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bookings for owner filtered by type (field or field_coach)' })
  @ApiQuery({ name: 'type', required: false, description: 'Booking type: field or field_coach' })
  @ApiQuery({ name: 'recurringFilter', required: false, description: 'Filter recurring bookings: none (single only), only (recurring only), all (both)' })
  @ApiQuery({ name: 'recurringType', required: false, description: 'Filter by recurring type: CONSECUTIVE or WEEKLY' })
  @ApiQuery({ name: 'sortBy', required: false, description: 'Sort by field: createdAt, date, or totalPrice' })
  @ApiQuery({ name: 'sortOrder', required: false, description: 'Sort order: asc or desc' })
  async getAllBookingsByType(
    @Request() req: any,
    @Query('type') type?: string,
    @Query('fieldName') fieldName?: string,
    @Query('status') status?: string,
    @Query('transactionStatus') transactionStatus?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('recurringFilter') recurringFilter?: 'none' | 'only' | 'all',
    @Query('recurringType') recurringType?: 'CONSECUTIVE' | 'WEEKLY',
    @Query('sortBy') sortBy?: 'createdAt' | 'date' | 'totalPrice',
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 10,
  ) {
    const userId = req.user.userId;
    return this.fieldOwnerService.getAllBookingsByOwnerWithType(userId, {
      type,
      fieldName,
      status,
      transactionStatus,
      startDate,
      endDate,
      recurringFilter,
      recurringType,
      sortBy,
      sortOrder,
      page: Number(page),
      limit: Number(limit),
    });
  }

  @Put('fields/:id/amenities')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update field amenities' })
  async updateFieldAmenities(
    @Request() req,
    @Param('id') fieldId: string,
    @Body() body: { amenities: Array<{ amenityId: string; price: number }> },
  ) {
    const userId = req.user.userId;
    const ownerId = await this.getOwnerProfileId(userId);
    return this.fieldOwnerService.updateFieldAmenities(fieldId, body.amenities, ownerId);
  }

  @Post('registration-request')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Submit field owner registration request' })
  async createRegistrationRequest(
    @Request() req: any,
    @Body() dto: CreateFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    const userId = req.user.userId;
    this.logger.log(`Creating registration request for user ${userId}`);
    this.logger.debug('Registration DTO:', JSON.stringify(dto, null, 2));
    try {
      return await this.fieldOwnerService.createRegistrationRequest(userId, dto);
    } catch (error: any) {
      this.logger.error('Failed to create registration request:', error?.message || error);
      throw error;
    }
  }

  @Get('registration-request/my')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current registration request status' })
  async getMyRegistrationRequest(@Request() req: any) {
    const userId = req.user.userId;
    return this.fieldOwnerService.getMyRegistrationRequest(userId);
  }

  @Post('registration-request/upload-document')
  @UseGuards(AuthGuard('jwt'))
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary: 'Upload business license document',
    description: 'Upload business license document for business/household owner types. Note: CCCD documents are now handled via didit eKYC integration.'
  })
  async uploadRegistrationDocument(
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    // Note: This endpoint is now primarily for business license uploads only
    // CCCD documents should be handled via didit eKYC integration
    const url = await this.awsS3Service.uploadRegistrationDocumentFromBuffer(
      file.buffer,
      file.mimetype,
    );
    return { url };
  }

  /**
   * Tạo eKYC session với didit
   * FE gọi endpoint này trước khi mở didit widget
   */
  @Post('ekyc/session')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Tạo eKYC session với didit',
    description: 'Tạo một phiên xác thực eKYC mới. Frontend sẽ sử dụng redirectUrl để mở didit eKYC widget.'
  })
  @ApiResponse({
    status: 201,
    description: 'eKYC session đã được tạo thành công',
    type: EkycSessionResponseDto
  })
  @ApiResponse({
    status: 500,
    description: 'Không thể tạo phiên xác thực eKYC'
  })
  async createEkycSession(
    @Request() req: any,
    @Body() _dto: CreateEkycSessionDto,
  ): Promise<EkycSessionResponseDto> {
    try {
      const userId = req.user?.userId;

      if (!userId) {
        this.logger.error('User ID not found in request', {
          user: req.user,
        });
        throw new BadRequestException('Không tìm thấy thông tin người dùng. Vui lòng đăng nhập lại.');
      }

      this.logger.log(`Creating eKYC session for user ${userId}`);
      const { sessionId, redirectUrl } = await this.ekycService.createEkycSession(
        userId.toString(),
      );

      return { sessionId, redirectUrl };
    } catch (error: any) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      this.logger.error('Failed to create eKYC session in controller:', {
        error: error?.message,
        stack: error?.stack,
      });

      throw new InternalServerErrorException(
        error?.message || 'Không thể tạo phiên xác thực eKYC. Vui lòng thử lại sau.',
      );
    }
  }

  /**
   * Lấy eKYC status (cho FE polling)
   * FE sẽ gọi endpoint này mỗi 3-5s để check xem user đã hoàn thành eKYC chưa
   */
  @Get('ekyc/status/:sessionId')
  @UseGuards(AuthGuard('jwt'), RateLimitGuard)
  @RateLimit({ ttl: 60, limit: 20 }) // 20 requests per minute (polling every 3s = 20/min)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Lấy trạng thái eKYC session',
    description: 'Frontend polling endpoint để kiểm tra xem user đã hoàn thành eKYC chưa. Gọi mỗi 3-5s.'
  })
  @ApiParam({
    name: 'sessionId',
    description: 'eKYC session ID',
    example: 'ekyc_123456789'
  })
  @ApiResponse({
    status: 200,
    description: 'Trạng thái eKYC session',
    type: EkycStatusResponseDto
  })
  @ApiResponse({
    status: 404,
    description: 'eKYC session không tồn tại hoặc không thuộc về bạn'
  })
  @ApiResponse({
    status: 429,
    description: 'Too many requests - Rate limit exceeded'
  })
  async getEkycStatus(
    @Param('sessionId') sessionId: string,
    @Request() req: any,
  ): Promise<EkycStatusResponseDto> {
    const userId = req.user.userId;

    // Security check: verify session belongs to current user BEFORE calling didit API
    // This will throw NotFoundException if session doesn't belong to user
    // If no registration exists yet (user just created session), this returns null and allows
    await this.ekycService.verifyEkycSessionOwnership(sessionId, userId);

    // Get status from didit API (also updates local DB)
    // Only call didit API if ownership check passes
    const result = await this.ekycService.getEkycSessionStatus(sessionId);

    return result;
  }

  @Post('profile/bank-account')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Add bank account for owner' })
  async addBankAccount(
    @Request() req: any,
    @Body() dto: CreateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.fieldOwnerService.addBankAccount(profile.id, dto);
  }

  @Get('profile/bank-accounts')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bank accounts for owner' })
  async getMyBankAccounts(@Request() req: any): Promise<BankAccountResponseDto[]> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.fieldOwnerService.getBankAccountsByFieldOwner(profile.id);
  }


  @Patch('profile/bank-account/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bank account for owner' })
  @ApiParam({ name: 'id', description: 'Bank account ID' })
  async updateBankAccount(
    @Request() req: any,
    @Param('id') accountId: string,
    @Body() dto: UpdateBankAccountDto,
  ): Promise<BankAccountResponseDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.fieldOwnerService.updateBankAccount(accountId, profile.id, dto);
  }

  @Get('profile/bank-account/:id/verification-status')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bank account verification status' })
  @ApiParam({ name: 'id', description: 'Bank account ID' })
  async getBankAccountVerificationStatus(
    @Request() req: any,
    @Param('id') accountId: string,
  ) {
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(req.user.userId);
    if (!profile) {
      throw new NotFoundException('Field owner profile not found');
    }

    return this.fieldOwnerService.getVerificationStatus(accountId);
  }

  @Delete('profile/bank-account/:id')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bank account for owner' })
  @ApiParam({ name: 'id', description: 'Bank account ID' })
  async deleteBankAccount(
    @Request() req: any,
    @Param('id') accountId: string,
  ): Promise<{ success: boolean; message: string }> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.fieldOwnerService.deleteBankAccount(accountId, profile.id);
  }

  @Patch('profile/bank-account/:id/set-default')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Set bank account as default for owner' })
  @ApiParam({ name: 'id', description: 'Bank account ID' })
  async setDefaultBankAccount(
    @Request() req: any,
    @Param('id') accountId: string,
  ): Promise<BankAccountResponseDto> {
    if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
      throw new ForbiddenException('Access denied. Field owner only.');
    }
    const userId = req.user.userId;
    const profile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!profile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.fieldOwnerService.setDefaultBankAccount(accountId, profile.id);
  }

  // SECTION: Staff Account Management
  // ---------------------------------

  @Post('staff')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Create staff account',
    description: 'Field owners can create staff accounts for employees to handle check-ins. Staff accounts do not require eKYC.'
  })
  @ApiResponse({ status: 201, description: 'Staff account created successfully', type: StaffAccountResponseDto })
  @ApiResponse({ status: 409, description: 'Email already exists' })
  async createStaffAccount(
    @Request() req: any,
    @Body() dto: CreateStaffAccountDto,
  ): Promise<StaffAccountResponseDto> {
    const userId = req.user.userId;
    const ownerProfile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!ownerProfile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.staffAccountService.createStaffAccount(ownerProfile.id, dto);
  }

  @Get('staff')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all staff accounts for the owner' })
  @ApiResponse({ status: 200, description: 'List of staff accounts retrieved successfully' })
  async listStaffAccounts(
    @Request() req: any,
    @Query() query: ListStaffAccountsQueryDto,
  ): Promise<{ staff: StaffAccountResponseDto[]; total: number; page: number; limit: number }> {
    const userId = req.user.userId;
    const ownerProfile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!ownerProfile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.staffAccountService.listStaffAccounts(ownerProfile.id, query);
  }

  @Patch('staff/:id')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update staff account details' })
  @ApiParam({ name: 'id', description: 'Staff account ID' })
  @ApiResponse({ status: 200, description: 'Staff account updated successfully', type: StaffAccountResponseDto })
  @ApiResponse({ status: 404, description: 'Staff account not found or does not belong to this owner' })
  async updateStaffAccount(
    @Request() req: any,
    @Param('id') staffId: string,
    @Body() dto: UpdateStaffAccountDto,
  ): Promise<StaffAccountResponseDto> {
    const userId = req.user.userId;
    const ownerProfile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!ownerProfile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.staffAccountService.updateStaffAccount(staffId, ownerProfile.id, dto);
  }

  @Delete('staff/:id')
  @UseGuards(AuthGuard('jwt'), OwnerOnlyGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remove staff account (soft delete)',
    description: 'Deactivates the staff account and removes them from the owner\'s staff list'
  })
  @ApiParam({ name: 'id', description: 'Staff account ID' })
  @ApiResponse({ status: 200, description: 'Staff account removed successfully' })
  @ApiResponse({ status: 404, description: 'Staff account not found or does not belong to this owner' })
  async removeStaffAccount(
    @Request() req: any,
    @Param('id') staffId: string,
  ): Promise<{ success: boolean; message: string }> {
    const userId = req.user.userId;
    const ownerProfile = await this.fieldOwnerService.getFieldOwnerProfileByUserId(userId);
    if (!ownerProfile) {
      throw new BadRequestException('Field owner profile not found');
    }
    return this.staffAccountService.removeStaffAccount(staffId, ownerProfile.id);
  }

  // SECTION: Public Endpoints
  // --------------------------

  @Get('profile/:id')
  @ApiOperation({ summary: 'Get field owner profile by ID (public)' })
  async getFieldOwnerProfile(@Param('id') id: string): Promise<FieldOwnerProfileDto> {
    return this.fieldOwnerService.getFieldOwnerProfile(id);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/profiles')
  @ApiOperation({ summary: 'Admin: list field owner profiles' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getAllFieldOwnerProfiles(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
    @Query('search') search?: string,
    @Query('isVerified') isVerified?: string,
    @Query('sortBy') sortBy: string = 'createdAt',
    @Query('sortOrder') sortOrder: 'asc' | 'desc' = 'desc',
  ) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const parsedIsVerified = isVerified === 'true' ? true : isVerified === 'false' ? false : undefined;
    return this.fieldOwnerService.getAllFieldOwnerProfiles(
      parsedPage,
      parsedLimit,
      search,
      parsedIsVerified,
      sortBy,
      sortOrder,
    );
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/registration-requests')
  @ApiOperation({ summary: 'Admin: list registration requests' })
  async getRegistrationRequests(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    return this.fieldOwnerService.getPendingRegistrationRequests(parsedPage, parsedLimit);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/registration-requests/:id')
  @ApiOperation({ summary: 'Admin: get registration request by ID' })
  async getRegistrationRequest(
    @Param('id') requestId: string,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    return this.fieldOwnerService.getRegistrationRequest(requestId);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/registration-requests/:id/approve')
  @ApiOperation({ summary: 'Admin: approve registration request' })
  async approveRegistrationRequest(
    @Request() req: any,
    @Param('id') requestId: string,
    @Body() dto: ApproveFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerProfileDto> {
    const adminId = req.user.userId;
    return this.fieldOwnerService.approveRegistrationRequest(requestId, adminId, dto);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/registration-requests/:id/reject')
  @ApiOperation({ summary: 'Admin: reject registration request' })
  async rejectRegistrationRequest(
    @Request() req: any,
    @Param('id') requestId: string,
    @Body() dto: RejectFieldOwnerRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    const adminId = req.user.userId;
    return this.fieldOwnerService.rejectRegistrationRequest(requestId, adminId, dto);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/registration-requests/:id/request-info')
  @ApiOperation({ summary: 'Admin: request additional info for registration request' })
  async requestAdditionalInfo(
    @Request() req: any,
    @Param('id') requestId: string,
    @Body() dto: RequestAdditionalInfoRegistrationDto,
  ): Promise<FieldOwnerRegistrationResponseDto> {
    const adminId = req.user.userId;
    return this.fieldOwnerService.requestAdditionalInfo(requestId, adminId, dto);
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/bank-accounts/:id/verify')
  @ApiOperation({ summary: 'Admin: verify bank account' })
  async verifyBankAccount(
    @Request() req: any,
    @Param('id') accountId: string,
    @Body() dto: UpdateBankAccountStatusDto,
  ): Promise<BankAccountResponseDto> {
    const adminId = req.user.userId;
    return this.fieldOwnerService.updateBankAccountStatus(
      accountId,
      BankAccountStatus.VERIFIED,
      adminId,
      dto.notes,
    );
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Post('admin/bank-accounts/:id/reject')
  @ApiOperation({ summary: 'Admin: reject bank account' })
  async rejectBankAccount(
    @Request() req: any,
    @Param('id') accountId: string,
    @Body() dto: UpdateBankAccountStatusDto,
  ): Promise<BankAccountResponseDto> {
    const adminId = req.user.userId;
    return this.fieldOwnerService.updateBankAccountStatus(
      accountId,
      BankAccountStatus.REJECTED,
      adminId,
      dto.notes,
      dto.rejectionReason,
    );
  }

  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch('admin/fields/:id/verify')
  @ApiOperation({ summary: 'Admin: update field verification status' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field verification updated successfully', type: FieldsDto })
  async updateFieldVerification(
    @Param('id') fieldId: string,
    @Body() dto: UpdateFieldVerificationDto,
  ): Promise<FieldsDto> {
    return this.fieldsService.updateFieldVerification(fieldId, dto.isAdminVerify);
  }

  // ============================================================================
  // FIELD QR CODE MANAGEMENT
  // ============================================================================

  @Get('fields/:fieldId/qr-code')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get field QR code' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field QR code retrieved successfully' })
  @ApiResponse({ status: 404, description: 'QR code not found' })
  async getFieldQrCode(
    @Param('fieldId') fieldId: string,
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    return this.fieldOwnerService.getFieldQrCode(fieldId, userId);
  }

  @Post('fields/:fieldId/qr-code/generate')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate or get field QR code' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field QR code generated successfully' })
  async generateFieldQrCode(
    @Param('fieldId') fieldId: string,
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    return this.fieldOwnerService.generateFieldQrCode(fieldId, userId);
  }

  @Post('fields/:fieldId/qr-code/regenerate')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Regenerate field QR code (invalidate old, create new)' })
  @ApiParam({ name: 'fieldId', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field QR code regenerated successfully' })
  async regenerateFieldQrCode(
    @Param('fieldId') fieldId: string,
    @Request() req: any,
  ) {
    const userId = req.user.userId;
    return this.fieldOwnerService.regenerateFieldQrCode(fieldId, userId);
  }
}

