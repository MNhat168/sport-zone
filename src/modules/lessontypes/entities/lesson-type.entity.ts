import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Document } from 'mongoose';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';

@Schema({
  timestamps: {
    createdAt: true,
    updatedAt: true,
    currentTime: () => getCurrentVietnamTimeForDB(),
  },
})
export class LessonType extends Document {
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
