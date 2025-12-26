import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ChatRoom, Message } from './entities/chat.entity';
import { ChatStatus, MessageType } from '@common/enums/chat.enum';
import { User } from '../users/entities/user.entity';
import { FieldOwnerProfile } from '../field-owner/entities/field-owner-profile.entity';
import { Field } from '../fields/entities/field.entity';
import { CoachProfile } from '../coaches/entities/coach-profile.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatRoom.name) private chatModel: Model<ChatRoom>,
    @InjectModel(User.name) private userModel: Model<User>,
    @InjectModel(FieldOwnerProfile.name) private fieldOwnerProfileModel: Model<FieldOwnerProfile>,
    @InjectModel(Field.name) private fieldModel: Model<Field>,
    @InjectModel(CoachProfile.name) private coachProfileModel: Model<CoachProfile>,
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

  async createOrGetCoachChatRoom(
    userId: string,
    coachId: string,
    fieldId?: string,
  ): Promise<ChatRoom> {
    // Validate user
    const user = await this.userModel.findById(userId);
    if (!user) throw new NotFoundException('User not found');

    // Validate coach profile
    const coach = await this.coachProfileModel.findById(coachId);
    if (!coach) throw new NotFoundException('Coach not found');

    // Optional validate field exists if provided
    if (fieldId) {
      const field = await this.fieldModel.findById(fieldId);
      if (!field) throw new NotFoundException('Field not found');
    }

    const query: any = {
      user: new Types.ObjectId(userId),
      coach: new Types.ObjectId(coachId),
      status: ChatStatus.ACTIVE,
    };

    // For coach chat, field is optional context; do not enforce uniqueness by field
    const existingChat = await this.chatModel
      .findOne(query)
      .populate('user', 'fullName avatarUrl')
      .populate('coach', 'hourlyRate')
      .populate('field', 'name images sportType')
      .exec();

    if (existingChat) return existingChat;

    const newChat = new this.chatModel({
      user: new Types.ObjectId(userId),
      coach: new Types.ObjectId(coachId),
      field: fieldId ? new Types.ObjectId(fieldId) : undefined,
      messages: [],
      status: ChatStatus.ACTIVE,
      lastMessageAt: new Date(),
      hasUnread: false,
    });

    const saved = await newChat.save();
    const populated = await this.chatModel
      .findById(saved._id)
      .populate('user', 'fullName avatarUrl')
      .populate('coach', 'hourlyRate')
      .populate('field', 'name images sportType')
      .exec();
    if (!populated) throw new NotFoundException('Chat room not found after creation');
    return populated;
  }

  // Resolve FieldOwnerProfile ID -> owning User ID (string)
  async getFieldOwnerUserId(fieldOwnerProfileId: string): Promise<string | null> {
    try {
      if (!fieldOwnerProfileId || !Types.ObjectId.isValid(fieldOwnerProfileId)) {
        return null;
      }
      const profile = await this.fieldOwnerProfileModel
        .findById(fieldOwnerProfileId)
        .select('user')
        .lean();
      // profile?.user may be ObjectId; normalize to string
      // @ts-ignore
      return profile?.user ? profile.user.toString() : null;
    } catch {
      return null;
    }
  }

  // Resolve CoachProfile ID -> owning User ID (string)
  async getCoachUserId(coachProfileId: string): Promise<string | null> {
    try {
      if (!coachProfileId || !Types.ObjectId.isValid(coachProfileId)) {
        return null;
      }
      const profile = await this.coachProfileModel
        .findById(coachProfileId)
        .select('user')
        .lean();
      // @ts-ignore
      return profile?.user ? profile.user.toString() : null;
    } catch {
      return null;
    }
  }

  // Resolve User ID -> FieldOwnerProfile ID (string)
  private async getFieldOwnerProfileIdByUser(userId: string): Promise<string | null> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) return null;
      const profile = await this.fieldOwnerProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .select('_id')
        .lean();
      // @ts-ignore
      return profile?._id ? profile._id.toString() : null;
    } catch {
      return null;
    }
  }

  // Resolve User ID -> CoachProfile ID (string)
  private async getCoachProfileIdByUser(userId: string): Promise<string | null> {
    try {
      if (!userId || !Types.ObjectId.isValid(userId)) return null;
      const profile = await this.coachProfileModel
        .findOne({ user: new Types.ObjectId(userId) })
        .select('_id')
        .lean();
      // @ts-ignore
      return profile?._id ? profile._id.toString() : null;
    } catch {
      return null;
    }
  }

  // Modified to accept room creation if it doesn't exist
  async sendMessageWithAutoCreate(
    userId: string,
    fieldOwnerId: string,
    content: string,
    type: MessageType = MessageType.TEXT,
    fieldId?: string,
    attachments?: string[],
  ): Promise<{ message: Message; chatRoom: ChatRoom }> {

    // First, get or create chat room
    const chatRoom = await this.createOrGetChatRoom(userId, fieldOwnerId, fieldId);

    // Send the message
    const message = await this.sendMessage(
      (chatRoom._id as Types.ObjectId).toString(),
      userId,
      content,
      type,
      attachments
    );

    // Fetch the UPDATED room to ensure history is included
    const updatedRoom = await this.getChatRoomMessages(
      (chatRoom._id as Types.ObjectId).toString(),
      userId
    );

    return { message, chatRoom: updatedRoom };
  }

  // New method for coach chats
  async sendMessageToCoachWithAutoCreate(
    userId: string,
    coachId: string,
    content: string,
    type: MessageType = MessageType.TEXT,
    fieldId?: string,
    attachments?: string[],
  ): Promise<{ message: Message; chatRoom: ChatRoom }> {

    // First, get or create chat room
    const chatRoom = await this.createOrGetCoachChatRoom(userId, coachId, fieldId);

    // Send the message
    const message = await this.sendMessage(
      (chatRoom._id as Types.ObjectId).toString(),
      userId,
      content,
      type,
      attachments
    );

    // Fetch the UPDATED room
    const updatedRoom = await this.getChatRoomMessages(
      (chatRoom._id as Types.ObjectId).toString(),
      userId
    );

    return { message, chatRoom: updatedRoom };
  }

  async sendMessage(
    chatRoomId: string,
    senderId: string,
    content: string,
    type: MessageType = MessageType.TEXT,
    attachments?: string[],
  ): Promise<Message> {
    console.log('📝 [ChatService.sendMessage] Called:', { chatRoomId, senderId, contentLength: content?.length });

    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    console.log('📝 [ChatService.sendMessage] Room found, current messages count:', chatRoom.messages.length);

    // Verify sender is a participant: customer, field owner, or coach
    let isParticipant = chatRoom.user.toString() === senderId;
    if (!isParticipant && chatRoom.fieldOwner) {
      const ownerProfileId = await this.getFieldOwnerProfileIdByUser(senderId);
      if (ownerProfileId && chatRoom.fieldOwner.toString() === ownerProfileId) {
        isParticipant = true;
      }
    }
    if (!isParticipant && chatRoom.coach) {
      const coachProfileId = await this.getCoachProfileIdByUser(senderId);
      if (coachProfileId && chatRoom.coach.toString() === coachProfileId) {
        isParticipant = true;
      }
    }
    if (!isParticipant) {
      console.error('❌ [ChatService.sendMessage] User not participant');
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
    // Mark as unread for receiver: if sender is user, mark unread for owner/coach; if sender is owner/coach, mark unread for user
    chatRoom.hasUnread = chatRoom.user.toString() !== senderId;

    console.log('💾 [ChatService.sendMessage] About to save, messages count:', chatRoom.messages.length);

    await chatRoom.save();

    console.log('✅ [ChatService.sendMessage] Saved successfully');

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
      .populate('coach', 'hourlyRate displayName') // Added displayName for coach
      .populate('field', 'name images sportType')
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  // In chat.service.ts, update getChatRoomsForFieldOwner:
  async getChatRoomsForFieldOwner(fieldOwnerUserId: string): Promise<ChatRoom[]> {
    // First, find the field owner profile linked to this user
    const fieldOwnerProfile = await this.fieldOwnerProfileModel.findOne({
      user: new Types.ObjectId(fieldOwnerUserId)
    });

    if (!fieldOwnerProfile) {
      // If no profile found, try to find by ID directly
      // Check if the ID is already a field owner profile ID
      const existingProfile = await this.fieldOwnerProfileModel.findById(fieldOwnerUserId);
      if (existingProfile) {
        // Use it directly
        return this.chatModel
          .find({
            fieldOwner: existingProfile._id,
            status: ChatStatus.ACTIVE,
          })
          .populate('user', 'fullName avatarUrl phone')
          .populate('fieldOwner', 'facilityName contactPhone')
          .populate('field', 'name images sportType')
          .sort({ lastMessageAt: -1 })
          .exec();
      }
      throw new NotFoundException('Field owner profile not found');
    }

    // Use the field owner profile ID to find chat rooms
    return this.chatModel
      .find({
        fieldOwner: fieldOwnerProfile._id,
        status: ChatStatus.ACTIVE,
      })
      .populate('user', 'fullName avatarUrl phone')
      .populate('fieldOwner', 'facilityName contactPhone')
      .populate('field', 'name images sportType')
      .sort({ lastMessageAt: -1 })
      .exec();
  }

  // Get chat rooms for coach (by coach user ID)
  async getChatRoomsForCoach(coachUserId: string): Promise<ChatRoom[]> {
    // Find coach profile linked to this user
    const coachProfile = await this.coachProfileModel.findOne({ user: new Types.ObjectId(coachUserId) });

    if (!coachProfile) {
      // If no profile, try direct ID usage
      const existingProfile = await this.coachProfileModel.findById(coachUserId);
      if (existingProfile) {
        return this.chatModel
          .find({ coach: existingProfile._id, status: ChatStatus.ACTIVE })
          .populate('user', 'fullName avatarUrl phone')
          .populate('coach', 'hourlyRate')
          .populate('field', 'name images sportType')
          .sort({ lastMessageAt: -1 })
          .exec();
      }
      throw new NotFoundException('Coach profile not found');
    }

    return this.chatModel
      .find({ coach: coachProfile._id, status: ChatStatus.ACTIVE })
      .populate('user', 'fullName avatarUrl phone')
      .populate('coach', 'hourlyRate')
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
      .populate('coach', 'hourlyRate')
      .populate('field', 'name images sportType location')
      .exec();

    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify access: allow room user OR owning field owner user
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    const chatOwnerId = chatRoom.fieldOwner
      ? ((chatRoom.fieldOwner as any)?._id ? (chatRoom.fieldOwner as any)._id.toString() : (chatRoom.fieldOwner as any).toString())
      : null;
    const chatCoachId = chatRoom.coach
      ? ((chatRoom.coach as any)?._id ? (chatRoom.coach as any)._id.toString() : (chatRoom.coach as any).toString())
      : null;
    const isParticipant =
      chatRoom.user._id.toString() === userId ||
      (!!ownerProfileId && !!chatOwnerId && chatOwnerId === ownerProfileId) ||
      (!!coachProfileId && !!chatCoachId && chatCoachId === coachProfileId);
    if (!isParticipant) {
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

    // Verify user is part of the chat (either room user or owning field owner)
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    const isParticipant =
      chatRoom.user.toString() === userId ||
      (!!ownerProfileId && chatRoom.fieldOwner?.toString() === ownerProfileId) ||
      (!!coachProfileId && chatRoom.coach?.toString() === coachProfileId);
    if (!isParticipant) {
      throw new ForbiddenException('Access denied');
    }

    // Update messages to isRead: true for messages NOT from the current user
    // We use a more atomic approach to avoid fetching and saving the whole array if possible,
    // but for subdocument arrays, we often need to map or use $[]
    let hasUnreadFromOthers = false;
    const updatedMessages = chatRoom.messages.map(message => {
      if (!message.isRead && message.sender.toString() !== userId) {
        hasUnreadFromOthers = true;
        return { ...message, isRead: true };
      }
      return message;
    });

    if (hasUnreadFromOthers || chatRoom.hasUnread) {
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
    // Include unread where current user is customer OR field owner user OR coach user
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    const orFilters: any[] = [{ user: new Types.ObjectId(userId), hasUnread: true }];
    if (ownerProfileId) {
      orFilters.push({ fieldOwner: new Types.ObjectId(ownerProfileId), hasUnread: true });
    }
    if (coachProfileId) {
      orFilters.push({ coach: new Types.ObjectId(coachProfileId), hasUnread: true });
    }
    return this.chatModel.countDocuments({ $or: orFilters, status: ChatStatus.ACTIVE });
  }

  async updateChatStatus(chatRoomId: string, userId: string, status: ChatStatus): Promise<void> {
    const chatRoom = await this.chatModel.findById(chatRoomId);
    if (!chatRoom) throw new NotFoundException('Chat room not found');

    // Verify user is part of the chat (customer, field owner, or coach)
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    const isParticipant =
      chatRoom.user.toString() === userId ||
      (!!ownerProfileId && chatRoom.fieldOwner?.toString() === ownerProfileId) ||
      (!!coachProfileId && chatRoom.coach?.toString() === coachProfileId);
    if (!isParticipant) {
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
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    return (
      chatRoom.user.toString() === userId ||
      (!!ownerProfileId && chatRoom.fieldOwner?.toString() === ownerProfileId) ||
      (!!coachProfileId && chatRoom.coach?.toString() === coachProfileId)
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

    // Verify user is part of the chat (customer, field owner, or coach)
    const ownerProfileId = await this.getFieldOwnerProfileIdByUser(userId);
    const coachProfileId = await this.getCoachProfileIdByUser(userId);
    const isParticipant =
      chatRoom.user.toString() === userId ||
      (!!ownerProfileId && chatRoom.fieldOwner?.toString() === ownerProfileId) ||
      (!!coachProfileId && chatRoom.coach?.toString() === coachProfileId);
    if (!isParticipant) {
      throw new ForbiddenException('Access denied');
    }

    await this.chatModel.updateOne(
      { _id: chatRoomId },
      { $set: { status: ChatStatus.ARCHIVED } },
    );
  }
}