import { Controller, Get, Post, Query, Param, BadRequestException, Patch, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { Types } from 'mongoose';
import { FieldsService } from './fields.service';
import { FieldsDto } from './dtos/fields.dto';
import { BankAccountResponseDto } from '../field-owner/dtos/bank-account.dto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../decorators/roles.decorator';
import { UserRole } from '@common/enums/user.enum';

import { AiService } from '../ai/ai.service';
import { CreateFieldDto, UpdateFieldDto } from './dtos/fields.dto';

@ApiTags('Fields')
@Controller('fields')
export class FieldsController {
  constructor(
    private readonly fieldsService: FieldsService,
    private readonly aiService: AiService
  ) { }

  @Post('ai/generate')
  @UseGuards(JwtAccessTokenGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Generate field details using AI' })
  @ApiResponse({ status: 200, description: 'Field details generated' })
  async generateFieldInfo(@Body() body: { description: string }, @Request() req) {
    if (!body.description) {
      throw new BadRequestException('Description is required');
    }
    return this.aiService.generateFieldInfo(body.description, req.user.userId);
  }

  @Patch('admin/:id/verify')
  @UseGuards(JwtAccessTokenGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Toggle field verification status (Admin only)' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field verification status updated successfully', type: FieldsDto })
  @ApiResponse({ status: 400, description: 'Invalid field ID format' })
  @ApiResponse({ status: 404, description: 'Field not found' })
  async toggleVerification(
    @Param('id') id: string,
    @Body() dto: { isAdminVerify: boolean },
  ): Promise<FieldsDto> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid field ID format: "${id}". Field ID must be a valid MongoDB ObjectId.`);
    }
    return this.fieldsService.updateVerificationStatus(id, dto.isAdminVerify);
  }


  @Get()
  @ApiOperation({ summary: 'Get all fields with filtering' })
  @ApiResponse({ status: 200, description: 'Fields retrieved successfully', type: [FieldsDto] })
  async findAll(
    @Query('name') name?: string,
    @Query('location') location?: string,
    @Query('sportType') sportType?: string,
    @Query('sportTypes') sportTypes?: string | string[],
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ): Promise<FieldsDto[]> {
    // Convert sportTypes to array if it's a string
    const sportTypesArray = sportTypes
      ? (Array.isArray(sportTypes) ? sportTypes : [sportTypes])
      : undefined;

    const result = await this.fieldsService.findAll({
      name,
      location,
      sportType,
      sportTypes: sportTypesArray,
      sortBy,
      sortOrder,
    });

    // Handle both array and paginated response (backward compatible)
    return Array.isArray(result) ? result : result.fields;
  }

  @Get('paginated')
  @ApiOperation({ summary: 'Get all fields with filtering and pagination' })
  @ApiResponse({ status: 200, description: 'Fields retrieved successfully with pagination' })
  async findAllPaginated(
    @Query('name') name?: string,
    @Query('location') location?: string,
    @Query('sportType') sportType?: string,
    @Query('sportTypes') sportTypes?: string | string[],
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    // Log received parameters for debugging
    console.log('[FieldsController.findAllPaginated] Received params:', { sortBy, sortOrder, name, location, sportType, page, limit });

    // Convert sportTypes to array if it's a string
    const sportTypesArray = sportTypes
      ? (Array.isArray(sportTypes) ? sportTypes : [sportTypes])
      : undefined;

    // Parse pagination params
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    return this.fieldsService.findAll({
      name,
      location,
      sportType,
      sportTypes: sportTypesArray,
      sortBy,
      sortOrder,
      page: parsedPage,
      limit: parsedLimit,
    });
  }

  @Get('paginated')
  @ApiOperation({ summary: 'Get paginated fields with filtering' })
  @ApiResponse({ status: 200, description: 'Paginated fields retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid pagination parameters' })
  async findPaginated(
    @Query('name') name?: string,
    @Query('location') location?: string,
    @Query('sportType') sportType?: string,
    @Query('sportTypes') sportTypes?: string | string[],
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const sportTypesArray = sportTypes
      ? (Array.isArray(sportTypes) ? sportTypes : [sportTypes])
      : undefined;

    const p = page ? parseInt(page as any, 10) : 1;
    const l = limit ? parseInt(limit as any, 10) : 10;

    if (isNaN(p) || isNaN(l) || p <= 0 || l <= 0) {
      throw new BadRequestException('page and limit must be positive integers');
    }

    return this.fieldsService.findPaginated({
      name,
      location,
      sportType,
      sportTypes: sportTypesArray,
      sortBy,
      sortOrder,
      page: p,
      limit: l,
    });
  }

  @Get('nearby')
  @ApiOperation({ summary: 'Find nearby fields within specified radius (Public)' })
  @ApiResponse({ status: 200, description: 'Nearby fields retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid coordinates or radius' })
  async findNearbyFieldsPublic(
    @Query('lat') lat: number,
    @Query('lng') lng: number,
    @Query('radius') radius?: number,
    @Query('limit') limit?: number,
    @Query('sportType') sportType?: string,
    @Query('name') name?: string,
    @Query('location') location?: string,
  ) {
    if (!lat || !lng) {
      throw new BadRequestException('lat and lng parameters are required');
    }

    if (lat < -90 || lat > 90) {
      throw new BadRequestException('Latitude must be between -90 and 90 degrees');
    }

    if (lng < -180 || lng > 180) {
      throw new BadRequestException('Longitude must be between -180 and 180 degrees');
    }

    const searchRadius = radius || 10;
    if (searchRadius <= 0 || searchRadius > 100) {
      throw new BadRequestException('Radius must be between 1 and 100 kilometers');
    }

    const resultLimit = limit || 20;
    if (resultLimit <= 0 || resultLimit > 100) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }

    return this.fieldsService.findNearbyFieldsPublic(lat, lng, searchRadius, resultLimit, sportType, name, location);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get field by ID' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field retrieved successfully', type: FieldsDto })
  @ApiResponse({ status: 400, description: 'Invalid field ID format' })
  @ApiResponse({ status: 404, description: 'Field not found' })
  async findOne(@Param('id') id: string): Promise<FieldsDto> {
    // Validate ObjectId format to prevent CastError
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid field ID format: "${id}". Field ID must be a valid MongoDB ObjectId.`);
    }
    return this.fieldsService.findOne(id);
  }

  @Get(':id/availability')
  @ApiOperation({ summary: 'Get field availability for date range' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field availability retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid field ID format or date range' })
  @ApiResponse({ status: 404, description: 'Field not found' })
  async getAvailability(
    @Param('id') id: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    // Validate ObjectId format to prevent CastError
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid field ID format: "${id}". Field ID must be a valid MongoDB ObjectId.`);
    }
    if (!startDate || !endDate) {
      throw new BadRequestException('startDate and endDate are required');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new BadRequestException('Invalid date format. Use YYYY-MM-DD');
    }

    if (start > end) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    return this.fieldsService.getFieldAvailability(id, start, end);
  }

  @Get(':id/amenities')
  @ApiOperation({ summary: 'Get field amenities' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Field amenities retrieved successfully' })
  @ApiResponse({ status: 400, description: 'Invalid field ID format' })
  @ApiResponse({ status: 404, description: 'Field not found' })
  async getFieldAmenities(@Param('id') fieldId: string) {
    // Validate ObjectId format to prevent CastError
    if (!Types.ObjectId.isValid(fieldId)) {
      throw new BadRequestException(`Invalid field ID format: "${fieldId}". Field ID must be a valid MongoDB ObjectId.`);
    }
    return this.fieldsService.getFieldAmenities(fieldId);
  }

  @Get(':id/bank-account')
  @ApiOperation({ summary: 'Get field owner default verified bank account' })
  @ApiParam({ name: 'id', description: 'Field ID' })
  @ApiResponse({ status: 200, description: 'Bank account retrieved successfully', type: BankAccountResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid field ID format' })
  @ApiResponse({ status: 404, description: 'Field not found or no verified bank account' })
  async getFieldBankAccount(@Param('id') id: string): Promise<BankAccountResponseDto> {
    // Validate ObjectId format to prevent CastError
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid field ID format: "${id}". Field ID must be a valid MongoDB ObjectId.`);
    }
    return this.fieldsService.getFieldOwnerBankAccount(id);
  }
}

