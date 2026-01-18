import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MatchProfile } from './entities/match-profile.entity';
import { Swipe } from './entities/swipe.entity';
import { Match } from './entities/match.entity';
import { User } from '../users/entities/user.entity';
import { CreateMatchProfileDto, UpdateMatchProfileDto, SwipeDto, GetMatchCandidatesDto, ScheduleMatchDto } from './dto/matching.dto';
import { SwipeAction, MatchStatus, SkillLevel } from '@common/enums/matching.enum';
import { SportType } from '@common/enums/sport-type.enum';
import { MatchingGateway } from './matching.gateway';
import { ChatService } from '../chat/chat.service';
import { getCurrentVietnamTimeForDB } from 'src/utils/timezone.utils';
import { BookingsService } from '../bookings/bookings.service';
import { Booking } from '../bookings/entities/booking.entity';
import { CreateFieldBookingLazyDto } from '../bookings/dto/create-field-booking-lazy.dto';
import { MessageType } from '@common/enums/chat.enum';

@Injectable()
export class MatchingService {
    private readonly logger = new Logger(MatchingService.name);

    constructor(
        @InjectModel(MatchProfile.name) private matchProfileModel: Model<MatchProfile>,
        @InjectModel(Swipe.name) private swipeModel: Model<Swipe>,
        @InjectModel(Match.name) private matchModel: Model<Match>,
        @InjectModel(User.name) private userModel: Model<User>,
        @InjectModel(Booking.name) private bookingModel: Model<Booking>,
        private readonly matchingGateway: MatchingGateway,
        private readonly chatService: ChatService,
        private readonly bookingsService: BookingsService,
        private readonly eventEmitter: EventEmitter2,
    ) { }

    @OnEvent('match.split_payment_complete')
    async handleSplitPaymentComplete(payload: { matchId: string, bookingId: string }) {
        try {
            const match = await this.matchModel.findById(payload.matchId);
            if (!match || !match.chatRoomId) return;

            // Send Success Message
            const { message, chatRoom } = await this.chatService.sendSystemMessage(
                match.chatRoomId.toString(),
                'Thanh toán hoàn tất! Sân đã được đặt thành công. Chúc hai bạn chơi vui vẻ!',
                MessageType.SYSTEM
            );

            // Broadcast real-time message
            this.eventEmitter.emit('chat.system_message', {
                chatRoomId: match.chatRoomId.toString(),
                message,
                chatRoom
            });

            // Update Proposal Card in UI (Force refresh)
            this.eventEmitter.emit('chat.proposal_updated', {
                chatRoomId: match.chatRoomId.toString(),
                bookingId: payload.bookingId,
                status: 'completed'
            });

            this.logger.log(`[Split Payment] Sent completion message to chat room ${match.chatRoomId}`);
        } catch (error) {
            this.logger.error(`[Split Payment] Failed to handle completion event: ${error.message}`);
        }
    }

    @OnEvent('match.split_payment_partial')
    async handleSplitPaymentPartial(payload: { matchId: string, bookingId: string, userId: string }) {
        try {
            const match = await this.matchModel.findById(payload.matchId);
            if (!match || !match.chatRoomId) return;

            // Update Proposal Card in UI (Force refresh)
            this.eventEmitter.emit('chat.proposal_updated', {
                chatRoomId: match.chatRoomId.toString(),
                bookingId: payload.bookingId,
                status: 'partial_payment',
                userId: payload.userId
            });

            this.logger.log(`[Split Payment] Sent partial payment update to chat room ${match.chatRoomId}`);
        } catch (error) {
            this.logger.error(`[Split Payment] Failed to handle partial payment event: ${error.message}`);
        }
    }

    // ==================== MATCH PROFILE MANAGEMENT ====================

    /**
     * Create or update match profile
     */
    async createOrUpdateMatchProfile(userId: string, dto: CreateMatchProfileDto | UpdateMatchProfileDto) {
        const existingProfile = await this.matchProfileModel.findOne({ userId: new Types.ObjectId(userId) });

        if (existingProfile) {
            Object.assign(existingProfile, dto);
            existingProfile.lastActiveAt = getCurrentVietnamTimeForDB();
            await existingProfile.save();
            this.logger.log(`Updated match profile for user ${userId}`);
            return existingProfile;
        }

        const profile = new this.matchProfileModel({
            ...dto,
            userId: new Types.ObjectId(userId),
            lastActiveAt: getCurrentVietnamTimeForDB(),
        });

        await profile.save();
        this.logger.log(`Created match profile for user ${userId}`);
        return profile;
    }

