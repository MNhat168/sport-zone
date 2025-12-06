import { UserRole } from '@common/enums/user.enum';

export class UserListDto {
  _id?: string;
  fullName: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: 'active' | 'inactive';
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export class GetAllUsersResponseDto {
  data: UserListDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
