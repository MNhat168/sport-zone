import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Patch,
  Param,
  ForbiddenException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '../users/entities/user.entity';

export class CreateCoachReviewDto {
  type: 'coach';
  rating: number;
  comment: string;
  coachId: string;
  bookingId: string;
}

export class CreateFieldReviewDto {
  type: 'field';
  rating: number;
  comment: string;
  fieldId: string;
  bookingId: string;
}

export class RespondReviewDto {
  response: string;
}

export class ModerateReviewDto {
  isModerated: boolean;
}

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  //Send coach review
  @UseGuards(AuthGuard('jwt'))
  @Post('coach')
  async createCoachReview(@Request() req, @Body() body: CreateCoachReviewDto) {
    const userId = req.user._id || req.user.id;
    return this.reviewsService.createCoachReview({
      user: userId,
      coach: body.coachId,
      booking: body.bookingId,
      type: 'coach',
      rating: body.rating,
      comment: body.comment,
    });
  }

  // Send field review
  @UseGuards(AuthGuard('jwt'))
  @Post('field')
  async createFieldReview(@Request() req, @Body() body: CreateFieldReviewDto) {
    const userId = req.user._id || req.user.id;
    return this.reviewsService.createFieldReview({
      user: userId,
      field: body.fieldId,
      booking: body.bookingId,
      type: 'field',
      rating: body.rating,
      comment: body.comment,
    });
  }

  // Respond to review
  @UseGuards(AuthGuard('jwt'))
  @Patch(':id/respond')
  async respondToReview(
    @Request() req,
    @Param('id') reviewId: string,
    @Body() body: RespondReviewDto,
  ) {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role;
    // Only coach or field_owner can respond
    if (userRole !== UserRole.COACH && userRole !== UserRole.FIELD_OWNER) {
      throw new ForbiddenException(
        'Only coach or field owner can respond to reviews',
      );
    }
    return this.reviewsService.respondToReview({
      reviewId,
      userId,
      userRole,
      response: body.response,
    });
  }

  // // Moderate review
  // @UseGuards(AuthGuard('jwt'))
  // @Patch(':id/moderate')
  // async moderateReview(
  //   @Request() req,
  //   @Param('id') reviewId: string,
  //   @Body() body: ModerateReviewDto,
  // ) {
  //   const userRole = req.user.role;
  //   if (userRole !== 'admin') {
  //     throw new ForbiddenException('Only admin can moderate reviews');
  //   }
  //   return this.reviewsService.moderateReview({
  //     reviewId,
  //     isModerated: body.isModerated,
  //   });
  // }

  // Get all reviews for a specific field
  @UseGuards(AuthGuard('jwt'))
  @Post('field/:fieldId/all')
  async getAllReviewsForField(@Param('fieldId') fieldId: string) {
    return this.reviewsService.getAllReviewsForField(fieldId);
  }

  //Get all reviews for a specific coach
  @UseGuards(AuthGuard('jwt'))
  @Post('coach/:coachId/all')
  async getAllReviewsForCoach(@Param('coachId') coachId: string) {
    return this.reviewsService.getAllReviewsForCoach(coachId);
  }
}