    /**
     * Get user's match profile
     */
    async getMatchProfile(userId: string) {
        const profile = await this.matchProfileModel.findOne({ userId: new Types.ObjectId(userId) }).populate('userId', 'fullName email avatarUrl');

        return profile;
    }

    /**
     * Check if user has a complete match profile
     */
    async hasCompleteProfile(userId: string): Promise<boolean> {
        const profile = await this.matchProfileModel.findOne({ userId: new Types.ObjectId(userId) });

        if (!profile) return false;

        // Check required fields
        return !!(
            profile.sportPreferences?.length > 0 &&
            profile.skillLevel &&
            profile.location?.address &&
            profile.location?.coordinates &&
            profile.gender
        );
    }

    // ==================== MATCHING ALGORITHM ====================

    /**
     * Get match candidates based on user preferences
     */
    async getMatchCandidates(userId: string, dto: GetMatchCandidatesDto) {
        const userProfile = await this.getMatchProfile(userId);

        if (!userProfile) {
            throw new NotFoundException('Match profile not found. Please create your profile first.');
        }

        if (!userProfile.isActive) {
            throw new BadRequestException('Your profile is not active. Please activate it to see matches.');
        }

        const { sportType, maxDistance, skillLevel, genderPreference, limit = 20 } = dto;
        const searchSports = sportType ? [sportType] : userProfile.sportPreferences;

        // Get users already swiped on
        const swipedUsers = await this.swipeModel.find({
            userId: new Types.ObjectId(userId),
            sportType: { $in: searchSports },
        }).select('targetUserId');

        const swipedUserIds = swipedUsers.map(s => s.targetUserId.toString());

        // Build query
        const query: any = {
            userId: { $ne: new Types.ObjectId(userId) }, // Exclude self
            isActive: true,
            sportPreferences: { $in: searchSports },
        };

        // Exclude already swiped users
        if (swipedUserIds.length > 0) {
            query.userId = { $nin: swipedUserIds.map(id => new Types.ObjectId(id)), $ne: new Types.ObjectId(userId) };
        }

        // Gender preference filter
        if (userProfile.preferredGender && userProfile.preferredGender !== 'any') {
            query.gender = userProfile.preferredGender;
        }

        if (genderPreference && genderPreference !== 'any') {
            query.gender = genderPreference;
        }

        // Skill level filter (within range)
        if (skillLevel) {
            query.skillLevel = skillLevel;
        } else if (userProfile.skillLevel && userProfile.skillLevelRange !== undefined) {
            const skillLevels = this.getSkillLevelRange(userProfile.skillLevel, userProfile.skillLevelRange);
            query.skillLevel = { $in: skillLevels };
        }

        // Age filter
        if (userProfile.minAge || userProfile.maxAge) {
            query.age = {};
            if (userProfile.minAge) query.age.$gte = userProfile.minAge;
            if (userProfile.maxAge) query.age.$lte = userProfile.maxAge;
        }

        // Geospatial query for location
        const searchRadius = maxDistance || userProfile.location.searchRadius || 10;
        const radiusInMeters = searchRadius * 1000;

        query['location.coordinates'] = {
            $near: {
                $geometry: {
                    type: 'Point',
                    coordinates: userProfile.location.coordinates.coordinates,
                },
                $maxDistance: radiusInMeters,
            },
        };

        // Execute query
        const candidates = await this.matchProfileModel
            .find(query)
            .populate('userId', 'fullName email avatarUrl')
            .limit(limit)
            .exec();

        this.logger.log(`Found ${candidates.length} candidates for user ${userId} in ${sportType || 'multiple sports: ' + searchSports.join(', ')}`);

        return candidates;
    }

    /**
     * Get skill levels within range
     */
    private getSkillLevelRange(baseLevel: SkillLevel, range: number): SkillLevel[] {
        const levels = [SkillLevel.BEGINNER, SkillLevel.INTERMEDIATE, SkillLevel.ADVANCED, SkillLevel.PROFESSIONAL];
        const baseIndex = levels.indexOf(baseLevel);

        if (baseIndex === -1) return [baseLevel];

        const minIndex = Math.max(0, baseIndex - range);
        const maxIndex = Math.min(levels.length - 1, baseIndex + range);

        return levels.slice(minIndex, maxIndex + 1);
    }

