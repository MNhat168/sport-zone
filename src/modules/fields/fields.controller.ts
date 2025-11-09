import { Controller, Get, Query, Param, Post, Body, Delete, Put, UseGuards, Request, UseInterceptors, UploadedFiles, BadRequestException, NotFoundException, Patch, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FieldsService } from './fields.service';
import { FieldsDto, CreateFieldDto, UpdateFieldDto, CreateFieldWithFilesDto, OwnerFieldsResponseDto } from './dtos/fields.dto';
import { FieldOwnerProfileDto, CreateFieldOwnerProfileDto, UpdateFieldOwnerProfileDto } from './dtos/field-owner-profile.dto';
import type { IFile } from '../../interfaces/file.interface';
 

/**
 * Fields Controller with Pure Lazy Creation pattern
 * Manages field CRUD operations and price scheduling
 */
@ApiTags('Fields')
@Controller('fields')
export class FieldsController {
    constructor(private readonly fieldsService: FieldsService) { }

    /**
     * Helper method to get FieldOwnerProfile ID from user ID
     * @param userId - User ID from JWT token
     * @returns FieldOwnerProfile ID
     * @throws NotFoundException if user doesn't have FieldOwnerProfile
     */
    private async getOwnerProfileId(userId: string): Promise<string> {
        const profile = await this.fieldsService.getFieldOwnerProfileByUserId(userId);
        if (!profile) {
            throw new NotFoundException('Field owner profile not found. Please create a field owner profile first.');
        }
        return profile.id;
    }

    /**
     * Get all fields with filtering
     */
    @Get()
    @ApiOperation({ summary: 'Get all fields with filtering' })
    @ApiResponse({ status: 200, description: 'Fields retrieved successfully', type: [FieldsDto] })
    async findAll(
        @Query('name') name?: string,
        @Query('location') location?: string,
        @Query('sportType') sportType?: string,
        @Query('latitude') latitude?: number,
        @Query('longitude') longitude?: number,
        @Query('radius') radius?: number,
    ): Promise<FieldsDto[]> {
        return this.fieldsService.findAll({ 
            name, 
            location, 
            sportType, 
            latitude, 
            longitude, 
            radius 
        });
    }

