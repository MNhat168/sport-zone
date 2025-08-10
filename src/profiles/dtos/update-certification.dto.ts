import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateCertificationDto {
  @IsString()
  @IsNotEmpty()
  certification: string;
}
