import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';

@Schema()
export class FieldQrCode extends BaseEntity {
    @Prop({ type: Types.ObjectId, ref: 'Field', required: true, unique: true })
    field: Types.ObjectId;

    @Prop({ type: String, required: true, unique: true })
    qrToken: string; // Static JWT token for this field

    @Prop({ type: Date })
    generatedAt: Date;

    @Prop({ type: Boolean, default: true })
    isActive: boolean;

    @Prop({ type: Types.ObjectId, ref: 'User' })
    generatedBy?: Types.ObjectId; // Field owner who generated it
}

export const FieldQrCodeSchema = SchemaFactory.createForClass(FieldQrCode);
