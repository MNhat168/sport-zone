import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { SportType } from '@common/enums/sport-type.enum';
import { MatchStatus } from '@common/enums/matching.enum';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

export type MatchDocument = Match & Document;

@Schema()
export class Match extends BaseEntity {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    user1Id: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    user2Id: Types.ObjectId;

    @Prop({ type: String, enum: SportType, required: true })
    sportType: SportType;

    @Prop({ type: String, enum: MatchStatus, default: MatchStatus.ACTIVE })
    status: MatchStatus;

    @Prop({ type: Types.ObjectId, ref: 'ChatRoom' })
    chatRoomId?: Types.ObjectId;

    @Prop({ type: Date })
    scheduledDate?: Date;

    @Prop({ type: String })
    scheduledStartTime?: string; // Format: "HH:mm"

    @Prop({ type: String })
    scheduledEndTime?: string; // Format: "HH:mm"

    @Prop({ type: Types.ObjectId, ref: 'Field' })
    fieldId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Court' })
    courtId?: Types.ObjectId;

    @Prop({ type: Types.ObjectId, ref: 'Booking' })
    bookingId?: Types.ObjectId;

    @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
    matchedAt: Date;

    @Prop({ type: Date })
    lastInteractionAt?: Date; // Last message or activity

    @Prop({ type: Boolean, default: false })
    isUnmatchedByUser1: boolean;

    @Prop({ type: Boolean, default: false })
    isUnmatchedByUser2: boolean;

    // Helper method to check if user is part of this match
    isParticipant(userId: string | Types.ObjectId): boolean {
        const userIdStr = userId.toString();
        const u1 = (this.user1Id as any)._id ? (this.user1Id as any)._id.toString() : this.user1Id.toString();
        const u2 = (this.user2Id as any)._id ? (this.user2Id as any)._id.toString() : this.user2Id.toString();
        return u1 === userIdStr || u2 === userIdStr;
    }

    // Helper method to get the other user in the match
    getOtherUserId(userId: string | Types.ObjectId): Types.ObjectId {
        const userIdStr = userId.toString();
        const u1 = (this.user1Id as any)._id ? (this.user1Id as any)._id.toString() : this.user1Id.toString();
        return u1 === userIdStr ? this.user2Id : this.user1Id;
    }
}

export const MatchSchema = SchemaFactory.createForClass(Match);
configureBaseEntitySchema(MatchSchema);

// Indexes for efficient querying
MatchSchema.index({ user1Id: 1, user2Id: 1, sportType: 1 }, { unique: true });
MatchSchema.index({ user1Id: 1, status: 1 });
MatchSchema.index({ user2Id: 1, status: 1 });
MatchSchema.index({ status: 1, scheduledDate: 1 });
MatchSchema.index({ matchedAt: -1 });
MatchSchema.index({ lastInteractionAt: -1 });

// Add methods to schema
MatchSchema.methods.isParticipant = function (userId: string | Types.ObjectId): boolean {
    const userIdStr = userId.toString();
    const u1 = this.user1Id._id ? this.user1Id._id.toString() : this.user1Id.toString();
    const u2 = this.user2Id._id ? this.user2Id._id.toString() : this.user2Id.toString();
    return u1 === userIdStr || u2 === userIdStr;
};

MatchSchema.methods.getOtherUserId = function (userId: string | Types.ObjectId): Types.ObjectId {
    const userIdStr = userId.toString();
    const u1 = this.user1Id._id ? this.user1Id._id.toString() : this.user1Id.toString();
    return u1 === userIdStr ? this.user2Id : this.user1Id;
};
