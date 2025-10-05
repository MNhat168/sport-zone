import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LessonType } from './entities/lesson-type.entity';

@Injectable()
export class LessonTypesService {
	constructor(
		@InjectModel(LessonType.name) private lessonTypeModel: Model<LessonType>,
	) {}

	async createLessonType(data: { type: string; name: string; description: string; user: string }): Promise<LessonType> {
		const lessonType = new this.lessonTypeModel(data);
		return lessonType.save();
	}
}
