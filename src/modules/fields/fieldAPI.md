# Field API Documentation

This document outlines the API endpoints for field-related operations in the system.

## Base URL
```
/api/fields
```

## Endpoints

### 1. Get All Fields
- **Method:** `GET`
- **Endpoint:** `/`
- **Description:** Retrieve a list of all available fields
- **Query Parameters:**
  - `page` (optional): Page number for pagination
  - `limit` (optional): Number of items per page
  - `location` (optional): Filter by location
  - `type` (optional): Filter by field type
- **Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "location": "string",
      "type": "string",
      "pricePerHour": "number",
      "availability": "boolean",
      "images": ["string"],
      "owner": {
        "id": "string",
        "name": "string"
      }
    }
  ],
  "pagination": {
    "page": "number",
    "limit": "number",
    "total": "number"
  }
}
```

### 2. Get Field by ID
- **Method:** `GET`
- **Endpoint:** `/:id`
- **Description:** Retrieve detailed information about a specific field
- **Parameters:**
  - `id`: Field ID
- **Response:**
```json
{
  "success": true,
  "data": {
    "id": "string",
    "name": "string",
    "description": "string",
    "location": "string",
    "type": "string",
    "pricePerHour": "number",
    "availability": "boolean",
    "images": ["string"],
    "facilities": ["string"],
    "owner": {
      "id": "string",
      "name": "string",
      "contact": "string"
    },
    "bookings": [
      {
        "id": "string",
        "startTime": "datetime",
        "endTime": "datetime",
        "status": "string"
      }
    ]
  }
}
```

### 3. Create New Field
- **Method:** `POST`
- **Endpoint:** `/`
- **Description:** Create a new field (Owner only)
- **Authentication:** Required (Owner role)
- **Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "location": "string",
  "type": "string",
  "pricePerHour": "number",
  "facilities": ["string"],
  "images": ["string"]
}
```
- **Response:**
```json
{
  "success": true,
  "message": "Field created successfully",
  "data": {
    "id": "string",
    "name": "string",
    "description": "string",
    "location": "string",
    "type": "string",
    "pricePerHour": "number",
    "availability": "boolean",
    "createdAt": "datetime"
  }
}
```

### 4. Update Field
- **Method:** `PUT`
- **Endpoint:** `/:id`
- **Description:** Update field information (Owner only)
- **Authentication:** Required (Owner role)
- **Parameters:**
  - `id`: Field ID
- **Request Body:**
```json
{
  "name": "string",
  "description": "string",
  "location": "string",
  "type": "string",
  "pricePerHour": "number",
  "facilities": ["string"],
  "images": ["string"],
  "availability": "boolean"
}
```
- **Response:**
```json
{
  "success": true,
  "message": "Field updated successfully",
  "data": {
    "id": "string",
    "name": "string",
    "description": "string",
    "location": "string",
    "type": "string",
    "pricePerHour": "number",
    "availability": "boolean",
    "updatedAt": "datetime"
  }
}
```

### 5. Delete Field
- **Method:** `DELETE`
- **Endpoint:** `/:id`
- **Description:** Delete a field (Owner only)
- **Authentication:** Required (Owner role)
- **Parameters:**
  - `id`: Field ID
- **Response:**
```json
{
  "success": true,
  "message": "Field deleted successfully"
}
```

### 6. Get Fields by Owner
- **Method:** `GET`
- **Endpoint:** `/owner/:ownerId`
- **Description:** Get all fields owned by a specific owner
- **Parameters:**
  - `ownerId`: Owner ID
- **Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "string",
      "name": "string",
      "description": "string",
      "location": "string",
      "type": "string",
      "pricePerHour": "number",
      "availability": "boolean",
      "totalBookings": "number"
    }
  ]
}
```

### 7. Check Field Availability
- **Method:** `GET`
- **Endpoint:** `/:id/availability`
- **Description:** Check field availability for specific date/time
- **Parameters:**
  - `id`: Field ID
- **Query Parameters:**
  - `date`: Date to check (YYYY-MM-DD)
  - `startTime`: Start time (HH:MM)
  - `endTime`: End time (HH:MM)
- **Response:**
```json
{
  "success": true,
  "data": {
    "available": "boolean",
    "conflictingBookings": [
      {
        "id": "string",
        "startTime": "datetime",
        "endTime": "datetime"
      }
    ]
  }
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "message": "Validation error",
  "errors": [
    {
      "field": "string",
      "message": "string"
    }
  ]
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Unauthorized access"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "message": "Access denied. Owner role required."
}
```

### 404 Not Found
```json
{
  "success": false,
  "message": "Field not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "message": "Internal server error"
}
```

## Authentication

Most endpoints require authentication using JWT tokens. Include the token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

## Rate Limiting

- Rate limit: 100 requests per minute per IP
- Burst limit: 10 requests per second

## Notes

- All datetime fields follow ISO 8601 format
- Image uploads should be handled through a separate media upload endpoint
- Field types include: "football", "basketball", "tennis", "badminton", etc.
- Prices are in the system's base currency