import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  Logger,
  BadRequestException,
  NotFoundException,
  Req,
  Put,
  Delete
} from '@nestjs/common';
import { TournamentService } from './tournaments.service';
import { CreateTournamentDto, UpdateTournamentDto } from './dto/create-tournament.dto';
import { RegisterTournamentDto } from './dto/RegisterTournamentDto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { ApiOperation } from '@nestjs/swagger';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Transaction } from '../transactions/entities/transaction.entity'; // Add this import
import { TransactionStatus } from '@common/enums/transaction.enum'; // Add this import

@Controller('tournaments')
export class TournamentController {
  private readonly logger = new Logger(TournamentService.name);
  payosService: any;
  transactionsService: any;
  eventEmitter: any;

  constructor(
    private readonly tournamentService: TournamentService,
    @InjectModel(Transaction.name) private transactionModel: Model<Transaction> // Add this
  ) { }

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

  @Get('my-tournaments')
  @UseGuards(JwtAccessTokenGuard)
  getMyTournaments(@Request() req) {
    const userId = req.user.userId;
    return this.tournamentService.findTournamentsByOrganizer(userId);
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

  @Get('available-courts')
  findAvailableCourts(
    @Query('sportType') sportType: string,
    @Query('location') location: string,
    @Query('date') date: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    // Add validation
    if (!sportType || !location || !date) {
      throw new BadRequestException('Missing required parameters: sportType, location, date');
    }

    return this.tournamentService.findAvailableCourts(sportType, location, date, startTime, endTime);
  }

  @Get('available-fields')
  findAvailableFields(
    @Query('sportType') sportType: string,
    @Query('location') location: string,
    @Query('date') date: string,
    @Query('startTime') startTime?: string,
    @Query('endTime') endTime?: string,
  ) {
    return this.tournamentService.findAvailableFields(sportType, location, date, startTime, endTime);
  }

  @Get(':id/cancellation-fee')
  @UseGuards(JwtAccessTokenGuard)
  async getCancellationFee(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.tournamentService.getCancellationFee(id, req.user.userId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tournamentService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAccessTokenGuard)
  async updateTournament(
    @Param('id') id: string,
    @Body() updateTournamentDto: UpdateTournamentDto,
    @Request() req
  ) {
    return this.tournamentService.updateTournament(id, updateTournamentDto, req.user.userId);
  }

  @Get('field-owner/requests')
  @UseGuards(JwtAccessTokenGuard)
  async getTournamentRequests(@Request() req) {
    return this.tournamentService.getTournamentRequestsForFieldOwner(req.user.userId);
  }

  @Post('field-owner/requests/:reservationId/accept')
  @UseGuards(JwtAccessTokenGuard)
  async acceptTournamentRequest(
    @Param('reservationId') reservationId: string,
    @Request() req
  ) {
    return this.tournamentService.acceptTournamentRequest(req.user.userId, reservationId);
  }

  @Post('field-owner/requests/:reservationId/reject')
  @UseGuards(JwtAccessTokenGuard)
  async rejectTournamentRequest(
    @Param('reservationId') reservationId: string,
    @Request() req
  ) {
    return this.tournamentService.rejectTournamentRequest(req.user.userId, reservationId);
  }

  @Post(':id/cancel')
  @UseGuards(JwtAccessTokenGuard)
  async cancelTournament(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req
  ) {
    // Default reason if not provided
    const cancellationReason = reason || 'Cancelled by organizer';
    return this.tournamentService.cancelTournament(id, req.user.userId, cancellationReason);
  }
}