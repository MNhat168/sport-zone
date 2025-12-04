import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TournamentService } from './tournaments.service';
import { TournamentController } from './tournaments.controller';
import { Tournament, TournamentSchema } from './entities/tournament.entity';
import { 
  TournamentFieldReservation, 
  TournamentFieldReservationSchema 
} from './entities/tournament-field-reservation.entity';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { Transaction, TransactionSchema } from '../transactions/entities/transaction.entity';
import { User, UserSchema } from '@modules/users/entities/user.entity';
import { TransactionsModule } from '@modules/transactions/transactions.module';
import { EmailModule } from '@modules/email/email.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tournament.name, schema: TournamentSchema },
      { name: TournamentFieldReservation.name, schema: TournamentFieldReservationSchema },
      { name: Field.name, schema: FieldSchema },
      { name: Transaction.name, schema: TransactionSchema },
      { name: User.name, schema: UserSchema },
    ]),
     TransactionsModule,
     EmailModule
  ],
  controllers: [TournamentController],
  providers: [TournamentService],
  exports: [TournamentService],
})
export class TournamentModule {}