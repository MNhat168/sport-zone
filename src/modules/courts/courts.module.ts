import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Court, CourtSchema } from './entities/court.entity';
import { CourtsService } from './courts.service';
import { CourtsController } from './courts.controller';
import { Field, FieldSchema } from '../fields/entities/field.entity';
import { FieldOwnerProfile, FieldOwnerProfileSchema } from '../field-owner/entities/field-owner-profile.entity';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Court.name, schema: CourtSchema },
      { name: Field.name, schema: FieldSchema },
      { name: FieldOwnerProfile.name, schema: FieldOwnerProfileSchema },
    ]),
  ],
  controllers: [CourtsController],
  providers: [CourtsService],
  exports: [MongooseModule, CourtsService],
})
export class CourtsModule {}

