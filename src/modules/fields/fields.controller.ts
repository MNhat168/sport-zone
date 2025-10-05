import { Controller, Get, Query, Param, Post, Body, Delete, Put, UseGuards, Request, UseInterceptors, UploadedFiles, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FilesInterceptor } from '@nestjs/platform-express';
import { FieldsService } from './fields.service';
import { FieldsDto, CreateFieldDto, UpdateFieldDto, CreateFieldWithFilesDto } from './dtos/fields.dto';
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
     * Get all fields with filtering
     */
    @Get()
    @ApiOperation({ summary: 'Get all fields with filtering' })
    @ApiResponse({ status: 200, description: 'Fields retrieved successfully', type: [FieldsDto] })
    async findAll(
        @Query('name') name?: string,
        @Query('location') location?: string,
        @Query('sportType') sportType?: string,
    ): Promise<FieldsDto[]> {
        return this.fieldsService.findAll({ name, location, sportType });
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
        const ownerId = req.user._id || req.user.id;
        return this.fieldsService.create(createFieldDto, ownerId);
    }

    /**
     * Create new field with image upload support
     */
    @Post('with-images')
    @UseGuards(AuthGuard('jwt'))
    @UseInterceptors(FilesInterceptor('images', 10)) // Max 10 images
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
        const ownerId = req.user._id || req.user.id;
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
        const ownerId = req.user._id || req.user.id;
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
        const ownerId = req.user._id || req.user.id;
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
        const ownerId = req.user._id || req.user.id;
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
}
