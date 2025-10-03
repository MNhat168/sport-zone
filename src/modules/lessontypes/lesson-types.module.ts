
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { LessonType, LessonTypeSchema } from './entities/lesson-type.entity';
import { LessonTypesService } from './lesson-types.service';
import { LessonTypesController } from './lesson-types.controller';


@Module({
  imports: [
    MongooseModule.forFeature([
      { name: LessonType.name, schema: LessonTypeSchema },
    ]),
  ],
  providers: [LessonTypesService],
  controllers: [LessonTypesController],
  exports: [LessonTypesService],
})
export class LessonTypesModule {}
