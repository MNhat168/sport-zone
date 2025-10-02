## Booking & Field API (for FE)

All responses are JSON. Unless marked Public, include Aut**Request Body**:

```json
{
  "fieldId": "string",
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "selectedAmenities": ["string"], // tiện ích bổ sung (optional)
  "paymentMethod": 1, // 1=CASH, 2=EBANKING, 3=CARD, etc. (optional, defaults to 1)
  "paymentNote": "string" // ghi chú thanh toán (optional)
}
```header with Bearer access token.

- Authorization: Bearer <access_token>
- Base URL: /api (example); endpoints below are relative to server root.

### Bookings

#### Create field booking (Pure Lazy Creation)

- **Met
- **Path**: `/bookings/field`
- **Auth**: Required (Bearer token in Authorization header)

**Important**: Make sure you have a valid JWT token from login endpoint.

**Request Body**:

```json
{
  "fieldId": "68de499fb7dc39ae9898bd33",
  "date": "2025-10-20",
  "startTime": "08:00",
  "endTime": "10:00",
  "selectedAmenities": [],
  "paymentMethod": 1,
  "paymentNote": "Trả tiền mặt tại sân"
}
```

**Note**: 
- `selectedAmenities` can be empty array `[]` if no amenities selected
- `paymentMethod` is optional, defaults to `1` (cash) if not provided
- `paymentNote` is optional, can contain payment details like account number, transaction ID, etc.
- JWT token must be valid and contain `userId` field
- `fieldId` must be a valid ObjectId of an existing field

**Payment Methods Available**:
- `1` - Trả tiền mặt (cash)
- `2` - Internet Banking (ebanking)
- `3` - Thẻ tín dụng (credit_card)
- `4` - Thẻ ghi nợ (debit_card)
- `5` - Ví MoMo (momo)
- `6` - ZaloPay (zalopay)
- `7` - VNPay (vnpay)
- `8` - Chuyển khoản ngân hàng (bank_transfer)
- `9` - QR Code (qr_code)

All responses are JSON. Unless marked Public, include Authorization header with Bearer access token.

- Authorization: Bearer <access_token>
- Base URL: /api (example); endpoints below are relative to server root.

### Bookings

#### Get field availability (Pure Lazy Creation)

- **Method**: GET
- **Path**: `/fields/:fieldId/availability`
- **Auth**: Public
- **Query Parameters**:
  - startDate: "YYYY-MM-DD" (required)
  - endDate: "YYYY-MM-DD" (required)
- **Example**: `GET /fields/507f1f77bcf86cd799439011/availability?startDate=2025-10-01&endDate=2025-10-31`

**Success 200**:

```json
[
  {
    "date": "2025-10-15",
    "isHoliday": false,
    "slots": [
      {
        "startTime": "09:00",
        "endTime": "10:00",
        "available": true,
        "price": 150000,
        "priceBreakdown": "09:00-10:00: 1.5x base price"
      }
    ]
  }
]
```

#### Create field booking (Pure Lazy Creation)

- **Method**: POST
- **Path**: `/bookings/field`
- **Auth**: Required (Bearer)

**Request Body**:

```json
{
  "fieldId": "string",
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "selectedAmenities": ["string"] //tiện ích bổ xung
}
```

**Success 201**:

```json
{
  "_id": "string",
  "user": "string",
  "field": "string",
  "date": "YYYY-MM-DD",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "numSlots": 1,
  "type": "FIELD",
  "status": "PENDING",
  "totalPrice": 150000,
  "selectedAmenities": ["string"],
  "amenitiesFee": 0,
  "payment": "string", // Payment ObjectId reference
  "pricingSnapshot": {
    "basePrice": 150000,
    "appliedMultiplier": 1.5,
    "priceBreakdown": "09:00-10:00: 1.5x base price"
  }
}
```

**Note**: Payment information is now stored in a separate Payment entity. To get payment details, use the Payment API with the `payment` ObjectId.



#### Cancel field booking

- **Method**: PATCH
- **Path**: `/bookings/:id/cancel`
- **Auth**: Required (Bearer)
- **Params**:
  - id: booking id (string)

**Request Body** (optional):

```json
{ 
  "cancellationReason": "string" 
}
```

**Success 200**:

```json
{
  "_id": "string",
  "status": "CANCELLED",
  "cancellationReason": "string"
}
```

#### Create session booking (field + coach) - Pure Lazy Creation

- **Method**: POST
- **Path**: `/bookings/session`
- **Auth**: Required (Bearer)

**Request Body**:

```json
{
  "fieldId": "string",
  "coachId": "string",
  "date": "YYYY-MM-DD",
  "fieldStartTime": "HH:mm",
  "fieldEndTime": "HH:mm",
  "coachStartTime": "HH:mm",
  "coachEndTime": "HH:mm",
  "selectedAmenities": ["string"], // optional
  "paymentMethod": 2, // 1=CASH, 2=EBANKING, 3=CARD, etc. (optional)
  "paymentNote": "Chuyển khoản Vietcombank - STK: 1234567890" // optional
}
```

**Success 201**:

