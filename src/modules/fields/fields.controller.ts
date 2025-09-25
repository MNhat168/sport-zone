import { Controller, Get, Query, Param } from '@nestjs/common';
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
}
