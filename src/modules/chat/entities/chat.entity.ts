import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { BaseEntity } from 'src/common/entities/base.entity';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';
import { User } from '../../users/entities/user.entity';
import { Field } from '../../fields/entities/field.entity';
import { MessageType, ChatStatus } from '@common/enums/chat.enum';

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

  @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
  sentAt: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

@Schema()
export class ChatRoom extends BaseEntity {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user: Types.ObjectId; // Customer

  @Prop({ type: Types.ObjectId, ref: 'FieldOwnerProfile', required: false })
  fieldOwner?: Types.ObjectId; // Field owner (optional for coach chats)

  @Prop({ type: Types.ObjectId, ref: 'CoachProfile', required: false })
  coach?: Types.ObjectId; // Coach participant (optional)

  @Prop({ type: Types.ObjectId, ref: 'Field' })
  field?: Types.ObjectId; // Related field (optional)

  @Prop({ type: String })
  bookingId?: string; // Related booking (optional)

  @Prop({ type: [MessageSchema], default: [] })
  messages: Message[];

  @Prop({ type: String, enum: ChatStatus, default: ChatStatus.ACTIVE })
  status: ChatStatus;

  @Prop({ type: Date, default: () => getCurrentVietnamTimeForDB() })
  lastMessageAt: Date;

  @Prop({ type: Boolean, default: false })
  hasUnread: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  lastMessageBy?: Types.ObjectId;
}

export const ChatRoomSchema = SchemaFactory.createForClass(ChatRoom);
// Unique constraints per chat type with partial filters
ChatRoomSchema.index(
  { user: 1, fieldOwner: 1, field: 1 },
  { unique: true, partialFilterExpression: { fieldOwner: { $exists: true } } }
);
ChatRoomSchema.index(
  { user: 1, coach: 1 },
  { unique: true, partialFilterExpression: { coach: { $exists: true } } }
);
// Common indices
ChatRoomSchema.index({ lastMessageAt: -1 });
ChatRoomSchema.index({ user: 1, status: 1 });
ChatRoomSchema.index({ fieldOwner: 1, status: 1 }, { partialFilterExpression: { fieldOwner: { $exists: true } } });
ChatRoomSchema.index({ coach: 1, status: 1 }, { partialFilterExpression: { coach: { $exists: true } } });