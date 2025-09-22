import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Schedule, ScheduleSchema } from './entities/schedule.entity';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';

@Module({
    imports: [
        MongooseModule.forFeature([{ name: Schedule.name, schema: ScheduleSchema }]),
    ],
    controllers: [SchedulesController],
    providers: [SchedulesService],
})
export class SchedulesModule implements OnModuleInit {
    constructor(@InjectModel(Schedule.name) private scheduleModel: Model<Schedule>) { }

    async onModuleInit() {
        await this.scheduleModel.createCollection();
    }
}