    /**
     * Find nearby fields within a specified radius (Public endpoint - no auth required)
     */
    @Get('nearby')
    @ApiOperation({ summary: 'Find nearby fields within specified radius (Public)' })
    @ApiResponse({ 
        status: 200, 
        description: 'Nearby fields retrieved successfully',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            id: { type: 'string', example: 'field1' },
                            name: { type: 'string', example: 'Field Name' },
                            location: { type: 'string', example: 'Address' },
                            latitude: { type: 'number', example: 10.762622 },
                            longitude: { type: 'number', example: 106.660172 },
                            distance: { type: 'number', example: 2.5 },
                            rating: { type: 'number', example: 4.5 },
                            price: { type: 'string', example: '100k/h' },
                            sportType: { type: 'string', example: 'FOOTBALL' },
                            images: { type: 'array', items: { type: 'string' } },
                            isActive: { type: 'boolean', example: true }
                        }
                    }
                }
            }
        }
    })
    @ApiResponse({ status: 400, description: 'Invalid coordinates or radius' })
    async findNearbyFieldsPublic(
        @Query('lat') lat: number,
        @Query('lng') lng: number,
        @Query('radius') radius?: number,
        @Query('limit') limit?: number,
        @Query('sportType') sportType?: string,
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

        const searchRadius = radius || 10; // Default 10km radius
        if (searchRadius <= 0 || searchRadius > 100) {
            throw new BadRequestException('Radius must be between 1 and 100 kilometers');
        }

        const resultLimit = limit || 20; // Default 20 results
        if (resultLimit <= 0 || resultLimit > 100) {
            throw new BadRequestException('Limit must be between 1 and 100');
        }

        const data = await this.fieldsService.findNearbyFieldsPublic(lat, lng, searchRadius, resultLimit, sportType);
        // ResponseInterceptor sẽ tự động wrap thành { success: true, data: [...] }
        return data;
    }

    /**
     * Lấy danh sách field của field-owner hiện tại
     */
    @Get('my-fields')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Lấy danh sách field của field-owner hiện tại' })
    @ApiResponse({ 
        status: 200, 
        description: 'Danh sách field của owner được lấy thành công',
        type: OwnerFieldsResponseDto
    })
    @ApiResponse({ status: 401, description: 'Unauthorized - Token required' })
    async getMyFields(
        @Request() req: any,
        @Query('name') name?: string,
        @Query('sportType') sportType?: string,
        @Query('isActive') isActive?: boolean,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 10,
    ): Promise<OwnerFieldsResponseDto> {
        const ownerId = req.user._id || req.user.id;
        return this.fieldsService.findByOwner(ownerId, {
            name,
            sportType,
            isActive,
            page: Number(page),
            limit: Number(limit)
        });
    }

    // ============================================================================
    // FIELD OWNER PROFILE ENDPOINTS (placed BEFORE dynamic :id routes)
    // ============================================================================

    /**
     * Tạo FieldOwnerProfile mới
     */
    @Post('owner-profile')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Tạo FieldOwnerProfile mới (Field Owner only)' })
    @ApiResponse({
        status: 201,
        description: 'FieldOwnerProfile được tạo thành công',
        type: FieldOwnerProfileDto
    })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 400, description: 'Bad Request - User already has profile or validation failed' })
    async createFieldOwnerProfile(
        @Request() req: any,
        @Body() createDto: CreateFieldOwnerProfileDto,
    ): Promise<FieldOwnerProfileDto> {
        if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
            throw new ForbiddenException('Access denied. Field owner only.');
        }
        const userId = req.user._id || req.user.id;
        return this.fieldsService.createFieldOwnerProfile(userId, createDto);
    }

    /**
     * Lấy FieldOwnerProfile của user hiện tại
     */
    @Get('owner-profile')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Lấy FieldOwnerProfile của user hiện tại' })
    @ApiResponse({
        status: 200,
        description: 'FieldOwnerProfile được lấy thành công',
        type: FieldOwnerProfileDto
    })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 404, description: 'FieldOwnerProfile not found' })
    async getMyFieldOwnerProfile(@Request() req: any): Promise<FieldOwnerProfileDto> {
        if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
            throw new ForbiddenException('Access denied. Field owner only.');
        }
        const userId = req.user._id || req.user.id;
        const profile = await this.fieldsService.getFieldOwnerProfileByUserId(userId);
        if (!profile) {
            throw new NotFoundException('Field owner profile not found');
        }
        return profile;
    }

    /**
     * Cập nhật FieldOwnerProfile
     */
    @Patch('owner-profile')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Cập nhật FieldOwnerProfile (Field Owner only)' })
    @ApiResponse({
        status: 200,
        description: 'FieldOwnerProfile được cập nhật thành công',
        type: FieldOwnerProfileDto
    })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 404, description: 'FieldOwnerProfile not found' })
    @ApiResponse({ status: 400, description: 'Validation failed' })
    async updateFieldOwnerProfile(
        @Request() req: any,
        @Body() updateDto: UpdateFieldOwnerProfileDto,
    ): Promise<FieldOwnerProfileDto> {
        if ((req.user?.role || '').toLowerCase() !== 'field_owner') {
            throw new ForbiddenException('Access denied. Field owner only.');
        }
        const userId = req.user._id || req.user.id;
        return this.fieldsService.updateFieldOwnerProfile(userId, updateDto);
    }

    /**
     * Lấy FieldOwnerProfile theo profile ID (Public endpoint)
     */
    @Get('owner-profile/:id')
    @ApiOperation({ summary: 'Lấy FieldOwnerProfile theo ID (Public)' })
    @ApiParam({ name: 'id', description: 'FieldOwnerProfile ID' })
    @ApiResponse({
        status: 200,
        description: 'FieldOwnerProfile được lấy thành công',
        type: FieldOwnerProfileDto
    })
    @ApiResponse({ status: 404, description: 'FieldOwnerProfile not found' })
    async getFieldOwnerProfile(@Param('id') id: string): Promise<FieldOwnerProfileDto> {
        return this.fieldsService.getFieldOwnerProfile(id);
    }

    /**
     * Get field by ID
     */
    @Get(':id')
    @ApiOperation({ summary: 'Get field by ID' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field retrieved successfully', type: FieldsDto })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async findOne(@Param('id') id: string): Promise<FieldsDto> {
        return this.fieldsService.findOne(id);
    }

    /**
     * Get field availability for date range
     */
    @Get(':id/availability')
    @ApiOperation({ summary: 'Get field availability for date range with dynamic pricing' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field availability retrieved successfully' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    @ApiResponse({ status: 400, description: 'Invalid date range' })
    async getAvailability(
        @Param('id') id: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
    ) {
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

    /**
     * Create new field
     */
    @Post()
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Create new field (Field Owner only)' })
    @ApiResponse({ status: 201, description: 'Field created successfully', type: FieldsDto })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 400, description: 'Validation failed' })
    async create(
        @Request() req,
        @Body() createFieldDto: CreateFieldDto,
    ): Promise<FieldsDto> {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        return this.fieldsService.create(createFieldDto, ownerId);
    }

    /**
     * Create new field with image upload support
     */
    @Post('with-images')
    @UseInterceptors(FilesInterceptor('images', 10)) // Max 10 images
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiConsumes('multipart/form-data')
    @ApiOperation({ summary: 'Create new field with image uploads (Field Owner only)' })
    @ApiResponse({ status: 201, description: 'Field created successfully with images', type: FieldsDto })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 400, description: 'Validation failed or file upload error' })
    async createWithImages(
        @Request() req,
        @Body() createFieldDto: CreateFieldWithFilesDto,
        @UploadedFiles() files: IFile[],
    ): Promise<FieldsDto> {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        return this.fieldsService.createWithFiles(createFieldDto, files, ownerId);
    }

    /**
     * Update field information
     */
    @Put(':id')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update field information (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field updated successfully', type: FieldsDto })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async update(
        @Request() req,
        @Param('id') id: string,
        @Body() updateFieldDto: UpdateFieldDto,
    ): Promise<FieldsDto> {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        return this.fieldsService.update(id, updateFieldDto, ownerId);
    }

    /**
     * Delete field
     */
    @Delete(':id')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Delete field (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field deleted successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async delete(
        @Request() req,
        @Param('id') id: string,
    ): Promise<{ success: boolean; message: string }> {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        return this.fieldsService.delete(id, ownerId);
    }

    /**
     * Schedule price update for field
     */
    @Post(':id/schedule-price-update')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Schedule price update for field (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 201, description: 'Price update scheduled successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async schedulePriceUpdate(
        @Request() req,
        @Param('id') fieldId: string,
        @Body() body: {
            newOperatingHours: { day: string; start: string; end: string; duration: number }[];
            newPriceRanges: { day: string; start: string; end: string; multiplier: number }[];
            newBasePrice: number;
            effectiveDate: string; // ISO date string
        },
    ) {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        const effectiveDate = new Date(body.effectiveDate);
        return this.fieldsService.schedulePriceUpdate(
            fieldId,
            body.newOperatingHours,
            body.newPriceRanges,
            body.newBasePrice,
            effectiveDate,
            ownerId,
        );
    }

    /**
     * Cancel scheduled price update
     */
    @Delete(':id/scheduled-price-update')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Cancel scheduled price update (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Scheduled price update cancelled successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field or scheduled update not found' })
    async cancelScheduledPriceUpdate(
        @Request() req,
        @Param('id') fieldId: string,
        @Body() body: { effectiveDate: string },
    ): Promise<{ success: boolean }> {
        const ownerId = req.user._id || req.user.id;
        const effectiveDate = new Date(body.effectiveDate);
        const success = await this.fieldsService.cancelScheduledPriceUpdate(fieldId, effectiveDate);
        return { success };
    }

    /**
     * Get scheduled price updates for field
     */
    @Get(':id/scheduled-price-updates')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Get scheduled price updates (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Scheduled price updates retrieved successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async getScheduledPriceUpdates(
        @Request() req,
        @Param('id') fieldId: string,
    ) {
        const ownerId = req.user._id || req.user.id;
        return this.fieldsService.getScheduledPriceUpdates(fieldId);
    }


    /**
     * Lấy danh sách booking hôm nay của các sân thuộc field-owner
     */
    @Get('my-fields/today-bookings')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ 
        summary: 'Lấy danh sách booking hôm nay của field-owner',
        description: 'Lấy tất cả booking hôm nay của các sân thuộc field-owner hiện tại, kèm thông tin khách hàng'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Danh sách booking hôm nay được lấy thành công',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                data: {
                    type: 'array',
                    items: {
                        type: 'object',
                        properties: {
                            bookingId: { type: 'string', example: '507f1f77bcf86cd799439011' },
                            fieldId: { type: 'string', example: '507f1f77bcf86cd799439012' },
                            fieldName: { type: 'string', example: 'Sân Bóng Đá ABC' },
                            date: { type: 'string', example: '2025-10-19' },
                            startTime: { type: 'string', example: '08:00' },
                            endTime: { type: 'string', example: '10:00' },
                            status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'] },
                            totalPrice: { type: 'number', example: 200000 },
                            customer: {
                                type: 'object',
                                properties: {
                                    fullName: { type: 'string', example: 'Nguyễn Văn A' },
                                    phone: { type: 'string', example: '0123456789' },
                                    email: { type: 'string', example: 'customer@example.com' }
                                }
                            },
                            selectedAmenities: {
                                type: 'array',
                                items: { type: 'string' }
                            }
                        }
                    }
                }
            }
        }
    })
    @ApiResponse({ status: 401, description: 'Unauthorized - Token required' })
    @ApiResponse({ status: 403, description: 'Forbidden - User is not a field owner' })
    @ApiResponse({ status: 404, description: 'Not Found - User not found' })
    @ApiResponse({ status: 400, description: 'Bad Request - Invalid user ID format' })
    async getTodayBookings(@Request() req: any) {
        const userId = req.user._id || req.user.id;
        return this.fieldsService.getTodayBookingsByOwner(userId);
    }

    /**
     * Lấy tất cả booking của các sân thuộc field-owner với filter và pagination lưu ý là các sân được active
     */
    @Get('my-fields/bookings')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ 
        summary: 'Lấy tất cả booking của field-owner với filter',
        description: 'Lấy tất cả booking của các sân thuộc field-owner với khả năng filter theo tên sân, trạng thái, ngày'
    })
    @ApiResponse({ 
        status: 200, 
        description: 'Danh sách booking được lấy thành công',
        schema: {
            type: 'object',
            properties: {
                success: { type: 'boolean', example: true },
                data: {
                    type: 'object',
                    properties: {
                        bookings: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    bookingId: { type: 'string', example: '507f1f77bcf86cd799439011' },
                                    fieldId: { type: 'string', example: '507f1f77bcf86cd799439012' },
                                    fieldName: { type: 'string', example: 'Sân Bóng Đá ABC' },
                                    date: { type: 'string', example: '2025-10-19' },
                                    startTime: { type: 'string', example: '08:00' },
                                    endTime: { type: 'string', example: '10:00' },
                                    status: { type: 'string', enum: ['pending', 'confirmed', 'cancelled', 'completed'] },
                                    totalPrice: { type: 'number', example: 200000 },
                                    customer: {
                                        type: 'object',
                                        properties: {
                                            fullName: { type: 'string', example: 'Nguyễn Văn A' },
                                            phone: { type: 'string', example: '0123456789' },
                                            email: { type: 'string', example: 'customer@example.com' }
                                        }
                                    },
                                    selectedAmenities: {
                                        type: 'array',
                                        items: { type: 'string' }
                                    }
                                }
                            }
                        },
                        pagination: {
                            type: 'object',
                            properties: {
                                total: { type: 'number', example: 100 },
                                page: { type: 'number', example: 1 },
                                limit: { type: 'number', example: 10 },
                                totalPages: { type: 'number', example: 10 },
                                hasNextPage: { type: 'boolean', example: true },
                                hasPrevPage: { type: 'boolean', example: false }
                            }
                        }
                    }
                }
            }
        }
    })
    @ApiResponse({ status: 401, description: 'Unauthorized - Token required' })
    @ApiResponse({ status: 403, description: 'Forbidden - User is not a field owner' })
    @ApiResponse({ status: 404, description: 'Not Found - User not found' })
    @ApiResponse({ status: 400, description: 'Bad Request - Invalid user ID format' })
    async getAllBookings(
        @Request() req: any,
        @Query('fieldName') fieldName?: string,
        @Query('status') status?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('page') page: number = 1,
        @Query('limit') limit: number = 10,
    ) {
        const userId = req.user._id || req.user.id;
        
        const queryParams = {
            fieldName,
            status,
            startDate,
            endDate,
            page: Number(page),
            limit: Number(limit)
        };
        
        try {
            const result = await this.fieldsService.getAllBookingsByOwner(userId, queryParams);
            return result;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get field amenities
     */
    @Get(':id/amenities')
    @ApiOperation({ summary: 'Get field amenities' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field amenities retrieved successfully' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async getFieldAmenities(@Param('id') fieldId: string) {
        return this.fieldsService.getFieldAmenities(fieldId);
    }



    /**
     * Update field amenities (replace all)
     */
    @Put(':id/amenities')
    @UseGuards(AuthGuard('jwt'))
    @ApiBearerAuth()
    @ApiOperation({ summary: 'Update field amenities (Field Owner only)' })
    @ApiParam({ name: 'id', description: 'Field ID' })
    @ApiResponse({ status: 200, description: 'Field amenities updated successfully' })
    @ApiResponse({ status: 401, description: 'Unauthorized' })
    @ApiResponse({ status: 403, description: 'Access denied. Field owner only.' })
    @ApiResponse({ status: 404, description: 'Field not found' })
    async updateFieldAmenities(
        @Request() req,
        @Param('id') fieldId: string,
        @Body() body: { amenities: Array<{ amenityId: string; price: number }> },
    ) {
        const userId = req.user._id || req.user.id || req.user.userId;
        const ownerId = await this.getOwnerProfileId(userId);
        return this.fieldsService.updateFieldAmenities(fieldId, body.amenities, ownerId);
    }

    // (removed duplicate Field Owner Profile endpoints defined earlier)
}
