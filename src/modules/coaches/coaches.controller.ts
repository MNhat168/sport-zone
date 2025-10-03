import { Controller, Get, Param, Query } from '@nestjs/common';
import { CoachesService } from './coaches.service';
import { CoachesDto } from './dtos/coaches.dto';
import { SportType } from 'src/common/enums/sport-type.enum';

@Controller('coaches')
export class CoachesController {
  @Get('all')
  async getAllCoaches(): Promise<any[]> {
    return this.coachesService.getAllCoaches();
  }

  @Get(':id')
  async getCoachById(@Param('id') id: string): Promise<any> {
    return this.coachesService.getCoachById(id);
  }
  constructor(private readonly coachesService: CoachesService) {}

  @Get()
  async findAll(
    @Query('name') name?: string,
    @Query('sportType') sportType?: SportType,
    @Query('minRate') minRate?: number,
    @Query('maxRate') maxRate?: number,
  ): Promise<CoachesDto[]> {
    return this.coachesService.findAll({
      name,
      sportType,
      minRate: minRate ? Number(minRate) : undefined,
      maxRate: maxRate ? Number(maxRate) : undefined,
    });
  }
}
