import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  Patch,
  Param,
  ForbiddenException,
  Get,
  Query,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { AuthGuard } from '@nestjs/passport';
import { UserRole } from '@common/enums/user.enum';
import { IsString, IsNumber, IsEnum, Min, Max, MinLength, IsOptional, MaxLength } from 'class-validator';

export class CreateCoachReviewDto {
  @IsEnum(['coach'])
  type: 'coach';
  
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;
  
  @IsString()
  @MinLength(10)
  comment: string;
  
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
  
  @IsString()
  coachId: string;
  
  @IsString()
  @IsOptional()
  bookingId: string;
}

export class CreateFieldReviewDto {
  @IsEnum(['field'])
  type: 'field';
  
  @IsNumber()
  @Min(1)
  @Max(5)
  rating: number;
  
  @IsString()
  @MinLength(10)
  comment: string;
  
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
  
  @IsString()
  fieldId: string;
  
  @IsString()
  @IsOptional()
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
      title: body.title,
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
      booking: body.bookingId && body.bookingId.trim() !== '' ? body.bookingId : '',
      type: 'field',
      rating: body.rating,
      comment: body.comment,
      title: body.title,
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

  // Get all reviews for a specific field (authenticated route)
  @UseGuards(AuthGuard('jwt'))
  @Get('field/:fieldId/all')
  async getAllReviewsForField(@Param('fieldId') fieldId: string) {
    return this.reviewsService.getAllReviewsForField(fieldId);
  }

  // Public endpoint for retrieving field reviews (used by frontend)
  // This matches the frontend expectation: GET /reviews/field/:fieldId
  @Get('field/:fieldId')
  async getPublicReviewsForField(
    @Param('fieldId') fieldId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.max(1, parseInt(limit || '10', 10) || 10);
    return this.reviewsService.getAllReviewsForField(fieldId, p, l);
  }

  // Recompute and persist field stats (totalReviews and averageRating)
  @Get('field/:fieldId/stats')
  async getFieldStats(@Param('fieldId') fieldId: string) {
    return this.reviewsService.recomputeFieldStats(fieldId);
  }

  // //Get all reviews for a specific coach
  // // Get all reviews for a specific coach (admin/authenticated route)
  // @UseGuards(AuthGuard('jwt'))
  // @Get('coach/:coachId/all')
  // async getAllReviewsForCoach(@Param('coachId') coachId: string) {
  //   return this.reviewsService.getAllReviewsForCoach(coachId);
  // }

  // Public endpoint for retrieving coach reviews (used by frontend)
  // This matches the frontend expectation: GET /reviews/coach/:coachId
  @Get('coach/:coachId')
  async getPublicReviewsForCoach(
    @Param('coachId') coachId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const p = Math.max(1, parseInt(page || '1', 10) || 1);
    const l = Math.max(1, parseInt(limit || '10', 10) || 10);
    return this.reviewsService.getAllReviewsForCoach(coachId, p, l);
  }

  // Recompute and persist coach stats (totalReviews and average rating)
  @Get('coach/:coachId/stats')
  async getCoachStats(@Param('coachId') coachId: string) {
    return this.reviewsService.recomputeCoachStats(coachId);
  }
}
