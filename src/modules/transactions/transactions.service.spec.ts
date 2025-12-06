import { TransactionsService } from './transactions.service';
import { PaymentMethod } from 'src/common/enums/payment-method.enum';
import { TransactionStatus, TransactionType } from '@common/enums/transaction.enum';

describe('TransactionsService - coach verification', () => {
  class TransactionModelMock {
    public _id = 'tx_mock_1';
    public savedDoc: any;
    constructor(public doc: any) {
      this.savedDoc = doc;
    }
    async save() {
      return { _id: this._id, ...this.doc } as any;
    }
  }

  const configService: any = { get: jest.fn() };

  it('should create verification transaction with correct metadata', async () => {
    const service = new TransactionsService((TransactionModelMock as unknown) as any, configService);

    const tx = await service.createCoachBankVerificationTransaction({
      coachUserId: '507f1f77bcf86cd799439011',
      coachProfileId: '507f1f77bcf86cd799439012',
      bankAccountNumber: '9704xxxxxxxx1234',
      bankName: 'Techcombank',
      method: PaymentMethod.VNPAY,
      amount: 10000,
    });

    expect(tx).toBeDefined();
    expect(tx.amount).toBe(10000);
    expect(tx.method).toBe(PaymentMethod.VNPAY);
    expect(tx.type).toBe(TransactionType.PAYMENT);
    expect(tx.status).toBe(TransactionStatus.PENDING);
    expect(tx.metadata).toMatchObject({
      purpose: 'ACCOUNT_VERIFICATION',
      targetRole: 'coach',
      coachId: '507f1f77bcf86cd799439012',
      bankAccount: '9704xxxxxxxx1234',
      bankName: 'Techcombank',
    });
  });
});
