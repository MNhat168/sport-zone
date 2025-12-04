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
  Req
} from '@nestjs/common';
import { TournamentService } from './tournaments.service';
import { CreateTournamentDto, RegisterTournamentDto } from './dto/create-tournament.dto';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { ApiOperation } from '@nestjs/swagger';

@Controller('tournaments')
export class TournamentController {
  private readonly logger = new Logger(TournamentService.name);
  payosService: any;
  transactionsService: any;
  eventEmitter: any;
  
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

        // Find local transaction
        const transaction = await this.transactionsService.getPaymentByExternalId(String(orderCode));

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
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

        // Emit payment event based on status
        if (paymentStatus === 'succeeded') {
            this.eventEmitter.emit('payment.success', {
                paymentId: transaction._id.toString(),
                tournamentId: tournamentId,
                userId: transaction.user.toString(),
                amount: transaction.amount,
                method: transaction.method,
                transactionId: payosTransaction.reference,
            });
        } else if (paymentStatus === 'failed') {
            this.eventEmitter.emit('payment.failed', {
                paymentId: transaction._id.toString(),
                tournamentId: tournamentId,
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
            tournamentId,
            message: paymentStatus === 'succeeded' 
                ? 'Payment successful! You are now registered.' 
                : 'Payment failed',
        };

    } catch (error) {
        this.logger.error('Error handling tournament payment return:', error);
        throw new BadRequestException('Error verifying payment');
    }
}
}