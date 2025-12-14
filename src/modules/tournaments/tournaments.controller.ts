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

  @Get('available-courts') // New endpoint
  // In tournaments.controller.ts
  @Get('available-courts')
  findAvailableCourts(
    @Query('sportType') sportType: string,
    @Query('location') location: string,
    @Query('date') date: string,
  ) {
    // Add validation
    if (!sportType || !location || !date) {
      throw new BadRequestException('Missing required parameters: sportType, location, date');
    }

    return this.tournamentService.findAvailableCourts(sportType, location, date);
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

  @Get(':id/payment-return')
  @ApiOperation({ summary: 'Handle tournament payment return from PayOS' })
  async handleTournamentPaymentReturn(
    @Param('id') tournamentId: string,
    @Query() query: any,
    @Req() req: Request
  ) {
    try {
      const { orderCode, status } = query;

      if (!orderCode) {
        throw new BadRequestException('Missing order code');
      }

      // Query PayOS for transaction status
      const payosTransaction = await this.payosService.queryTransaction(Number(orderCode));

      // Find local transaction by externalTransactionId
      const transaction = await this.transactionModel.findOne({
        externalTransactionId: String(orderCode)
      });

      if (!transaction) {
        throw new NotFoundException('Transaction not found');
      }

      // Get tournament ID from transaction metadata (more reliable than URL param)
      const transactionTournamentId = transaction.metadata?.tournamentId || tournamentId;
      
      if (!transactionTournamentId) {
        throw new BadRequestException('Tournament ID not found in transaction');
      }

      // Determine status
      let paymentStatus: 'succeeded' | 'failed' | 'pending';

      if (payosTransaction.status === 'PAID') {
        paymentStatus = 'succeeded';
      } else if (payosTransaction.status === 'CANCELLED' || payosTransaction.status === 'EXPIRED') {
        paymentStatus = 'failed';
      } else {
        paymentStatus = 'pending';
      }

      // Update transaction status
      if (paymentStatus === 'succeeded') {
        transaction.status = TransactionStatus.SUCCEEDED;
        transaction.completedAt = new Date();
      } else if (paymentStatus === 'failed') {
        transaction.status = TransactionStatus.FAILED;
      }
      await transaction.save();

      // Emit payment event based on status
      if (paymentStatus === 'succeeded') {
        this.eventEmitter.emit('payment.success', {
          paymentId: (transaction._id as Types.ObjectId).toString(),
          tournamentId: transactionTournamentId, // Use from metadata
          userId: transaction.user.toString(),
          amount: transaction.amount,
          method: transaction.method,
          transactionId: payosTransaction.reference,
        });
      } else if (paymentStatus === 'failed') {
        this.eventEmitter.emit('payment.failed', {
          paymentId: (transaction._id as Types.ObjectId).toString(),
          tournamentId: transactionTournamentId, // Use from metadata
          userId: transaction.user.toString(),
          amount: transaction.amount,
          method: transaction.method,
          transactionId: payosTransaction.reference,
          reason: payosTransaction.status === 'CANCELLED'
            ? 'Transaction cancelled'
            : 'Transaction expired',
        });
      }

      return {
        success: paymentStatus === 'succeeded',
        paymentStatus,
        tournamentId: transactionTournamentId,
        message: paymentStatus === 'succeeded'
          ? 'Payment successful! You are now registered.'
          : 'Payment failed',
      };

    } catch (error) {
      this.logger.error('Error handling tournament payment return:', error);
      throw new BadRequestException('Error verifying payment');
    }
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

  @Delete(':id')
  @UseGuards(JwtAccessTokenGuard)
  async cancelTournament(
    @Param('id') id: string,
    @Request() req
  ) {
    return this.tournamentService.cancelTournament(id, req.user.userId);
  }
}