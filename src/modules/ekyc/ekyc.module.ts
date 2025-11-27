import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { HttpModule } from '@nestjs/axios';
import { EkycService } from './ekyc.service';
import {
  FieldOwnerRegistrationRequest,
  FieldOwnerRegistrationRequestSchema,
} from '../field-owner/entities/field-owner-registration-request.entity';

/**
 * Module xử lý tích hợp didit eKYC
 */
@Module({
  imports: [
    HttpModule,
    MongooseModule.forFeature([
      {
        name: FieldOwnerRegistrationRequest.name,
        schema: FieldOwnerRegistrationRequestSchema,
      },
    ]),
  ],
  providers: [EkycService],
  exports: [EkycService],
})
export class EkycModule {}
