import { Controller, Get, Post, Delete, Patch, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { JwtAccessTokenGuard } from '../auth/guards/jwt-access-token.guard';
import { MatchingService } from './matching.service';
import {
    CreateMatchProfileDto,
    UpdateMatchProfileDto,
    SwipeDto,
    GetMatchCandidatesDto,
    ScheduleMatchDto,
} from './dto/matching.dto';
import { CreateFieldBookingLazyDto } from '../bookings/dto/create-field-booking-lazy.dto';

@Controller('matching')
@UseGuards(JwtAccessTokenGuard)
export class MatchingController {
    constructor(private readonly matchingService: MatchingService) { }

    /**
     * Create or update user's match profile
     */
    @Post('profile')
    async createOrUpdateProfile(@Req() req, @Body() dto: CreateMatchProfileDto | UpdateMatchProfileDto) {
        return this.matchingService.createOrUpdateMatchProfile(req.user.userId, dto);
    }

    /**
     * Get user's own match profile
     */
    @Get('profile')
    async getProfile(@Req() req) {
        return this.matchingService.getMatchProfile(req.user.userId);
    }

    /**
     * Get match candidates based on filters
     */
    @Get('candidates')
    async getCandidates(@Req() req, @Query() dto: GetMatchCandidatesDto) {
        return this.matchingService.getMatchCandidates(req.user.userId, dto);
    }

    /**
     * Swipe on a user (like, pass, or super like)
     */
    @Post('swipe')
    async swipe(@Req() req, @Body() dto: SwipeDto) {
        return this.matchingService.swipeUser(req.user.userId, dto);
    }

    /**
     * Get all matches for the user
     */
    @Get('matches')
    async getMatches(@Req() req, @Query('status') status?: string) {
        return this.matchingService.getMatches(req.user.userId, status as any);
    }

    /**
     * Get a specific match by ID
     */
    @Get('matches/:id')
    async getMatch(@Req() req, @Param('id') matchId: string) {
        return this.matchingService.getMatch(matchId, req.user.userId);
    }

    /**
     * Unmatch from a user
     */
    @Delete('matches/:id')
    async unmatch(@Req() req, @Param('id') matchId: string) {
        return this.matchingService.unmatch(req.user.userId, matchId);
    }

    /**
     * Schedule a match with field and time
     */
    @Post('matches/:id/schedule')
    async scheduleMatch(@Req() req, @Param('id') matchId: string, @Body() dto: ScheduleMatchDto) {
        return this.matchingService.scheduleMatch(req.user.userId, matchId, dto);
    }

    /**
     * Cancel a scheduled match
     */
    @Delete('matches/:id/cancel')
    async cancelMatch(@Req() req, @Param('id') matchId: string) {
        return this.matchingService.cancelMatch(req.user.userId, matchId);
    }

    /**
     * Book a match with field and time
     */
    @Post('matches/:id/book')
    async bookMatch(@Req() req, @Param('id') matchId: string, @Body() dto: CreateFieldBookingLazyDto) {
        return this.matchingService.bookMatch(req.user.userId, matchId, dto);
    }

    /**
     * Get user's swipe history
     */
    @Get('swipes/history')
    async getSwipeHistory(@Req() req, @Query('sportType') sportType?: string) {
        return this.matchingService.getSwipeHistory(req.user.userId, sportType as any);
    }

    /**
     * Propose a match with split payment
     */
    @Post('matches/:id/propose')
    async proposeMatch(@Req() req, @Param('id') matchId: string, @Body() dto: CreateFieldBookingLazyDto) {
        return this.matchingService.proposeMatch(req.user.userId, matchId, dto);
    }

    /**
     * Accept a match proposal
     */
    @Post('matches/:id/propose/:bookingId/accept')
    async acceptMatchProposal(@Req() req, @Param('id') matchId: string, @Param('bookingId') bookingId: string) {
        return this.matchingService.acceptMatchProposal(req.user.userId, matchId, bookingId);
    }

    /**
     * Reject a match proposal
     */
    @Post('matches/:id/propose/:bookingId/reject')
    async rejectMatchProposal(@Req() req, @Param('id') matchId: string, @Param('bookingId') bookingId: string) {
        return this.matchingService.rejectMatchProposal(req.user.userId, matchId, bookingId);
    }
}
