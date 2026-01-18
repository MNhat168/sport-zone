import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { SportType } from '@common/enums/sport-type.enum';
import { SwipeAction } from '@common/enums/matching.enum';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

export type SwipeDocument = Swipe & Document;

@Schema()
export class Swipe extends BaseEntity {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    userId: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    targetUserId: Types.ObjectId;

    @Prop({ type: String, enum: SwipeAction, required: true })
    action: SwipeAction;

    @Prop({ type: String, enum: SportType, required: true })
    sportType: SportType;

    @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
    timestamp: Date;
}

export const SwipeSchema = SchemaFactory.createForClass(Swipe);
configureBaseEntitySchema(SwipeSchema);

// Compound index to prevent duplicate swipes and enable fast lookups
SwipeSchema.index({ userId: 1, targetUserId: 1, sportType: 1 }, { unique: true });
SwipeSchema.index({ targetUserId: 1, action: 1 }); // For checking if target liked back
SwipeSchema.index({ userId: 1, timestamp: -1 }); // For user's swipe history
SwipeSchema.index({ timestamp: -1 }); // For cleanup of old swipes
