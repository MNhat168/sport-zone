import { WalletDocument } from '../entities/wallet.entity';

/**
 * DTO cho Field Owner Wallet Response
 * Chỉ hiển thị pendingBalance (UI display only)
 */
export class FieldOwnerWalletDto {
  pendingBalance: number;
  currency: string;
  message: string;
  lastTransactionAt?: Date;

  static fromWallet(wallet: WalletDocument): FieldOwnerWalletDto {
    const pendingBalance = wallet.pendingBalance || 0;
    return {
      pendingBalance,
      currency: wallet.currency,
      message:
        pendingBalance > 0
          ? 'Sẽ được chuyển vào tài khoản sau khi khách check-in'
          : 'Chưa có doanh thu chờ xử lý',
      lastTransactionAt: wallet.lastTransactionAt,
    };
  }
}

/**
 * DTO cho User Wallet Response
 * Chỉ có refundBalance (lazy creation)
 * Return null nếu user chưa có wallet
 */
export class UserWalletDto {
  refundBalance: number;
  currency: string;
  message: string;
  lastTransactionAt?: Date;

  static fromWallet(wallet: WalletDocument): UserWalletDto {
    return {
      refundBalance: wallet.refundBalance || 0,
      currency: wallet.currency,
      message: 'Bạn có thể dùng để đặt sân hoặc rút về tài khoản',
      lastTransactionAt: wallet.lastTransactionAt,
    };
  }
}

/**
 * DTO cho Admin Wallet Response
 * Hiển thị systemBalance (real money)
 */
export class AdminWalletDto {
  systemBalance: number;
  currency: string;
  lastTransactionAt?: Date;

  static fromWallet(wallet: WalletDocument): AdminWalletDto {
    return {
      systemBalance: wallet.systemBalance || 0,
      currency: wallet.currency,
      lastTransactionAt: wallet.lastTransactionAt,
    };
  }
}
