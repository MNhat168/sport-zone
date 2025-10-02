# Field API Documentation (Updated for Pure Lazy Creation)

This document outlines the API endpoints for field-related operations in the SportZone system.

## Base URL
```
/fields
```

**Important**: Use `/fields` (plural), not `/field/` (singular)

## Authentication

Most endpoints require authentication using JWT tokens:
```
Authorization: Bearer <access_token>
```

## Endpoints

### Get All Fields

- **Method**: `GET`
- **Path**: `/`
- **Auth**: Public
- **Description**: Retrieve a list of all available fields with filtering

**Query Parameters**:
- `name` (optional): Filter by field name
- `location` (optional): Filter by location  
- `sportType` (optional): Filter by sport type (FOOTBALL, BASKETBALL, TENNIS, etc.)

**Success 200**:

```json
[
  {
    "_id": "string",
    "owner": "string", 
    "name": "string",
    "sportType": "FOOTBALL",
    "description": "string",
    "images": ["string"],
    "operatingHours": {
      "start": "06:00",
      "end": "22:00"
    },
    "slotDuration": 60,
    "minSlots": 1,
    "maxSlots": 4,
    "priceRanges": [
      {
        "start": "06:00",
        "end": "10:00", 
        "multiplier": 1.0
      },
      {
        "start": "18:00",
        "end": "22:00",
        "multiplier": 1.5
      }
    ],
    "basePrice": 150000,
    "isActive": true,
    "rating": 4.5,
    "totalReviews": 128,
    "location": "District 1, Ho Chi Minh City"
  }
]
```

### Get Field by ID

- **Method**: `GET`
- **Path**: `/:id`
- **Auth**: Public
- **Description**: Retrieve detailed information about a specific field

**Parameters**:
- `id`: Field ID (ObjectId)

**Success 200**:

```json
{
  "_id": "string",
  "owner": {
    "_id": "string",
    "businessName": "string",
    "contactInfo": {
      "phone": "string",
      "email": "string"
    }
  },
  "name": "string",
  "sportType": "FOOTBALL",
  "description": "string",
  "images": ["string"],
  "operatingHours": {
    "start": "06:00",
    "end": "22:00"
  },
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    },
    {
      "start": "18:00", 
      "end": "22:00",
      "multiplier": 1.5
    }
  ],
  "basePrice": 150000,
  "isActive": true,
  "maintenanceNote": "string",
  "maintenanceUntil": "2025-10-15T00:00:00.000Z",
  "rating": 4.5,
  "totalReviews": 128,
  "location": "District 1, Ho Chi Minh City",
  "createdAt": "2025-01-15T00:00:00.000Z",
  "updatedAt": "2025-10-01T00:00:00.000Z"
}
```

### Get Field Availability (Pure Lazy Creation)

- **Method**: `GET`
- **Path**: `/:id/availability`
- **Auth**: Public
- **Description**: Check field availability for date range with dynamic pricing

**Parameters**:
- `id`: Field ID (ObjectId)

**Query Parameters**:
- `startDate`: Start date (YYYY-MM-DD) - required
- `endDate`: End date (YYYY-MM-DD) - required

