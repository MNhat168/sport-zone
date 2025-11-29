import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { SportType } from 'src/common/enums/sport-type.enum';

@Schema({ _id: false })
export class FacilityInfo {
  @Prop({ required: true })
  facilityName: string;

  @Prop({ required: true })
  facilityLocation: string;

  @Prop({ type: [String], enum: SportType })
  supportedSports?: SportType[];

  @Prop({ required: true })
  description: string;

  @Prop({ type: [String] })
  amenities?: string[];

  @Prop({ type: String })
  businessHours?: string;

  @Prop({ type: String, required: true })
  contactPhone: string;

  @Prop({ type: String })
  website?: string;
}

export const FacilityInfoSchema = SchemaFactory.createForClass(FacilityInfo);


