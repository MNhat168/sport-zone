import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query,
  UseGuards,
  Request 
} from '@nestjs/common';
import { TournamentService } from './tournaments.service';
import { CreateTournamentDto, RegisterTournamentDto } from './dto/create-tournament.dto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';

@Controller('tournaments')
export class TournamentController {
  constructor(private readonly tournamentService: TournamentService) {}

  @Post()
  @UseGuards(JwtAccessTokenGuard)
  create(@Body() createTournamentDto: CreateTournamentDto, @Request() req) {
    return this.tournamentService.create(createTournamentDto, req.user.userId);
  }

  @Post('register')
  @UseGuards(JwtAccessTokenGuard)
  register(@Body() registerDto: RegisterTournamentDto, @Request() req) {
    return this.tournamentService.registerParticipant(registerDto, req.user.userId);
  }

  @Get()
  findAll(
    @Query('sportType') sportType?: string,
    @Query('location') location?: string,
    @Query('status') status?: string,
  ) {
    const filters: any = {};
    if (sportType) filters.sportType = sportType;
    if (location) filters.location = { $regex: location, $options: 'i' };
    if (status) filters.status = status;

    return this.tournamentService.findAll(filters);
  }

  @Get('available-fields')
  findAvailableFields(
    @Query('sportType') sportType: string,
    @Query('location') location: string,
    @Query('date') date: string,
  ) {
    return this.tournamentService.findAvailableFields(sportType, location, date);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentService.findOne(id);
  }
}