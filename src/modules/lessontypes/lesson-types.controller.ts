import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { LessonTypesService } from './lesson-types.service';
import { AuthGuard } from '@nestjs/passport';
import { LessonType } from './entities/lesson-type.entity';

@Controller('lesson-types')
export class LessonTypesController {
	constructor(private readonly lessonTypesService: LessonTypesService) {}

	/**
	 * Create a new lesson type for the current user
	 */
	@UseGuards(AuthGuard('jwt'))
	@Post()
	async createLessonType(@Request() req, @Body() body: { type: string; name: string; description: string }): Promise<LessonType> {
		const userId = req.user._id;
		return this.lessonTypesService.createLessonType({ ...body, user: userId });
	}
}
