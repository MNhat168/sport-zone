import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';

@Schema()
export class LessonType extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId;
  
  @Prop({ required: true })
  type: string; // e.g. 'single', 'pair', 'group'

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  description: string;
}

export const LessonTypeSchema = SchemaFactory.createForClass(LessonType);
