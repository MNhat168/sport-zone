import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { Booking } from '../../bookings/entities/booking.entity';
import { User } from '../../users/entities/user.entity';

@Schema({ timestamps: true })
export class CheckInLog extends Document {
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Booking', required: true })
    booking: Booking | string;

    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
    checkedInBy: User | string;

    @Prop({ required: true })
    checkedInAt: Date;

    @Prop()
    ipAddress: string;

    @Prop()
    deviceInfo: string;

    @Prop({ type: Object })
    tokenPayload: {
        bookingId: string;
        timestamp: number;
        iat: number;
        exp: number;
    };

    @Prop({ default: 'success' })
    status: 'success' | 'failed' | 'reverted';

    @Prop()
    failureReason: string;

    @Prop({ type: Object })
    metadata: Record<string, any>;
}

export const CheckInLogSchema = SchemaFactory.createForClass(CheckInLog);

// Indexes for efficient querying
CheckInLogSchema.index({ booking: 1 });
CheckInLogSchema.index({ checkedInBy: 1 });
CheckInLogSchema.index({ checkedInAt: -1 });
CheckInLogSchema.index({ status: 1 });
