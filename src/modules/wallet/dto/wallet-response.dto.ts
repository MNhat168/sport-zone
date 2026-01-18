import { WalletDocument } from '../entities/wallet.entity';

/**
 * DTO cho Field Owner Wallet Response
 * Hien thi pendingBalance (cho check-in) va availableBalance (co the rut)
 */
export class FieldOwnerWalletDto {
  pendingBalance: number;
  availableBalance: number;
  currency: string;
  message: string;
  lastTransactionAt?: Date;

  static fromWallet(wallet: WalletDocument): FieldOwnerWalletDto {
    const pendingBalance = wallet.pendingBalance || 0;
    const availableBalance = wallet.availableBalance || 0;

    let message = 'Chưa có doanh thu';
    if (availableBalance > 0 && pendingBalance > 0) {
      message = 'Có thể rút tiền và đang chờ check-in';
    } else if (availableBalance > 0) {
      message = 'Có thể rút tiền về tài khoản ngân hàng';
    } else if (pendingBalance > 0) {
      message = 'Sẽ được mở khóa sau khi khách check-in';
    }

    return {
      pendingBalance,
      availableBalance,
      currency: wallet.currency,
      message,
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