    // ==================== SWIPE ACTIONS ====================

    /**
     * Record a swipe action
     */
    async swipeUser(userId: string, dto: SwipeDto) {
        const { targetUserId, action, sportType } = dto;

        // Validate not swiping on self
        if (userId === targetUserId) {
            throw new BadRequestException('You cannot swipe on yourself');
        }

        // Check if already swiped
        const existingSwipe = await this.swipeModel.findOne({
            userId: new Types.ObjectId(userId),
            targetUserId: new Types.ObjectId(targetUserId),
            sportType,
        });

        if (existingSwipe) {
            throw new BadRequestException('You have already swiped on this user for this sport');
        }

        // Check super like limit
        if (action === SwipeAction.SUPER_LIKE) {
            const user = await this.userModel.findById(userId);

            if (!user) {
                throw new NotFoundException('User not found');
            }

            if (!user.superLikesRemaining || user.superLikesRemaining <= 0) {
                throw new BadRequestException('You have no super likes remaining today');
            }

            // Decrement super likes
            user.superLikesRemaining -= 1;
            await user.save();

            // Notify target user of super like
            this.matchingGateway.notifySuperLike(targetUserId, {
                fromUserId: userId,
                sportType,
                timestamp: new Date(),
            });
        }

        // Create swipe record
        const swipe = new this.swipeModel({
            userId: new Types.ObjectId(userId),
            targetUserId: new Types.ObjectId(targetUserId),
            action,
            sportType,
            timestamp: getCurrentVietnamTimeForDB(),
        });

        await swipe.save();
        this.logger.log(`User ${userId} ${action} user ${targetUserId} for ${sportType}`);

        // Check for match if action is LIKE or SUPER_LIKE
        if (action === SwipeAction.LIKE || action === SwipeAction.SUPER_LIKE) {
            const match = await this.checkForMatch(userId, targetUserId, sportType);
            if (match) {
                return { swiped: true, matched: true, match };
            }
        }

        return { swiped: true, matched: false };
    }

    /**
     * Check if mutual like exists and create match
     */
    private async checkForMatch(userId: string, targetUserId: string, sportType: SportType) {
        // Check if target user also liked this user
        const reciprocalSwipe = await this.swipeModel.findOne({
            userId: new Types.ObjectId(targetUserId),
            targetUserId: new Types.ObjectId(userId),
            sportType,
            action: { $in: [SwipeAction.LIKE, SwipeAction.SUPER_LIKE] },
        });

        if (!reciprocalSwipe) {
            return null; // No match yet
        }

        // Check if match already exists
        const existingMatch = await this.matchModel.findOne({
            $or: [
                { user1Id: new Types.ObjectId(userId), user2Id: new Types.ObjectId(targetUserId), sportType },
                { user1Id: new Types.ObjectId(targetUserId), user2Id: new Types.ObjectId(userId), sportType },
            ],
        });

        if (existingMatch) {
            return existingMatch; // Match already exists
        }

        // Create new match
        const match = new this.matchModel({
            user1Id: new Types.ObjectId(userId),
            user2Id: new Types.ObjectId(targetUserId),
            sportType,
            status: MatchStatus.ACTIVE,
            matchedAt: getCurrentVietnamTimeForDB(),
        });

        await match.save();

        // Create chat room for the match
        const chatRoom = await this.chatService.createMatchChatRoom((match._id as any).toString(), userId, targetUserId);
        match.chatRoomId = chatRoom._id as Types.ObjectId;
        await match.save();

        // Join both users to match room
        this.matchingGateway.joinMatchRoom((match._id as any).toString(), userId);
        this.matchingGateway.joinMatchRoom((match._id as any).toString(), targetUserId);

        // Populate match data
        const populatedMatch = await this.matchModel
            .findById(match._id)
            .populate('user1Id', 'fullName email avatarUrl')
            .populate('user2Id', 'fullName email avatarUrl')
            .exec();

        // Notify both users via WebSocket
        this.matchingGateway.notifyBothUsersOfMatch(userId, targetUserId, {
            match: populatedMatch,
            timestamp: new Date(),
        });

        this.logger.log(`Created match between ${userId} and ${targetUserId} for ${sportType}`);

        return populatedMatch;
    }

    // ==================== MATCH MANAGEMENT ====================

