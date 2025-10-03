import { Module, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Schedule} from './entities/schedule.entity';
import { ScheduleSchema } from './schema/ScheduleSchema';
import { MongooseModule } from '@nestjs/mongoose';
import { SchedulesController } from './schedules.controller';
import { SchedulesService } from './schedules.service';
import { Booking } from '../bookings/entities/booking.entity';
import { BookingSchema } from '../bookings/schema/BookingSchema';
import { Field } from '../fields/entities/field.entity';
import { FieldSchema } from '../fields/schema/field-schema';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
    imports: [
        MongooseModule.forFeature([
            { name: Schedule.name, schema: ScheduleSchema },
            { name: Booking.name, schema: BookingSchema },
            { name: Field.name, schema: FieldSchema }
        ]),
        BookingsModule,
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