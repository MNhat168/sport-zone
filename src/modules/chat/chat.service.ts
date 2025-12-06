import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatRoom, Message } from './entities/chat.entity';
import { ChatStatus, MessageType } from '@common/enums/chat.enum';
import { User } from '../users/entities/user.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { Field } from '../fields/entities/field.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatRoom.name) private chatModel: Model<ChatRoom>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(FieldOwnerProfile.name) private fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(Field.name) private fieldModel: Model<Field>,
  ) { }

  async createOrGetChatRoom(
    userId: string,
    fieldOwnerId: string,
    fieldId?: string,
    bookingId?: string,
  ): Promise<ChatRoom> {
    // Validate user
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Validate field owner
    const fieldOwner = await this.fieldOwnerProfileModel.findById(fieldOwnerId);
    if (!fieldOwner) throw new NotFoundException('Field owner not found');

    // Validate field if provided
    if (fieldId) {
      const field = await this.fieldModel.findById(fieldId);
      if (!field) throw new NotFoundException('Field not found');
      if (field.owner.toString() !== fieldOwnerId) {
        throw new BadRequestException('Field does not belong to this field owner');
      }
    }

    const query: any = {
      user: new Types.ObjectId(userId),
      fieldOwner: new Types.ObjectId(fieldOwnerId),
      status: ChatStatus.ACTIVE,
    };

    if (fieldId) {
      query.field = new Types.ObjectId(fieldId);
    } else {
      query.field = { $exists: false };
    }

    const existingChat = await this.chatModel
      .findOne(query)
      .populate('user', 'fullName avatarUrl')
      .populate('fieldOwner', 'facilityName')
      .populate('field', 'name images sportType')
      .exec();

    if (existingChat) {
      return existingChat;
    }

    // Create new chat room with empty messages array
    const newChat = new this.chatModel({
      user: new Types.ObjectId(userId),
      fieldOwner: new Types.ObjectId(fieldOwnerId),
      field: fieldId ? new Types.ObjectId(fieldId) : undefined,
      bookingId,
      messages: [], // Explicitly empty array
      status: ChatStatus.ACTIVE,
      lastMessageAt: new Date(),
      hasUnread: false,
    });

    const savedChat = await newChat.save();

    // Populate and return
    const populatedChat = await this.chatModel
      .findById(savedChat._id)
      .populate('user', 'fullName avatarUrl')
      .populate('fieldOwner', 'facilityName')
      .populate('field', 'name images sportType')
      .exec();

    if (!populatedChat) {
      throw new NotFoundException('Chat room not found after creation');
    }

    return populatedChat;
  }

  async sendMessage(
    chatRoomId: string,
    senderId: string,
    content: string,
    type: MessageType = MessageType.TEXT,
    attachments?: string[],
  ): Promise<Message> {
    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify sender is either user or field owner
    if (
      chatRoom.user.toString() !== senderId &&
      chatRoom.fieldOwner.toString() !== senderId
    ) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    const newMessage: Message = {
      sender: new Types.ObjectId(senderId),
      type,
      content,
      attachments,
      isRead: false,
      sentAt: new Date(),
    };

    chatRoom.messages.push(newMessage);
    chatRoom.lastMessageAt = new Date();
    chatRoom.lastMessageBy = new Types.ObjectId(senderId);
    chatRoom.hasUnread = chatRoom.user.toString() !== senderId; // Mark as unread for receiver

    await chatRoom.save();

    return newMessage;
  }

  async getChatRoomsForUser(userId: string): Promise<ChatRoom[]> {
    return this.chatModel
      .find({
        $or: [
          { user: new Types.ObjectId(userId) },
          { fieldOwner: new Types.ObjectId(userId) },
        ],
        status: ChatStatus.ACTIVE,
      })
      .populate('user', 'fullName avatarUrl')
      .populate('fieldOwner', 'facilityName')
      .populate('field', 'name images sportType')
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  async getChatRoomMessages(chatRoomId: string, userId: string): Promise<ChatRoom> {
    // Validate IDs
    if (!chatRoomId || !Types.ObjectId.isValid(chatRoomId)) {
      throw new BadRequestException('Invalid chat room ID');
    }

    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const chatRoom = await this.chatModel
      .findById(chatRoomId)
      .populate('user', 'fullName avatarUrl phone')
      .populate('fieldOwner', 'facilityName contactPhone')
      .populate('field', 'name images sportType location')
      .exec();

    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify access
    if (
      chatRoom.user._id.toString() !== userId &&
      chatRoom.fieldOwner._id.toString() !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    // IMPORTANT: Make sure messages are included in the query result
    // The messages should already be populated since they're a subdocument array

    // Mark messages as read if user is the receiver
    const isUser = chatRoom.user._id.toString() === userId;
    let hasUpdates = false;

    // Update messages in memory only if there are messages
    if (chatRoom.messages && chatRoom.messages.length > 0) {
      chatRoom.messages.forEach((message, index) => {
        if (!message.isRead && message.sender.toString() !== userId) {
          chatRoom.messages[index].isRead = true;
          hasUpdates = true;
        }
      });
    }

    // Save updates to database if needed
    if (hasUpdates) {
      await this.chatModel.updateOne(
        { _id: chatRoomId },
        {
          $set: {
            messages: chatRoom.messages,
            hasUnread: isUser ? false : chatRoom.hasUnread
          }
        }
      );
    }

    // If user is the customer (not field owner), mark the room as read
    if (isUser && chatRoom.hasUnread) {
      await this.chatModel.updateOne(
        { _id: chatRoomId },
        { $set: { hasUnread: false } }
      );
    }

    return chatRoom;
  }

  async markMessagesAsRead(chatRoomId: string, userId: string): Promise<void> {
    // Validate chatRoomId
    if (!chatRoomId || !Types.ObjectId.isValid(chatRoomId)) {
      throw new BadRequestException('Invalid chat room ID');
    }

    // Validate userId
    if (!userId || !Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user ID');
    }

    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify user is part of the chat
    if (
      chatRoom.user.toString() !== userId &&
      chatRoom.fieldOwner.toString() !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    // Update all unread messages from other participants
    const updatedMessages = chatRoom.messages.map(message => {
      if (!message.isRead && message.sender.toString() !== userId) {
        return { ...message, isRead: true };
      }
      return message;
    });

    // Check if any messages were updated
    const hasUnreadMessages = updatedMessages.some(
      (msg, index) => msg.isRead !== chatRoom.messages[index].isRead
    );

    if (hasUnreadMessages || chatRoom.hasUnread) {
      await this.chatModel.updateOne(
        { _id: chatRoomId },
        {
          $set: {
            messages: updatedMessages,
            hasUnread: false
          }
        }
      );
    }
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.chatModel.countDocuments({
      $or: [
        { user: new Types.ObjectId(userId), hasUnread: true },
        { fieldOwner: new Types.ObjectId(userId), hasUnread: true },
      ],
      status: ChatStatus.ACTIVE,
    });
  }

  async updateChatStatus(chatRoomId: string, userId: string, status: ChatStatus): Promise<void> {
    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify user is part of the chat
    if (
      chatRoom.user.toString() !== userId &&
      chatRoom.fieldOwner.toString() !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    await this.chatModel.updateOne(
      { _id: chatRoomId },
      { $set: { status } },
    );
  }

  // Helper method to check if user can access chat
  async canAccessChat(chatRoomId: string, userId: string): Promise<boolean> {
    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) return false;

    return (
      chatRoom.user.toString() === userId ||
      chatRoom.fieldOwner.toString() === userId
    );
  }

  // Get recent chats with pagination
  async getRecentChats(userId: string, limit: number = 20, skip: number = 0): Promise<ChatRoom[]> {
    return this.chatModel
      .find({
        $or: [
          { user: new Types.ObjectId(userId) },
          { fieldOwner: new Types.ObjectId(userId) },
        ],
        status: ChatStatus.ACTIVE,
      })
      .populate('user', 'fullName avatarUrl')
      .populate('fieldOwner', 'facilityName')
      .populate('field', 'name images sportType')
      .sort({ lastMessageAt: -1 })
      .skip(skip)
      .limit(limit)
      .exec();
  }

  // Search chat rooms
  async searchChats(userId: string, searchTerm: string): Promise<ChatRoom[]> {
    return this.chatModel
      .find({
        $and: [
          {
            $or: [
              { user: new Types.ObjectId(userId) },
              { fieldOwner: new Types.ObjectId(userId) },
            ],
          },
          { status: ChatStatus.ACTIVE },
          {
            $or: [
              { 'field.name': { $regex: searchTerm, $options: 'i' } },
              { 'field.sportType': { $regex: searchTerm, $options: 'i' } },
            ],
          },
        ],
      })
      .populate('user', 'fullName avatarUrl')
      .populate('fieldOwner', 'facilityName')
      .populate('field', 'name images sportType')
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  // Delete chat room (soft delete by changing status)
  async deleteChatRoom(chatRoomId: string, userId: string): Promise<void> {
    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify user is part of the chat
    if (
      chatRoom.user.toString() !== userId &&
      chatRoom.fieldOwner.toString() !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    await this.chatModel.updateOne(
      { _id: chatRoomId },
      { $set: { status: ChatStatus.ARCHIVED } },
    );
  }
}