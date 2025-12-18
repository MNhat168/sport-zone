import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LessonType } from './entities/lesson-type.entity';

@Injectable()
export class LessonTypesService {
	constructor(
		@InjectModel(LessonType.name) private lessonTypeModel: Model<LessonType>,
	) {}

	async createLessonType(data: { type: string; name: string; description: string; user: string; field: string; lessonPrice: number }): Promise<LessonType> {
		const lessonType = new this.lessonTypeModel(data);
		return lessonType.save();
	}

	/**
	 * Delete a lesson type by id. Ensures the requesting user owns the lesson type.
	 */
	async deleteLessonType(id: string, userId: string): Promise<void> {
		const lt = await this.lessonTypeModel.findById(id).exec();
		if (!lt) {
			throw new NotFoundException('Lesson type not found');
		}

		// Compare owner: support ObjectId or string stored value
		const ownerId = (lt.user as any)?.toString ? (lt.user as any).toString() : String(lt.user);
		if (ownerId !== String(userId)) {
			throw new ForbiddenException('Not allowed to delete this lesson type');
		}

		await this.lessonTypeModel.deleteOne({ _id: id }).exec();
	}
}
