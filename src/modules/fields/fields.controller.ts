import { Controller, Get, Query, Param, Post, Body, Delete, Put, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { FieldsService } from './fields.service';
import { FieldsDto, CreateFieldDto, UpdateFieldDto } from './dtos/fields.dto';

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

    // Schedule price update
    @Post(':id/schedule-price-update')
    async schedulePriceUpdate(
        @Param('id') fieldId: string,
        @Body() body: {
            newPriceRanges: { start: string; end: string; multiplier: number }[];
            newBasePrice: number;
            effectiveDate: string; // ISO date string
            ownerId: string; // TODO: lấy từ JWT thay vì body
        },
    ) {
        const effectiveDate = new Date(body.effectiveDate);
        return this.fieldsService.schedulePriceUpdate(
            fieldId,
            body.newPriceRanges,
            body.newBasePrice,
            effectiveDate,
            body.ownerId,
        );
    }

    // Cancel scheduled price update
    @Delete(':id/scheduled-price-update')
    async cancelScheduledPriceUpdate(
        @Param('id') fieldId: string,
        @Body() body: { effectiveDate: string },
    ): Promise<{ success: boolean }> {
        const effectiveDate = new Date(body.effectiveDate);
        const success = await this.fieldsService.cancelScheduledPriceUpdate(fieldId, effectiveDate);
        return { success };
    }

    // Get scheduled price updates
    @Get(':id/scheduled-price-updates')
    async getScheduledPriceUpdates(
        @Param('id') fieldId: string,
    ) {
        return this.fieldsService.getScheduledPriceUpdates(fieldId);
    }
}