**Example**: `GET /fields/507f1f77bcf86cd799439011/availability?startDate=2025-10-01&endDate=2025-10-31`

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
        "priceBreakdown": "09:00-10:00: 1.0x base price"
      },
      {
        "startTime": "19:00", 
        "endTime": "20:00",
        "available": false,
        "price": 225000,
        "priceBreakdown": "19:00-20:00: 1.5x base price (booked)"
      }
    ]
  }
]
```

### Schedule Price Update

- **Method**: `POST`
- **Path**: `/:id/schedule-price-update`
- **Auth**: Required (Field Owner)
- **Description**: Schedule future price changes for a field

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body**:

```json
{
  "newPriceRanges": [
    {
      "start": "06:00",
      "end": "10:00", 
      "multiplier": 1.2
    },
    {
      "start": "18:00",
      "end": "22:00",
      "multiplier": 1.8
    }
  ],
  "newBasePrice": 200000,
  "effectiveDate": "2025-11-01",
  "ownerId": "string"
}
```

**Success 200**:

```json
{
  "_id": "string",
  "message": "Price update scheduled successfully",
  "effectiveDate": "2025-11-01T00:00:00.000Z"
}
```

### Cancel Scheduled Price Update

- **Method**: `DELETE`
- **Path**: `/:id/scheduled-price-update`
- **Auth**: Required (Field Owner)
- **Description**: Cancel a pending price update

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body**:

```json
{
  "effectiveDate": "2025-11-01"
}
```

**Success 200**:

```json
{
  "success": true,
  "message": "Scheduled price update cancelled"
}
```

### Get Scheduled Price Updates

- **Method**: `GET`
- **Path**: `/:id/scheduled-price-updates`
- **Auth**: Required (Field Owner)
- **Description**: Get all pending price updates for a field

**Parameters**:
- `id`: Field ID (ObjectId)

**Success 200**:

```json
[
  {
    "newPriceRanges": [
      {
        "start": "06:00",
        "end": "10:00",
        "multiplier": 1.2
      }
    ],
    "newBasePrice": 200000,
    "effectiveDate": "2025-11-01T00:00:00.000Z",
    "applied": false,
    "createdBy": "string",
    "createdAt": "2025-10-01T10:30:00.000Z"
  }
]
```

### Create New Field

- **Method**: `POST`
- **Path**: `/`
- **Auth**: Required (Field Owner)
- **Description**: Create a new field

**Request Body**:

```json
{
  "name": "Sân bóng Phú Nhuận",
  "sportType": "FOOTBALL",
  "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
  "images": [
    "https://example.com/field1.jpg",
    "https://example.com/field2.jpg"
  ],
  "operatingHours": {
    "start": "06:00",
    "end": "22:00"
  },
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    },
    {
      "start": "10:00",
      "end": "18:00",
      "multiplier": 1.2
    },
    {
      "start": "18:00",
      "end": "22:00", 
      "multiplier": 1.5
    }
  ],
  "basePrice": 150000,
  "location": "District 3, Ho Chi Minh City"
}
```

**Success 201**:

```json
{
  "id": "string",
  "owner": "string",
  "name": "Sân bóng Phú Nhuận",
  "sportType": "FOOTBALL",
  "description": "Sân bóng đá 11 người, có đèn chiếu sáng",
  "location": "District 3, Ho Chi Minh City",
  "images": [
    "https://example.com/field1.jpg",
    "https://example.com/field2.jpg"
  ],
  "operatingHours": {
    "start": "06:00",
    "end": "22:00"
  },
  "slotDuration": 60,
  "minSlots": 1,
  "maxSlots": 4,
  "priceRanges": [
    {
      "start": "06:00",
      "end": "10:00",
      "multiplier": 1.0
    },
    {
      "start": "10:00",
      "end": "18:00",
      "multiplier": 1.2
    },
    {
      "start": "18:00",
      "end": "22:00",
      "multiplier": 1.5
    }
  ],
  "basePrice": 150000,
  "isActive": true,
  "rating": 0,
  "totalReviews": 0
}
```

### Update Field Information

- **Method**: `PUT`
- **Path**: `/:id`
- **Auth**: Required (Field Owner)
- **Description**: Update field information (only owner can update)

**Parameters**:
- `id`: Field ID (ObjectId)

**Request Body** (all fields optional):

```json
{
  "name": "Updated Field Name",
  "description": "Updated description",
  "images": ["https://example.com/new-image.jpg"],
  "operatingHours": {
    "start": "05:00",
    "end": "23:00"
  },
  "slotDuration": 90,
  "minSlots": 2,
  "maxSlots": 6,
  "priceRanges": [
    {
      "start": "05:00",
      "end": "08:00",
      "multiplier": 0.8
    },
    {
      "start": "18:00", 
      "end": "23:00",
      "multiplier": 2.0
    }
  ],
  "basePrice": 200000,
  "isActive": true,
  "maintenanceNote": "Maintenance scheduled",
  "maintenanceUntil": "2025-10-20",
  "location": "Updated location"
}
```

**Success 200**:

```json
{
  "id": "string",
  "owner": "string", 
  "name": "Updated Field Name",
  "sportType": "FOOTBALL",
  "description": "Updated description",
  "location": "Updated location",
  "images": ["https://example.com/new-image.jpg"],
  "operatingHours": {
    "start": "05:00",
    "end": "23:00"
  },
  "slotDuration": 90,
  "minSlots": 2,
  "maxSlots": 6,
  "priceRanges": [
    {
      "start": "05:00",
      "end": "08:00",
      "multiplier": 0.8
    },
    {
      "start": "18:00",
      "end": "23:00", 
      "multiplier": 2.0
    }
  ],
  "basePrice": 200000,
  "isActive": true,
  "maintenanceNote": "Maintenance scheduled",
  "maintenanceUntil": "2025-10-20T00:00:00.000Z",
  "rating": 4.5,
  "totalReviews": 128
}
```

### Delete Field

- **Method**: `DELETE`
- **Path**: `/:id`
- **Auth**: Required (Field Owner)
- **Description**: Delete a field (only owner can delete)

**Parameters**:
- `id`: Field ID (ObjectId)

**Success 200**:

```json
{
  "success": true,
  "message": "Field deleted successfully"
}
```

## Error Responses

All errors follow standard NestJS format:

**400 Bad Request**:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "error": "Bad Request"
}
```

**401 Unauthorized**:

```json
{
  "statusCode": 401,
  "message": "Unauthorized",
  "error": "Unauthorized"
}
```

**403 Forbidden**:

```json
{
  "statusCode": 403,
  "message": "Access denied. Field owner role required.",
  "error": "Forbidden"
}
```

**404 Not Found**:

```json
{
  "statusCode": 404,
  "message": "Field not found",
  "error": "Not Found"
}
```

## Pure Lazy Creation Features

**Dynamic Availability**:
- No pre-created schedules required
- Availability computed in real-time based on existing bookings
- Supports complex pricing multipliers by time ranges

**Price Scheduling**:
- Field owners can schedule future price changes
- Automatic price updates at midnight on effective date
- Pending updates can be cancelled before being applied

**Slot Management**:
- Configurable slot duration (minimum 30 minutes)
- Min/max slots per booking to control reservation sizes
- Operating hours enforcement

## Notes

**SportType Enum**:
- FOOTBALL, BASKETBALL, TENNIS, BADMINTON, VOLLEYBALL, FUTSAL

**Time Format**:
- All times use HH:mm format (24-hour)
- Dates use YYYY-MM-DD format
- Timestamps follow ISO 8601 format

**Pricing Structure**:
- Base price + time-based multipliers
- Prices in VND (Vietnamese Dong)
- Dynamic pricing based on time slots

**Authentication**:
- JWT tokens required for owner-specific operations
- Public access for field listing and availability checks