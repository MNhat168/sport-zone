import { Controller, Post, Body, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LessonTypesService } from './lesson-types.service';
import { AuthGuard } from '@nestjs/passport';
import { LessonType } from './entities/lesson-type.entity';
import { CreateLessonTypeDto } from './dto/create-lesson-type.dto';

@ApiTags('Lesson Types')
@Controller('lesson-types')
export class LessonTypesController {
	constructor(private readonly lessonTypesService: LessonTypesService) {}

	/**
	 * Create a new lesson type for the current user
	 */
	@Post()
	@UseGuards(AuthGuard('jwt'))
	@ApiBearerAuth()
	@ApiOperation({ summary: 'Create a new lesson type' })
	@ApiResponse({ status: 201, description: 'Lesson type created successfully' })
	@ApiResponse({ status: 401, description: 'Unauthorized' })
	async createLessonType(
		@Request() req, 
		@Body() createLessonTypeDto: CreateLessonTypeDto
	): Promise<LessonType> {
		const userId = req.user._id || req.user.id;
		return this.lessonTypesService.createLessonType({ 
			...createLessonTypeDto, 
			user: userId 
		});
	}
}
