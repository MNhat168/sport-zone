import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types, HydratedDocument } from 'mongoose';
import { SportType, AmenityType } from 'src/common/enums/sport-type.enum';

export type AmenityDocument = HydratedDocument<Amenity>;

@Schema()
export class Amenity extends Document {
  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: String, enum: SportType })
  sportType: SportType;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: String })
  imageUrl: string;

  @Prop({ type: String, enum: AmenityType })
  type: AmenityType;
}

export const AmenitySchema = SchemaFactory.createForClass(Amenity);