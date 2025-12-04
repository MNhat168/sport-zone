import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReportMessageDto {
  @ApiPropertyOptional({ description: 'Message content (optional if attachments present)' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;
}