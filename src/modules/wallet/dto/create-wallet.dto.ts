import { IsOptional, IsString } from 'class-validator';

export class CreateWalletDto {
  @IsOptional()
  @IsString()
  currency?: string;
}