```json
{
  "fieldBooking": {
    "_id": "string",
    "user": "string",
    "field": "string",
    "date": "YYYY-MM-DD",
    "type": "FIELD",
    "status": "PENDING",
    "startTime": "HH:mm",
    "endTime": "HH:mm",
    "numSlots": 1,
    "totalPrice": 150000,
    "payment": "string", // Payment ObjectId reference
    "pricingSnapshot": {
      "basePrice": 150000,
      "appliedMultiplier": 1.5
    }
  },
  "coachBooking": {
    "_id": "string",
    "user": "string",
    "field": "string",
    "requestedCoach": "string",
    "date": "YYYY-MM-DD",
    "type": "COACH",
    "status": "PENDING",
    "startTime": "HH:mm",
    "endTime": "HH:mm",
    "numSlots": 1,
    "totalPrice": 300000,
    "payment": "string", // Payment ObjectId reference
    "coachStatus": "pending"
  }
}
```

**Note**: Payment information is stored in separate Payment entities. Use the Payment API with the `payment` ObjectIds to get payment details.



#### Cancel session booking (field + coach)

- **Method**: PATCH
- **Path**: `/bookings/session/cancel`
- **Auth**: Required (Bearer)

**Request Body**:

```json
{
  "fieldBookingId": "string",
  "coachBookingId": "string",
  "cancellationReason": "string"
}
```

**Success 200**:

```json
{
  "fieldBooking": { 
    "_id": "string", 
    "status": "CANCELLED",
    "cancellationReason": "string"
  },
  "coachBooking": { 
    "_id": "string", 
    "status": "CANCELLED",
    "cancellationReason": "string"
  }
}
```

#### Get bookings by coach

- **Method**: GET
- **Path**: `/bookings/coach/:coachId`
- **Auth**: Optional (depends on gateway/policy)
- **Params**:
  - coachId: string

**Success 200**: Array of booking objects with populated `user`, `field`, and `requestedCoach`.

### Payments

#### Get payment details by booking ID

- **Method**: GET
- **Path**: `/payments/booking/:bookingId`
- **Auth**: Required (Bearer)
- **Params**:
  - bookingId: string (Booking ObjectId)

**Success 200**:

```json
{
  "_id": "string",
  "booking": "string",
  "user": "string",
  "amount": 150000,
  "method": 1, // PaymentMethod enum
  "status": "PENDING", // PENDING, COMPLETED, FAILED, REFUNDED
  "paymentNote": "Trả tiền mặt tại sân",
  "transactionId": null,
  "paidBy": "string",
  "createdAt": "2025-10-02T10:00:00.000Z",
  "updatedAt": "2025-10-02T10:00:00.000Z"
}
```

#### Update payment status

- **Method**: PATCH
- **Path**: `/payments/:paymentId/status`
- **Auth**: Required (Bearer - Admin/Staff)
- **Params**:
  - paymentId: string (Payment ObjectId)

**Request Body**:

```json
{
  "status": "COMPLETED", // PENDING, COMPLETED, FAILED, REFUNDED
  "transactionId": "TXN_123456789" // optional
}
```

**Success 200**:

```json
{
  "_id": "string",
  "status": "COMPLETED",
  "transactionId": "TXN_123456789",
  "updatedAt": "2025-10-02T10:05:00.000Z"
}
```

### Schedules

#### Get coach schedule by date range

- **Method**: GET
- **Path**: `/schedules/coach/:coachId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD`
- **Auth**: Public
- **Params**:
  - coachId: string
  - startDate, endDate: ISO date strings (YYYY-MM-DD)

**Success 200**:

```json
[
  {
    "date": "2025-09-29T00:00:00.000Z",
    "isHoliday": false,
    "slots": [ 
      { 
        "startTime": "09:00", 
        "endTime": "10:00", 
        "available": true 
      } 
    ]
  }
]
```

#### Set coach holiday

- **Method**: POST
- **Path**: `/schedules/set-holiday`
- **Auth**: Depends on policy (likely admin/coach)

**Request Body**:

```json
{ 
  "coachId": "string", 
  "startDate": "YYYY-MM-DD", 
  "endDate": "YYYY-MM-DD" 
}
```

**Success 200**:

```json
{ 
  "modifiedCount": 1 
}
```

### Notes

**Pure Lazy Creation Implementation:**

- Bookings now use `field` + `date` instead of `schedule` references
- Schedules are created on-demand during booking process
- No need to pre-create schedules for availability checks
- Better performance and reduced storage overhead

**Authentication:**

- Auth user id in handlers is derived from JWT: `req.user.userId` (some handlers fallback to `_id` or `id`)

**Data Structure Changes:**

- Booking entity now includes `date`, `pricingSnapshot`, `selectedAmenities`, and `payment` reference
- Payment information is stored in separate Payment entities with numeric PaymentMethod enum (1-9)
- `numSlots` is computed based on Field `slotDuration` and time range
- Pricing is captured at booking time for consistency
- Legacy endpoints have been removed for cleaner architecture

**Payment System:**

- Payment methods are stored as numeric enums for better performance
- Each booking creates a corresponding Payment entity for tracking
- Payment status can be updated independently from booking status
- Supports transaction IDs for external payment gateway integration

**Error Handling:**

- Errors follow standard NestJS format with message and statusCode


