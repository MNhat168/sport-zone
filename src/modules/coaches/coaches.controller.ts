import { Controller, Get, Param, Query, BadRequestException, Put, Body, NotFoundException } from '@nestjs/common';
import { CoachesService } from './coaches.service';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';
import { UpdateCoachDto } from './dtos/update-coach.dto';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('coaches')
export class CoachesController {
  constructor(private readonly coachesService: CoachesService) { }
  @Get('all')
  async getAllCoaches(): Promise<any[]> {
    return this.coachesService.getAllCoaches();
  }

  @Get()
  async findAll(
    @Query('name') name?: string,
    @Query('sportType') sportType?: SportType,
    @Query('minRate') minRate?: number,
    @Query('maxRate') maxRate?: number,
    @Query('district') district?: string,
  ): Promise<CoachesDto[]> {
    return this.coachesService.findAll({
      name,
      sportType,
      minRate: minRate ? Number(minRate) : undefined,
      maxRate: maxRate ? Number(maxRate) : undefined,
      district,
    });
  }

  // GET /coaches/:id
  @Get(':id')
  async getCoachById(@Param('id') coachId: string): Promise<CoachesDto> {
    return this.coachesService.getCoachById(coachId);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update coach information' })
  @ApiResponse({ status: 200, description: 'Coach updated successfully' })
  async updateCoach(@Param('id') coachId: string, @Body() body: UpdateCoachDto): Promise<any> {
    // Delegates to service
    const updated = await this.coachesService.updateCoach(coachId, body);
    if (!updated) throw new NotFoundException('Coach not found');
    return updated;
  }

  // GET /coaches/:id/bank-account
  @Get(':id/bank-account')
  async getCoachBankAccount(@Param('id') coachId: string): Promise<any> {
    return this.coachesService.getCoachBankAccount(coachId);
  }

  // GET /coaches/:id/slots
  @Get(':id/slots')
  async getCoachAvailableSlots(
    @Param('id') coachId: string,
    @Query('date') date: string,
  ): Promise<any> {
    if (!date) {
      throw new BadRequestException('Date parameter is required');
    }
    return this.coachesService.getCoachAvailableSlots(coachId, date);
  }
}
