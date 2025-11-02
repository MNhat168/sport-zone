import { Module } from '@nestjs/common';
import { AwsS3Service } from './aws-s3.service';
import { GeneratorService } from './generator.service';
import { PriceFormatService } from './price-format.service';

@Module({
  providers: [
    AwsS3Service,
    GeneratorService,
    PriceFormatService,
  ],
  exports: [
    AwsS3Service,
    GeneratorService,
    PriceFormatService,
  ],
})
export class ServiceModule {}