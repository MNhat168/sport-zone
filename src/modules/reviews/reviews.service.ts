import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import { Review, ReviewType } from './entities/review.entity';
import { Booking, BookingType } from '../bookings/entities/booking.entity';
import { CoachProfile } from 'src/modules/coaches/entities/coach-profile.entity';

@Injectable()
export class ReviewsService {
  constructor(
    @InjectModel(Review.name) private readonly reviewModel: Model<Review>,
    @InjectModel(Booking.name) private readonly bookingModel: Model<Booking>,
    @InjectModel(CoachProfile.name) private readonly coachProfileModel: Model<CoachProfile>,
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

    let bookingId = data.booking;

    // If bookingId is not provided, try to auto-attach the latest booking for this user and coach
    if (!bookingId) {
      const latestBooking = await this.bookingModel.findOne({
        user: data.user,
        requestedCoach: data.coach,
        type: BookingType.COACH,
      })
        .sort({ createdAt: -1 })
        .exec();
      if (latestBooking) {
        bookingId = String(latestBooking._id);
      }
    }

    // If bookingId is now present, validate it
    if (bookingId) {
      const booking = await this.bookingModel.findById(bookingId).exec();
      if (!booking) {
        throw new BadRequestException('Booking not found');
      }
      if (String(booking.user) !== String(data.user)) {
        throw new BadRequestException('Booking does not belong to the current user');
      }
      if (booking.requestedCoach && String(booking.requestedCoach) !== String(data.coach)) {
        throw new BadRequestException('Provided coach does not match the coach on the booking');
      }
      if (booking.type && booking.type !== BookingType.COACH) {
        throw new BadRequestException('Booking is not a coach booking');
      }
    }

    // Use a transaction to ensure review creation and coach profile update are atomic
    const session: ClientSession = await this.reviewModel.db.startSession();
    session.startTransaction();
    try {
      const review = await this.reviewModel.create([
        {
          user: data.user,
          coach: data.coach,
          booking: bookingId,
          type: ReviewType.COACH,
          rating: data.rating,
          comment: data.comment,
        },
      ], { session });

      // update coach profile counters and rating
      if (data.coach) {
        const profile = await this.coachProfileModel.findById(data.coach).session(session).exec();
        if (profile) {
          const oldCount = (profile.totalReviews ?? 0);
          const oldAvg = (profile.rating ?? 0);
          const newCount = oldCount + 1;
          const newAvg = (oldAvg * oldCount + data.rating) / newCount;

          await this.coachProfileModel.findByIdAndUpdate(
            data.coach,
            {
              $inc: { totalReviews: 1 },
              $set: { rating: newAvg },
            },
            { session }
          ).exec();
        }
      }

      await session.commitTransaction();
      session.endSession();
      return review[0];
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
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
    // If bookingId provided, validate booking exists and belongs to the user
    if (data.booking) {
      const booking = await this.bookingModel.findById(data.booking).exec();
      if (!booking) {
        throw new BadRequestException('Booking not found');
      }
      if (String(booking.user) !== String(data.user)) {
        throw new BadRequestException('Booking does not belong to the current user');
      }
      // Ensure booking.field matches provided field
      if (booking.field && String(booking.field) !== String(data.field)) {
        throw new BadRequestException('Provided field does not match the field on the booking');
      }
      // Optional: ensure booking type is field
      if (booking.type && booking.type !== BookingType.FIELD) {
        throw new BadRequestException('Booking is not a field booking');
      }
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

  // Get all reviews for a specific coach with pagination
  async getAllReviewsForCoach(coachId: string, page = 1, limit = 10) {
    const filter = { coach: coachId, type: ReviewType.COACH } as any;
    const skip = Math.max(0, (page - 1) * limit);

    const [items, total] = await Promise.all([
      this.reviewModel
        .find(filter)
        .populate('user', 'fullName')
        .populate('booking', 'createdAt startTime')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.reviewModel.countDocuments(filter).exec(),
    ]);

    return {
      data: items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
      },
    };
  }
}
