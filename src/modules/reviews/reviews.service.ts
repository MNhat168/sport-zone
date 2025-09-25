import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Review, ReviewType } from './entities/review.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<Review>,
  ) {}

  // Create coach review service *
  async createCoachReview(data: {
    user: string;
    coach: string;
    booking: string;
    type: 'coach';
    rating: number;
    comment: string;
  }) {
    // Validate rating and comment
    if (data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    if (!data.comment || data.comment.length < 10) {
      throw new BadRequestException('Comment must be at least 10 characters');
    }
    const review = new this.reviewModel({
      user: data.user,
      coach: data.coach,
      booking: data.booking,
      type: ReviewType.COACH,
      rating: data.rating,
      comment: data.comment,
    });
    await review.save();
    return review;
  }

  // Create field review service *
  async createFieldReview(data: {
    user: string;
    field: string;
    booking: string;
    type: 'field';
    rating: number;
    comment: string;
  }) {
    if (data.rating < 1 || data.rating > 5) {
      throw new BadRequestException('Rating must be between 1 and 5');
    }
    if (!data.comment || data.comment.length < 10) {
      throw new BadRequestException('Comment must be at least 10 characters');
    }
    const review = new this.reviewModel({
      user: data.user,
      field: data.field,
      booking: data.booking,
      type: ReviewType.FIELD,
      rating: data.rating,
      comment: data.comment,
    });
    await review.save();
    return review;
  }

  // Respond to review service *
  async respondToReview(data: {
    reviewId: string;
    userId: string;
    userRole: string;
    response: string;
  }) {
    // Find review
    const review = await this.reviewModel.findById(data.reviewId);
    if (!review) {
      throw new BadRequestException('Review not found');
    }
    // Only coach can respond to coach review, only field_owner to field review
    if (review.type === ReviewType.COACH) {
      if (
        data.userRole !== 'coach' ||
        String(review.coach) !== String(data.userId)
      ) {
        throw new BadRequestException(
          'You are not authorized to respond to this coach review',
        );
      }
    } else if (review.type === ReviewType.FIELD) {
      if (
        data.userRole !== 'field_owner' ||
        String(review.field) !== String(data.userId)
      ) {
        throw new BadRequestException(
          'You are not authorized to respond to this field review',
        );
      }
    } else {
      throw new BadRequestException('Invalid review type');
    }
    // Save response
    review.response = data.response;
    await review.save();
    return review;
  }

  // // Moderate review service (admin only) *
  // async moderateReview(data: { reviewId: string; isModerated: boolean }) {
  //   const review = await this.reviewModel.findById(data.reviewId);
  //   if (!review) {
  //     throw new BadRequestException('Review not found');
  //   }
  //   review.isModerated = data.isModerated;
  //   if (data.isModerated) {
  //     review.moderationResult = 'Your review has been removed';
  //   } else {
  //     review.moderationResult = undefined;
  //   }
  //   await review.save();
  //   return review;
  // }

  // Get all reviews for a specific field *
  async getAllReviewsForField(fieldId: string) {
    return this.reviewModel.find({ field: fieldId, type: ReviewType.FIELD });
  }

  // Get all reviews for a specific coach *
  async getAllReviewsForCoach(coachId: string) {
    return this.reviewModel.find({ coach: coachId, type: ReviewType.COACH });
  }
}
