import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { BaseEntity, configureBaseEntitySchema } from 'src/common/entities/base.entity';
import { User } from '../../users/entities/user.entity';

export type InvoiceDocument = HydratedDocument<Invoice>;

export enum InvoiceStatus {
    PENDING = 'pending',
    PAID = 'paid',
    OVERDUE = 'overdue',
    CANCELLED = 'cancelled', // e.g., if user deletes account
    FAILED = 'failed',
}

@Schema()
export class Invoice extends BaseEntity {
    @Prop({ type: Types.ObjectId, ref: 'User', required: true })
    user: User | Types.ObjectId;

    @Prop({ required: true, type: Number })
    amount: number;

    @Prop({ required: true, enum: InvoiceStatus, default: InvoiceStatus.PENDING })
    status: InvoiceStatus;

    @Prop({ required: true, type: Number })
    month: number; // 1-12

    @Prop({ required: true, type: Number })
    year: number;

    @Prop({ required: true, type: Date })
    dueDate: Date;

    @Prop({ type: Date })
    paidAt?: Date;

    @Prop({ type: Number })
    payosOrderCode?: number; // Linked order code for payment gateway
}

export const InvoiceSchema = SchemaFactory.createForClass(Invoice);

configureBaseEntitySchema(InvoiceSchema);

// Indexes for faster queries
InvoiceSchema.index({ user: 1, month: 1, year: 1 }, { unique: true }); // Prevent duplicate invoices for same user/month
InvoiceSchema.index({ status: 1 });
InvoiceSchema.index({ dueDate: 1 });
