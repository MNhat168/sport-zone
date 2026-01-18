import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { SportType } from '@common/enums/sport-type.enum';
import { SkillLevel, Gender, GenderPreference } from '@common/enums/matching.enum';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

export type MatchProfileDocument = MatchProfile & Document;

@Schema()
class Location {
    @Prop({ required: true })
    address: string;

    @Prop({
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point',
        },
        coordinates: {
            type: [Number],
            required: true,
        },
    })
    coordinates: {
        type: string;
        coordinates: [number, number]; // [longitude, latitude]
    };

    @Prop({ required: true, default: 10 }) // Default 10km radius
    searchRadius: number; // in kilometers
}

const LocationSchema = SchemaFactory.createForClass(Location);

@Schema()
class TimeSlot {
    @Prop({ required: true, enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] })
    day: string;

    @Prop({ required: true })
    startTime: string; // Format: "HH:mm"

    @Prop({ required: true })
    endTime: string; // Format: "HH:mm"
}

const TimeSlotSchema = SchemaFactory.createForClass(TimeSlot);

@Schema()
export class MatchProfile extends BaseEntity {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true })
    userId: Types.ObjectId;

    @Prop({ type: [String], enum: SportType, required: true })
    sportPreferences: SportType[];

    @Prop({ type: String, enum: SkillLevel, required: true })
    skillLevel: SkillLevel;

    @Prop({ type: LocationSchema, required: true })
    location: Location;

    @Prop({ type: String, enum: Gender, required: true })
    gender: Gender;

    @Prop({ type: String, enum: GenderPreference, default: GenderPreference.ANY })
    preferredGender: GenderPreference;

    @Prop({ type: String, maxlength: 500 })
    bio?: string;

    @Prop({ type: [String], default: [] })
    photos: string[]; // URLs to uploaded photos

    @Prop({ type: [TimeSlotSchema], default: [] })
    availability: TimeSlot[];

    @Prop({ type: Boolean, default: true })
    isActive: boolean;

    @Prop({ type: Number, min: 18, max: 100 })
    age?: number;

    @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
    lastActiveAt: Date;

    // Matching preferences
    @Prop({ type: Number, min: 0, max: 10, default: 1 })
    skillLevelRange: number; // How many levels away to match (0 = exact, 1 = ±1 level, etc.)

    @Prop({ type: Number, min: 18, max: 100 })
    minAge?: number;

    @Prop({ type: Number, min: 18, max: 100 })
    maxAge?: number;
}

export const MatchProfileSchema = SchemaFactory.createForClass(MatchProfile);
configureBaseEntitySchema(MatchProfileSchema);

// Indexes for efficient querying
MatchProfileSchema.index({ userId: 1 });
MatchProfileSchema.index({ 'location.coordinates': '2dsphere' }); // Geospatial index
MatchProfileSchema.index({ sportPreferences: 1 });
MatchProfileSchema.index({ skillLevel: 1 });
MatchProfileSchema.index({ isActive: 1 });
MatchProfileSchema.index({ lastActiveAt: -1 });
