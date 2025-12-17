// court.entity.ts with sportType field
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { FieldSchedulePricingSchema } from 'src/modules/fields/schema/field-schedule-pricing.schema';
import { SportType } from 'src/common/enums/sport-type.enum';

@Schema()
export class Court extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'Field', required: true })
  field: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  courtNumber: number;

  @Prop({ 
    required: true,
    enum: SportType,
    default: SportType.FOOTBALL
  })
  sportType: SportType;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({
    _id: false,
    type: {
      basePrice: { type: Number, min: 0 },
      priceRanges: FieldSchedulePricingSchema.priceRanges,
    },
  })
  pricingOverride?: {
    basePrice?: number;
    priceRanges?: { day: string; start: string; end: string; multiplier: number }[];
  };
}

export const CourtSchema = SchemaFactory.createForClass(Court);
configureBaseEntitySchema(CourtSchema);

CourtSchema.index({ field: 1, courtNumber: 1 }, { unique: true });
CourtSchema.index({ field: 1, isActive: 1 });
CourtSchema.index({ sportType: 1, isActive: 1 });