    /**
     * Get user's matches
     */
    async getMatches(userId: string, status?: MatchStatus) {
        const query: any = {
            $or: [{ user1Id: new Types.ObjectId(userId) }, { user2Id: new Types.ObjectId(userId) }],
            isUnmatchedByUser1: false,
            isUnmatchedByUser2: false,
        };

        if (status) {
            query.status = status;
        }

        const matches = await this.matchModel
            .find(query)
            .populate('user1Id', 'fullName email avatarUrl')
            .populate('user2Id', 'fullName email avatarUrl')
            .populate('chatRoomId')
            .sort({ matchedAt: -1 })
            .exec();

        return matches;
    }

    /**
     * Get a specific match
     */
    async getMatch(matchId: string, userId: string) {
        const match = await this.matchModel
            .findById(matchId)
            .populate('user1Id', 'fullName email avatarUrl')
            .populate('user2Id', 'fullName email avatarUrl')
            .populate('chatRoomId')
            .populate('fieldId')
            .populate('courtId')
            .exec();

        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (!match.isParticipant(userId)) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        return match;
    }

    /**
     * Unmatch (remove match)
     */
    async unmatch(userId: string, matchId: string) {
        const match = await this.matchModel.findById(matchId);

        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (!match.isParticipant(userId)) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        // Mark as unmatched by this user
        if (match.user1Id.toString() === userId) {
            match.isUnmatchedByUser1 = true;
        } else {
            match.isUnmatchedByUser2 = true;
        }

        await match.save();

        // Notify the other user
        const otherUserId = match.getOtherUserId(userId).toString();
        this.matchingGateway.notifyUnmatch(otherUserId, matchId);

        this.logger.log(`User ${userId} unmatched from match ${matchId}`);

        return { success: true, message: 'Unmatched successfully' };
    }

    /**
     * Schedule a match
     */
    async scheduleMatch(userId: string, matchId: string, dto: ScheduleMatchDto) {
        const match = await this.matchModel.findById(matchId);

        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (!match.isParticipant(userId)) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        // Update match with schedule
        match.scheduledDate = new Date(dto.scheduledDate);
        match.scheduledStartTime = dto.startTime;
        match.scheduledEndTime = dto.endTime;
        match.status = MatchStatus.SCHEDULED;

        if (dto.fieldId) {
            match.fieldId = new Types.ObjectId(dto.fieldId);
        }

        if (dto.courtId) {
            match.courtId = new Types.ObjectId(dto.courtId);
        }

        await match.save();

        // Notify the other user
        const otherUserId = match.getOtherUserId(userId).toString();
        this.matchingGateway.notifyMatchScheduled(otherUserId, {
            matchId,
            scheduledDate: match.scheduledDate,
            startTime: match.scheduledStartTime,
            endTime: match.scheduledEndTime,
        });

        this.logger.log(`Match ${matchId} scheduled for ${dto.scheduledDate}`);

        return match;
    }

    /**
     * Cancel a match
     */
    async cancelMatch(userId: string, matchId: string) {
        const match = await this.matchModel.findById(matchId);

        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (!match.isParticipant(userId)) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        match.status = MatchStatus.CANCELLED;
        await match.save();

        // Notify the other user
        const otherUserId = match.getOtherUserId(userId).toString();
        this.matchingGateway.notifyMatchCancelled(otherUserId, matchId);

        this.logger.log(`Match ${matchId} cancelled by user ${userId}`);

        return { success: true, message: 'Match cancelled successfully' };
    }

    // ==================== UTILITY METHODS ====================

    /**
     * Reset daily super likes (called by cron job)
     */
    async resetDailySuperLikes() {
        const result = await this.userModel.updateMany(
            {},
            {
                $set: {
                    superLikesRemaining: 3, // 3 super likes per day
                    lastSuperLikeReset: getCurrentVietnamTimeForDB(),
                },
            }
        );

        this.logger.log(`Reset super likes for ${result.modifiedCount} users`);
        return result;
    }

    /**
     * Get user's swipe history
     */
    async getSwipeHistory(userId: string, sportType?: SportType) {
        const query: any = { userId: new Types.ObjectId(userId) };
        if (sportType) {
            query.sportType = sportType;
        }

        const swipes = await this.swipeModel
            .find(query)
            .populate('targetUserId', 'fullName email avatarUrl')
            .sort({ timestamp: -1 })
            .limit(100)
            .exec();

        return swipes;
    }

