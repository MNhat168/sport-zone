import { Controller, Get, Query, Param, Post, Body, Delete } from '@nestjs/common';
import { FieldsService } from './fields.service';
import { FieldsDto } from './dtos/fields.dto';

@Controller('fields')
export class FieldsController {
    constructor(private readonly fieldsService: FieldsService) { }

    @Get()
    async findAll(
        @Query('name') name?: string,
        @Query('location') location?: string,
        @Query('sportType') sportType?: string,
    ): Promise<FieldsDto[]> {
        return this.fieldsService.findAll({ name, location, sportType });
    }

    @Get(':id')
    async findOne(@Param('id') id: string): Promise<FieldsDto> {
        return this.fieldsService.findOne(id);
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
