## Booking & Field API (for FE)

All #### Create field booking (Pure Lazy Creation)

- **Method**: POST
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
  "selectedAmenities": []
}
```

**Note**: 
- `selectedAmenities` can be empty array `[]` if no amenities selected
- JWT token must be valid and contain `userId` field
- `fieldId` must be a valid ObjectId of an existing fieldN. Unless marked Public, include Authorization header with Bearer access token.

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
  "totalPrice": 0,
  "selectedAmenities": ["string"],
  "amenitiesFee": 0,
  "pricingSnapshot": {
    "basePrice": 150000,
    "appliedMultiplier": 1.5,
    "priceBreakdown": "09:00-10:00: 1.5x base price"
  }
}
```

#### Create field booking (Legacy endpoint - DEPRECATED)

- **Method**: POST
- **Path**: `/bookings/legacy`
- **Auth**: Required (Bearer)

**Request Body**:

```json
{
  "scheduleId": "string",
  "startTime": "HH:mm", 
  "endTime": "HH:mm",
  "totalPrice": 0
}
```

> **⚠️ Note**: This endpoint is deprecated. Use Pure Lazy Creation endpoint instead.

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
  "selectedAmenities": ["string"]
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
    "totalPrice": 0,
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
    "totalPrice": 0,
    "coachStatus": "pending"
  }
}
```

#### Create session booking (Legacy - DEPRECATED)

- **Method**: POST
- **Path**: `/bookings/session/legacy`
- **Auth**: Required (Bearer)

**Request Body**:

```json
{
  "fieldScheduleId": "string",
  "coachScheduleId": "string",
  "fieldStartTime": "HH:mm",
  "fieldEndTime": "HH:mm",
  "coachStartTime": "HH:mm",
  "coachEndTime": "HH:mm",
  "fieldPrice": 0,
  "coachPrice": 0
}
```

> **⚠️ Note**: This endpoint is deprecated. Use Pure Lazy Creation endpoint instead.

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

- Booking entity now includes `date`, `pricingSnapshot`, and `selectedAmenities`
- `numSlots` is computed based on Field `slotDuration` and time range
- Pricing is captured at booking time for consistency
- Legacy endpoints are maintained for backward compatibility

**Error Handling:**

- Errors follow standard NestJS format with message and statusCode