    /**
     * Book a match (create a real booking and link to match)
     */
    async bookMatch(userId: string, matchId: string, dto: CreateFieldBookingLazyDto) {
        const match = await this.matchModel.findById(matchId);
        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (match.user1Id.toString() !== userId && match.user2Id.toString() !== userId) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        // 1. Create the booking
        const booking = await this.bookingsService.createFieldBookingLazy(userId, dto);

        // 2. Update match with booking info
        const updateData: any = {
            bookingId: booking._id,
            status: MatchStatus.SCHEDULED,
            fieldId: new Types.ObjectId(dto.fieldId),
            courtId: new Types.ObjectId(dto.courtId),
            scheduledDate: new Date(dto.date),
            scheduledStartTime: dto.startTime,
            scheduledEndTime: dto.endTime,
        };

        const updatedMatch = await this.matchModel.findByIdAndUpdate(matchId, { $set: updateData }, { new: true });

        // 3. Update booking metadata to include matchId
        await this.bookingModel.findByIdAndUpdate(booking._id, {
            $set: { 'metadata.matchId': matchId }
        });

        // 4. Send system message to chat room
        if (match.chatRoomId) {
            try {
                const user = await this.userModel.findById(userId);
                const senderName = user?.fullName || 'Người dùng';
                await this.chatService.sendSystemMessage(
                    match.chatRoomId.toString(),
                    `${senderName} đã đặt lịch chơi vào lúc ${dto.startTime} ngày ${dto.date}.`,
                    MessageType.SYSTEM
                );
            } catch (err) {
                this.logger.error('Failed to send system message for match booking', err);
                // Don't fail the whole process if message fails
            }
        }

        // 5. If it's a PayOS booking, we might need to return the payment link
        let paymentInfo: any = null;
        const { PaymentMethod } = await import('../../common/enums/payment-method.enum');
        if (dto.paymentMethod === PaymentMethod.PAYOS) {
            try {
                paymentInfo = await this.bookingsService.createPayOSPaymentForBooking(userId, (booking._id as any).toString());
            } catch (payError) {
                this.logger.error('Failed to create PayOS link for match booking', payError);
            }
        }

        return {
            match: updatedMatch,
            booking,
            paymentInfo,
        };
    }

    /**
     * Propose a match with split payment
     * Creates a booking hold and sends a proposal message
     */
    async proposeMatch(userId: string, matchId: string, dto: CreateFieldBookingLazyDto) {
        const match = await this.matchModel.findById(matchId);
        if (!match) {
            throw new NotFoundException('Match not found');
        }

        if (!match.isParticipant(userId)) {
            throw new ForbiddenException('You are not a participant in this match');
        }

        const otherUserId = match.getOtherUserId(userId).toString();

        // 1. Create the booking (Slot Hold)
        // Ensure payment method is PayOS for split payment flow
        const { PaymentMethod } = await import('../../common/enums/payment-method.enum');
        const bookingDto = { ...dto, paymentMethod: PaymentMethod.PAYOS };
        const booking = await this.bookingsService.createFieldBookingLazy(userId, bookingDto);

        // Calculate split amount (50/50)
        const totalAmount = booking.bookingAmount + booking.platformFee;

        // Fix: Simply devide by 2 and round up to nearest integer (or 100 if preferred, but exact half is safer for small amounts)
        // Let's use Math.ceil(totalAmount / 2) to ensure we cover the cost.
        // If total is 2100, share is 1050.
        const shareAmount = Math.ceil(totalAmount / 2);

        // 2. Update booking metadata for split payment proposal
        const updateData = {
            'metadata.matchId': matchId,
            'metadata.isProposal': true,
            'metadata.proposalStatus': 'pending',
            'metadata.splitPayment': true,
            'metadata.proposerId': userId,
            'metadata.receiverId': otherUserId,
            'metadata.shareAmount': shareAmount,
            'metadata.paymentMethod': PaymentMethod.PAYOS,
            'metadata.isSlotHold': true,
            'metadata.payments': {
                [userId]: { status: 'unpaid', amount: shareAmount },
                [otherUserId]: { status: 'unpaid', amount: shareAmount }
            }
        };

        const updatedBooking = await this.bookingModel.findByIdAndUpdate(
            booking._id,
            { $set: updateData },
            { new: true }
        );

        // 3. Send PROPOSAL message to chat room
        if (match.chatRoomId) {
            try {
                const user = await this.userModel.findById(userId);

                // Construct message content with structured data for frontend to parse
                // OR send as a special message type with metadata (ChatService might need update to support metadata in messages, 
                // but for now we can serialize into content or just rely on the type and fetching booking separately)
                // Let's us a simple string for notification and let frontend use getChatRoom to verify or fetch booking details.
                // Better: The message content can be a JSON string or a specialized format.
                // For simplicity/compatibility, we'll send a descriptive text but mark type as MATCH_PROPOSAL.
                // The frontend will treat MATCH_PROPOSAL messages specially.

                const { message, chatRoom } = await this.chatService.sendSystemMessage(
                    match.chatRoomId.toString(),
                    JSON.stringify({
                        bookingId: booking._id,
                        matchId: matchId,
                        proposerId: userId,
                        fieldId: dto.fieldId,
                        date: dto.date,
                        startTime: dto.startTime,
                        endTime: dto.endTime,
                        totalAmount: totalAmount,
                        shareAmount: shareAmount
                    }),
                    MessageType.MATCH_PROPOSAL // Custom type
                );

                // Emit event for real-time update
                this.eventEmitter.emit('chat.system_message', {
                    chatRoomId: match.chatRoomId.toString(),
                    message,
                    chatRoom
                });
            } catch (err) {
                this.logger.error('Failed to send proposal message', err);
            }
        }

        return {
            success: true,
            message: 'Proposal sent',
            booking: updatedBooking
        };
    }

