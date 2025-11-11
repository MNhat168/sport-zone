import { IsObject, IsOptional, IsString } from 'class-validator';

export class CreateWalletDto {
  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

