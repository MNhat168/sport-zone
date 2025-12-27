// court.entity.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';

@Schema()
export class Court extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'Field', required: true })
  field: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true, min: 1 })
  courtNumber: number;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;
}

export const CourtSchema = SchemaFactory.createForClass(Court);
configureBaseEntitySchema(CourtSchema);

CourtSchema.index({ field: 1, courtNumber: 1 }, { unique: true });
CourtSchema.index({ field: 1, isActive: 1 });