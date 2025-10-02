import { Module } from '@nestjs/common';
import { AwsS3Service } from './aws-s3.service';
import { GeneratorService } from './generator.service';

@Module({
  providers: [
    AwsS3Service,
    GeneratorService,
  ],
  exports: [
    AwsS3Service,
    GeneratorService,
  ],
})
export class ServiceModule {}