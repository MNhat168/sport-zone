// Append these methods to the end of the ChatService class (before the closing brace)

  // ==================== MATCHING SYSTEM CHAT METHODS ====================

  /**
   * Create chat room for 1:1 match
   */
  async createMatchChatRoom(matchId: string, user1Id: string, user2Id: string): Promise<ChatRoom> {
    // Check if chat room already exists
    const existingRoom = await this.chatModel.findOne({
      matchId: new Types.ObjectId(matchId),
    });

    if (existingRoom) {
      return existingRoom;
    }

    // Create new chat room for match
    const chatRoom = new this.chatModel({
      user: new Types.ObjectId(user1Id), // Primary user
      matchId: new Types.ObjectId(matchId),
      participants: [new Types.ObjectId(user1Id), new Types.ObjectId(user2Id)],
      status: ChatStatus.ACTIVE,
      lastMessageAt: getCurrentVietnamTimeForDB(),
    });

    await chatRoom.save();

    return chatRoom;
  }

  /**
   * Create chat room for group session
   */
  async createGroupSessionChatRoom(sessionId: string, creatorId: string): Promise<ChatRoom> {
    // Check if chat room already exists
    const existingRoom = await this.chatModel.findOne({
      groupSessionId: new Types.ObjectId(sessionId),
    });

    if (existingRoom) {
      return existingRoom;
    }

    // Create new chat room for group session
    const chatRoom = new this.chatModel({
      user: new Types.ObjectId(creatorId), // Creator as primary user
      groupSessionId: new Types.ObjectId(sessionId),
      participants: [new Types.ObjectId(creatorId)],
      status: ChatStatus.ACTIVE,
      lastMessageAt: getCurrentVietnamTimeForDB(),
    });

    await chatRoom.save();

    return chatRoom;
  }

  /**
   * Add user to group chat
   */
  async addUserToGroupChat(chatRoomId: string, userId: string): Promise<void> {
    const chatRoom = await this.chatModel.findById(chatRoomId);

    if (!chatRoom) {
      throw new NotFoundException('Chat room not found');
    }

    if (!chatRoom.groupSessionId) {
      throw new BadRequestException('This is not a group session chat');
    }

    const userObjectId = new Types.ObjectId(userId);

    // Check if user is already in participants
    const isAlreadyParticipant = chatRoom.participants.some(
      (id) => id.toString() === userId
    );

    if (!isAlreadyParticipant) {
      chatRoom.participants.push(userObjectId);
      await chatRoom.save();
    }
  }

  /**
   * Remove user from group chat
   */
  async removeUserFromGroupChat(chatRoomId: string, userId: string): Promise<void> {
    const chatRoom = await this.chatModel.findById(chatRoomId);

    if (!chatRoom) {
      throw new NotFoundException('Chat room not found');
    }

    if (!chatRoom.groupSessionId) {
      throw new BadRequestException('This is not a group session chat');
    }

    chatRoom.participants = chatRoom.participants.filter(
      (id) => id.toString() !== userId
    );

    await chatRoom.save();
  }

  /**
   * Send message in match or group chat
   */
  async sendMatchOrGroupMessage(
    chatRoomId: string,
    senderId: string,
    content: string,
    type: MessageType = MessageType.TEXT,
    attachments?: string[],
  ): Promise<Message> {
    const chatRoom = await this.chatModel.findById(chatRoomId);

    if (!chatRoom) {
      throw new NotFoundException('Chat room not found');
    }

    // Verify sender is a participant
    const isParticipant = chatRoom.participants.some(
      (id) => id.toString() === senderId
    );

    if (!isParticipant) {
      throw new ForbiddenException('You are not a participant in this chat');
    }

    const message: Message = {
      sender: new Types.ObjectId(senderId),
      type,
      content,
      attachments,
      isRead: false,
      sentAt: getCurrentVietnamTimeForDB(),
    };

    chatRoom.messages.push(message);
    chatRoom.lastMessageAt = getCurrentVietnamTimeForDB();
    chatRoom.lastMessageBy = new Types.ObjectId(senderId);
    chatRoom.hasUnread = true;

    await chatRoom.save();

    return message;
  }

  /**
   * Get chat room by match ID
   */
  async getChatRoomByMatchId(matchId: string): Promise<ChatRoom> {
    const chatRoom = await this.chatModel
      .findOne({ matchId: new Types.ObjectId(matchId) })
      .populate('participants', 'fullName email avatarUrl');

    if (!chatRoom) {
      throw new NotFoundException('Chat room not found for this match');
    }

    return chatRoom;
  }

  /**
   * Get chat room by group session ID
   */
  async getChatRoomByGroupSessionId(sessionId: string): Promise<ChatRoom> {
    const chatRoom = await this.chatModel
      .findOne({ groupSessionId: new Types.ObjectId(sessionId) })
      .populate('participants', 'fullName email avatarUrl');

    if (!chatRoom) {
      throw new NotFoundException('Chat room not found for this group session');
    }

    return chatRoom;
  }
