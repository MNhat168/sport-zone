## Booking & Field API (for FE)

All responses are JSON. Unless marked Public, include Authorization header with Bearer access token.

- Authorization: Bearer <access_token>
- Base URL: /api (example); endpoints below are relative to server root.

### Bookings

1) Create field booking
- Method: POST
- Path: /bookings/field
- Auth: Required (Bearer)
- Body:
```json
{
  "scheduleId": "string",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "totalPrice": 0
}
```
- Success 201:
```json
{
  "_id": "string",
  "user": "string",
  "schedule": "string",
  "field": "string",
  "startTime": "HH:mm",
  "endTime": "HH:mm",
  "numSlots": 1,
  "type": "FIELD",
  "status": "PENDING",
  "totalPrice": 0
}
```

2) Cancel field booking
- Method: PATCH
- Path: /bookings/:id/cancel
- Auth: Required (Bearer)
- Params:
  - id: booking id (string)
- Body (optional):
```json
{ "cancellationReason": "string" }
```
- Success 200:
```json
{
  "_id": "string",
  "status": "CANCELLED",
  "cancellationReason": "string"
}
```

3) Create session booking (field + coach)
- Method: POST
- Path: /bookings/session
- Auth: Required (Bearer)
- Body:
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
- Success 201:
```json
{
  "fieldBooking": {
    "_id": "string",
    "type": "FIELD",
    "status": "PENDING",
    "startTime": "HH:mm",
    "endTime": "HH:mm",
    "numSlots": 1
  },
  "coachBooking": {
    "_id": "string",
    "type": "COACH",
    "status": "PENDING",
    "startTime": "HH:mm",
    "endTime": "HH:mm",
    "numSlots": 1
  }
}
```

4) Cancel session booking (field + coach)
- Method: PATCH
- Path: /bookings/session/cancel
- Auth: Required (Bearer)
- Body:
```json
{
  "fieldBookingId": "string",
  "coachBookingId": "string",
  "cancellationReason": "string"
}
```
- Success 200:
```json
{
  "fieldBooking": { "_id": "string", "status": "CANCELLED" },
  "coachBooking": { "_id": "string", "status": "CANCELLED" }
}
```

5) Coach: get bookings by coach
- Method: GET
- Path: /bookings/coach/:coachId
- Auth: Optional (depends on gateway/policy)
- Params:
  - coachId: string
- Success 200: Array of booking objects (populated `user`, `schedule`, `requestedCoach`).

### Schedules

1) Get coach schedule by date range
- Method: GET
- Path: /schedules/coach/:coachId?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
- Auth: Public
- Params:
  - coachId: string
  - startDate, endDate: ISO date strings (YYYY-MM-DD)
- Success 200:
```json
[
  {
    "date": "2025-09-29T00:00:00.000Z",
    "isHoliday": false,
    "slots": [ { "startTime": "09:00", "endTime": "10:00", "available": true } ]
  }
]
```

2) Set coach holiday
- Method: POST
- Path: /schedules/set-holiday
- Auth: Depends on policy (likely admin/coach)
- Body:
```json
{ "coachId": "string", "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" }
```
- Success 200:
```json
{ "modifiedCount": 1 }
```

Notes
- Auth user id in handlers is derived from JWT: `req.user.userId` (some handlers fallback to `_id` or `id`).
- Booking now uses start/end times and computes `numSlots` based on Field `slotDuration`.
- Schedules expose slot ranges { startTime, endTime, available }.
- Errors follow standard NestJS format with message and statusCode.


