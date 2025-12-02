import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Field } from '../../fields/entities/field.entity';

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  FILE = 'file',
  SYSTEM = 'system',
}

export enum ChatStatus {
  ACTIVE = 'active',
  RESOLVED = 'resolved',
  ARCHIVED = 'archived',
}

@Schema()
export class Message {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  sender: Types.ObjectId;

  @Prop({ required: true, enum: MessageType, default: MessageType.TEXT })
  type: MessageType;

  @Prop({ required: true })
  content: string;

  @Prop({ type: [String] })
  attachments?: string[];

  @Prop({ type: Boolean, default: false })
  isRead: boolean;

  @Prop({ type: Date, default: Date.now })
  sentAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

@Schema()
export class ChatRoom extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId; // Customer

  @Prop({ type: Types.ObjectId, ref: 'FieldOwnerProfile', required: true })
  fieldOwner: Types.ObjectId; // Field owner

  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId; // Related field (optional)

  @Prop({ type: String })
  bookingId?: string; // Related booking (optional)

  @Prop({ type: [MessageSchema], default: [] })
  messages: Message[];

  @Prop({ type: String, enum: ChatStatus, default: ChatStatus.ACTIVE })
  status: ChatStatus;

  @Prop({ type: Date, default: Date.now })
  lastMessageAt: Date;

  @Prop({ type: Boolean, default: false })
  hasUnread: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastMessageBy?: Types.ObjectId;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);
ChatRoomSchema.index({ user: 1, fieldOwner: 1, field: 1 }, { unique: true });
ChatRoomSchema.index({ lastMessageAt: -1 });
ChatRoomSchema.index({ user: 1, status: 1 });
ChatRoomSchema.index({ fieldOwner: 1, status: 1 });