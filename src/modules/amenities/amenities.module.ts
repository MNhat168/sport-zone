import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AmenitiesService } from './amenities.service';
import { AmenitiesController } from './amenities.controller';
import { Amenity, AmenitySchema, AmenityDocument } from './entities/amenities.entity';
import { AmenityRepository } from './repositories/amenity.repository';
import { AmenityRepositoryInterface, AMENITY_REPOSITORY } from './interface/amenities.interface';
import { ServiceModule } from 'src/service/service.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Amenity.name, schema: AmenitySchema }]),
    ServiceModule,
  ],
  controllers: [AmenitiesController],
  providers: [
    AmenitiesService,
    {
      provide: AMENITY_REPOSITORY,
      useClass: AmenityRepository,
    },
  ],
  exports: [AmenitiesService, AMENITY_REPOSITORY],
})
export class AmenitiesModule {}