    /**
     * Accept a match proposal
     */
    async acceptMatchProposal(userId: string, matchId: string, bookingId: string) {
        const match = await this.matchModel.findById(matchId);
        if (!match || !match.isParticipant(userId)) {
            throw new ForbiddenException('Invalid match or participant');
        }

        const booking = await this.bookingModel.findById(bookingId);
        if (!booking) {
            throw new NotFoundException('Booking not found');
        }

        if (booking.metadata?.receiverId !== userId || booking.metadata?.proposalStatus !== 'pending') {
            throw new BadRequestException('Invalid proposal or already processed');
        }

        // Update proposal status
        booking.metadata.proposalStatus = 'accepted';
        booking.markModified('metadata');
        await booking.save();

        // Notify via socket update (no new message)
        if (match.chatRoomId) {
            this.eventEmitter.emit('chat.proposal_updated', {
                chatRoomId: match.chatRoomId.toString(),
                bookingId,
                status: 'accepted'
            });
        }

        return { success: true, booking };
    }

    /**
     * Reject a match proposal
     */
    async rejectMatchProposal(userId: string, matchId: string, bookingId: string) {
        const match = await this.matchModel.findById(matchId);
        if (!match || !match.isParticipant(userId)) {
            throw new ForbiddenException('Invalid match or participant');
        }

        const booking = await this.bookingModel.findById(bookingId);
        if (!booking) {
            throw new NotFoundException('Booking not found');
        }

        if (booking.metadata?.receiverId !== userId && booking.metadata?.proposerId !== userId) {
            throw new BadRequestException('You cannot reject this proposal'); // Proposer can cancel too?
        }

        // Cancel the booking hold (bypass age check for manual rejection)
        await this.bookingsService.cancelHoldBooking(bookingId, 'Proposal rejected', null);

        // Update proposal status (if not deleted by cancel)
        if (booking.metadata) {
            booking.metadata.proposalStatus = 'rejected';
            booking.markModified('metadata');
            await booking.save(); // Might fail if cancel deleted it, but cancelBookingAndReleaseSlots usually sets status=CANCELLED
        }

        // Notify via chat
        if (match.chatRoomId) {
            const { message, chatRoom } = await this.chatService.sendSystemMessage(
                match.chatRoomId.toString(),
                JSON.stringify({
                    action: 'rejected',
                    bookingId: bookingId,
                    userId: userId
                }),
                MessageType.MATCH_PROPOSAL
            );

            this.eventEmitter.emit('chat.system_message', {
                chatRoomId: match.chatRoomId.toString(),
                message,
                chatRoom
            });

            // Update Proposal Card in UI (Force refresh)
            this.eventEmitter.emit('chat.proposal_updated', {
                chatRoomId: match.chatRoomId.toString(),
                bookingId: bookingId,
                status: 'rejected'
            });
        }

        return { success: true };
    }
}
