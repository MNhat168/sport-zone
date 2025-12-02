import { IsArray, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { TransactionStatus, TransactionType } from '../../transactions/entities/transaction.entity'
import { PaymentMethod } from '../../../common/enums/payment-method.enum'

export class ListTransactionsDto {
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @IsArray()
  @IsEnum(TransactionStatus, { each: true })
  @Type(() => String)
  status?: TransactionStatus[]

  @IsOptional()
  @IsArray()
  @IsEnum(TransactionType, { each: true })
  @Type(() => String)
  type?: TransactionType[]

  @IsOptional()
  @IsArray()
  @IsIn(['cash','ebanking','credit_card','debit_card','momo','zalopay','vnpay','bank_transfer','qr_code','internal','payos'], { each: true })
  @Type(() => String)
  method?: string[]

  @IsOptional()
  @IsDateString()
  startDate?: string

  @IsOptional()
  @IsDateString()
  endDate?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 10

  @IsOptional()
  @IsIn(['createdAt','amount','status','type','method'])
  sortBy?: 'createdAt'|'amount'|'status'|'type'|'method' = 'createdAt'

  @IsOptional()
  @IsIn(['asc','desc'])
  sortOrder?: 'asc'|'desc' = 'desc'
}
