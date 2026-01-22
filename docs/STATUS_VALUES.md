# Status Values Reference

> **Purpose**: Comprehensive reference for all status values, enums, and constants used in the system.  
> **Audience**: Frontend and Backend developers to ensure FE/BE alignment.  
> **Last Updated**: 2025-12-28

---

## Table of Contents
- [Booking Status](#booking-status)
  - [Owner-Reserved Booking](#owner-reserved-booking)
- [Transaction Status](#transaction-status)
- [Payment Methods](#payment-methods)
- [Tournament Status](#tournament-status)
- [User Roles](#user-roles)
- [Wallet Status](#wallet-status)
- [Report Status](#report-status)
- [Notification Types](#notification-types)

---

## Booking Status

### BookingType
**File**: `BE/src/common/enums/booking.enum.ts`

| Value | Description |
|-------|-------------|
| `field` | Field-only booking |
| `coach` | Coach-only booking |
| `field_coach` | Combined field + coach booking |

### BookingStatus
**File**: `BE/src/common/enums/booking.enum.ts`

| Value | Description | Usage |
|-------|-------------|-------|
| `pending` | Booking created, awaiting payment or approval | Initial state for bookings with notes or coach bookings |
| `confirmed` | Booking confirmed and paid | Active booking ready to use |
| `cancelled` | Booking cancelled | User cancelled or payment failed |
| `completed` | Booking finished | After the booking time has passed |

### Payment Status (Booking.paymentStatus)
**Note**: This is a string field on the Booking entity, not an enum.

| Value | Description | Set By |
|-------|-------------|--------|
| `unpaid` | Payment not yet made | Default when booking created |
| `paid` | Payment completed successfully | ✅ **PaymentHandlerService** after payment success |
| `refunded` | Payment refunded to user | Admin refund action |

> ⚠️ **CRITICAL FOR FE**: Backend sets `paymentStatus: 'paid'`, NOT `'completed'`!

### Owner-Reserved Booking

**File**: `BE/src/modules/bookings/entities/booking.entity.ts` (metadata field)

Owner-reserved bookings are special bookings created by field owners to reserve their own slots. These bookings are identified via the `metadata` field:

| Field | Type | Description |
|-------|------|-------------|
| `metadata.isOwnerReserved` | `boolean` | `true` if this is an owner-reserved booking |
| `metadata.originalPrice` | `number` | Original listed price of the slot at booking time |
| `metadata.systemFeeAmount` | `number` | System fee amount deducted from owner's pendingBalance |

**Characteristics of Owner-Reserved Bookings:**
- `bookingAmount = 0` (no court rental fee)
- `platformFee = 0` (no platform fee on booking amount)
- `totalPrice = 0` (no total price)
- `status = 'confirmed'` (immediately confirmed)
- `paymentStatus = 'paid'` (marked as paid)
- System fee (`metadata.systemFeeAmount`) is deducted from owner's `pendingBalance` (money on hold)

**How to Identify:**
```typescript
// Check if booking is owner-reserved
const isOwnerReserved = booking.metadata?.isOwnerReserved === true;

// Get system fee amount
const systemFee = booking.metadata?.systemFeeAmount || 0;

// Get original price
const originalPrice = booking.metadata?.originalPrice || 0;
```

**API Endpoint:**
- `POST /bookings/owner-reserved` - Create owner-reserved booking
- Requires: `AuthGuard('jwt')` + `FieldAccessGuard`
- Only field owners or staff can create these bookings

---

## Transaction Status

### TransactionStatus
**File**: `BE/src/common/enums/transaction.enum.ts`

| Value | Description | Usage |
|-------|-------------|-------|
| `pending` | Transaction initiated, awaiting processing | Initial state |
| `processing` | Transaction being processed by payment gateway | During payment |
| `succeeded` | Transaction completed successfully | ✅ Payment confirmed |
| `failed` | Transaction failed | Payment rejected or error |
| `cancelled` | Transaction cancelled by user or system | User cancelled or timeout |
| `refunded` | Transaction refunded | Admin refund |

### TransactionType
**File**: `BE/src/common/enums/transaction.enum.ts`

| Value | Description |
|-------|-------------|
| `payment` | Customer → System payment |
| `refund_full` | Full refund to customer |
| `refund_partial` | Partial refund to customer |
| `reversal` | Chargeback/reversal |
| `adjustment` | Manual adjustment (±) |
| `payout` | System → Field Owner/Coach payout |
| `fee` | Platform fee collection (includes owner-reserved booking system fee) |

---

## Payment Methods

### PaymentMethod
**File**: `BE/src/common/enums/payment-method.enum.ts`

| Value | String Name | Display Label | Description |
|-------|-------------|---------------|-------------|
| `8` | `bank_transfer` | Chuyển khoản ngân hàng | Bank transfer with proof upload |
| `10` | `internal` | Giao dịch nội bộ | Internal system transactions |
| `11` | `payos` | PayOS | PayOS payment gateway |
| `12` | `wallet` | Ví | Wallet payment |

> **Note**: PaymentMethod uses **numeric enum values** in the database, but string names for API responses.

**Utility Functions**:
```typescript
PaymentMethodUtils.getLabel(PaymentMethod.PAYOS) // "PayOS"
PaymentMethodUtils.getName(PaymentMethod.PAYOS)  // "payos"
```

---

## Tournament Status

### TournamentStatus
**File**: `BE/src/common/enums/tournament.enum.ts`

| Value | Description |
|-------|-------------|
| `draft` | Tournament created but not published |
| `upcoming` | Published, accepting registrations |
| `ongoing` | Tournament in progress |
| `completed` | Tournament finished |
| `cancelled` | Tournament cancelled |

### ReservationStatus (Tournament Field Reservation)
**File**: `BE/src/common/enums/tournament-field-reservation.enum.ts`

| Value | Description |
|-------|-------------|
| `pending` | Reservation requested |
| `confirmed` | Reservation confirmed |
| `cancelled` | Reservation cancelled |

---

## User Roles

### UserRole
**File**: `BE/src/common/enums/user-role.enum.ts`

| Value | Description |
|-------|-------------|
| `user` | Regular customer |
| `field_owner` | Field owner |
| `coach` | Coach |
| `admin` | System administrator |

---

## Wallet Status

### WalletStatus
**File**: `BE/src/common/enums/wallet.enum.ts`

| Value | Description |
|-------|-------------|
| `active` | Wallet active and usable |
| `suspended` | Wallet temporarily suspended |
| `closed` | Wallet permanently closed |

### WalletRole
**File**: `BE/src/common/enums/wallet.enum.ts`

| Value | Description |
|-------|-------------|
| `USER` | Customer wallet |
| `FIELD_OWNER` | Field owner wallet |
| `COACH` | Coach wallet |
| `ADMIN` | Admin system wallet |

---

## Report Status

### ReportStatus
**File**: `BE/src/common/enums/report.enum.ts`

| Value | Description |
|-------|-------------|
| `pending` | Report submitted, awaiting review |
| `investigating` | Admin reviewing the report |
| `resolved` | Report resolved |
| `rejected` | Report rejected as invalid |

### ReportType
**File**: `BE/src/common/enums/report.enum.ts`

| Value | Description |
|-------|-------------|
| `user` | Report against a user |
| `field` | Report against a field |
| `coach` | Report against a coach |
| `tournament` | Report against a tournament |
| `review` | Report against a review |

---

## Notification Types

### NotificationType
**File**: `BE/src/common/enums/notification-type.enum.ts`

| Value | Description |
|-------|-------------|
| `booking_confirmed` | Booking confirmed notification |
| `booking_cancelled` | Booking cancelled notification |
| `payment_success` | Payment successful notification |
| `payment_failed` | Payment failed notification |
| `tournament_registration` | Tournament registration notification |
| `review_posted` | New review posted notification |
| `system_announcement` | System-wide announcement |

---

## Sport Types & Amenities

### SportType
**File**: `BE/src/common/enums/sport-type.enum.ts`

| Value | Description |
|-------|-------------|
| `football` | Football/Soccer |
| `basketball` | Basketball |
| `volleyball` | Volleyball |
| `badminton` | Badminton |
| `tennis` | Tennis |
| `other` | Other sports |

### AmenityType
**File**: `BE/src/common/enums/sport-type.enum.ts`

| Value | Description |
|-------|-------------|
| `parking` | Parking lot |
| `shower` | Shower facilities |
| `locker` | Locker room |
| `wifi` | WiFi access |
| `cafe` | Cafe/Canteen |

---

## Common Patterns

### Status Transitions

**Booking Lifecycle**:
```
pending → confirmed → completed
   ↓
cancelled
```

**Transaction Lifecycle**:
```
pending → processing → succeeded
   ↓          ↓
cancelled   failed
```

**Payment Flow**:
```
Booking.paymentStatus: 'unpaid' → 'paid'
Transaction.status: 'pending' → 'succeeded'
Booking.status: 'pending' → 'confirmed'
```

---

## Frontend Integration Guide

### Checking Payment Success

```typescript
// ✅ CORRECT - Check for 'paid' status
if (booking.paymentStatus === 'paid' || booking.status === 'confirmed') {
  // Payment successful
}

// ❌ WRONG - Don't check for 'completed'
if (booking.paymentStatus === 'completed') {
  // This will never match!
}
```

### Checking Transaction Status

```typescript
// Check if transaction succeeded
if (transaction.status === 'succeeded') {
  // Transaction completed
}
```

### Payment Method Display

```typescript
// Display payment method label
const paymentMethodLabels = {
  8: 'Chuyển khoản ngân hàng',
  11: 'PayOS',
  12: 'Ví',
};

const label = paymentMethodLabels[booking.paymentMethod];
```

---

## API Response Examples

### Booking Response
```json
{
  "_id": "...",
  "status": "confirmed",
  "paymentStatus": "paid",
  "paymentMethod": 11,
  "type": "field",
  "user": "...",
  "field": "...",
  "date": "2025-12-28T00:00:00.000Z",
  "startTime": "14:00",
  "endTime": "16:00",
  "totalPrice": 200000
}
```

### Transaction Response
```json
{
  "_id": "...",
  "status": "succeeded",
  "type": "payment",
  "method": 11,
  "amount": 200000,
  "booking": "...",
  "user": "...",
  "createdAt": "2025-12-28T03:00:00.000Z"
}
```

---

## Notes for Developers

1. **Always use enum values from BE**: Don't hardcode status strings in FE
2. **PaymentMethod is numeric**: Store as number, display as string label
3. **Booking.paymentStatus is 'paid'**: Not 'completed' or 'success'
4. **Status transitions are one-way**: Can't go from 'completed' back to 'pending'
5. **Check both status fields**: Some entities have multiple status fields (e.g., Booking has `status` and `paymentStatus`)

---

## Changelog

- **2025-01-XX**: Added Owner-Reserved Booking documentation
  - Documented `metadata.isOwnerReserved` flag
  - Added system fee calculation and deduction logic
  - Documented API endpoint for owner-reserved bookings
- **2025-12-28**: Initial documentation created
  - Added all core status enums
  - Documented payment status mismatch issue
  - Added FE integration examples
