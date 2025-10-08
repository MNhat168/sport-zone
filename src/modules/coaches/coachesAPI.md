# Coaches API Documentation

## Base URL
```
GET /coaches
```

## Endpoints

### 1. Get All Coaches (with filters)
**Endpoint:** `GET /coaches`

**Description:** Retrieve a list of coaches with optional filtering capabilities.

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | string | No | Filter coaches by name (case-insensitive partial match) |
| `sportType` | SportType | No | Filter by sport type |
| `minRate` | number | No | Minimum hourly rate filter |
| `maxRate` | number | No | Maximum hourly rate filter |

**SportType Enum Values:**
```typescript
enum SportType {
  FOOTBALL = 'football',
  TENNIS = 'tennis',
  BADMINTON = 'badminton',
  PICKLEBALL = 'pickleball',
  BASKETBALL = 'basketball',
  VOLLEYBALL = 'volleyball',
  SWIMMING = 'swimming',
  GYM = 'gym'
}
```

**Request Example:**
```javascript
// Get all coaches
GET /coaches

// Filter by name and sport type
GET /coaches?name=john&sportType=tennis

// Filter by price range
GET /coaches?minRate=50&maxRate=100
```

**Response:**
```typescript
interface CoachesDto {
  id: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
  isVerified: boolean;
  sports: SportType[];
  certification: string;
  hourlyRate: number;
  bio: string;
  rating: number;
  totalReviews: number;
}
```

**Response Example:**
```json
[
  {
    "id": "64a1b2c3d4e5f6789012345",
    "fullName": "John Smith",
    "email": "john.smith@example.com",
    "avatarUrl": "https://example.com/avatar.jpg",
    "isVerified": true,
    "sports": ["tennis", "badminton"],
    "certification": "USPTA Certified",
    "hourlyRate": 75,
    "bio": "Professional tennis coach with 10 years experience",
    "rating": 4.8,
    "totalReviews": 25
  }
]
```

---

### 2. Get All Coaches (Legacy Format)
**Endpoint:** `GET /coaches/all`

**Description:** Retrieve all coaches in a simplified format (legacy endpoint).

**Request Example:**
```javascript
GET /coaches/all
```

**Response:**
```typescript
interface LegacyCoachResponse {
  id: string;
  name: string;
  location: string;
  description: string;
  rating: number;
  totalReviews: number;
  price: number;
  nextAvailability: null; // TODO: Will be implemented
}
```

**Response Example:**
```json
[
  {
    "id": "64a1b2c3d4e5f6789012345",
    "name": "John Smith",
    "location": "New York, NY",
    "description": "Professional tennis coach with 10 years experience",
    "rating": 4.8,
    "totalReviews": 25,
    "price": 75,
    "nextAvailability": null
  }
]
```

---

### 3. Get Coach by ID
**Endpoint:** `GET /coaches/:id`

**Description:** Retrieve detailed information about a specific coach including their schedule and lesson types.

**Path Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Coach's user ID |

**Request Example:**
```javascript
GET /coaches/64a1b2c3d4e5f6789012345
```

**Response:**
```typescript
interface CoachDetailResponse {
  id: string;
  name: string;
  profileImage: string;
  description: string;
  rating: number;
  reviewCount: number;
  location: string;
  level: string;
  completedSessions: number;
  createdAt: string;
  availableSlots: TimeSlot[];
  lessonTypes: LessonType[];
  price: number;
  coachingDetails: {
    experience: string;
    certification: string;
  };
}

interface TimeSlot {
  startTime: string;
  endTime: string;
}

interface LessonType {
  _id: string;
  user: string;
  type: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
```

**Response Example:**
```json
{
  "id": "64a1b2c3d4e5f6789012345",
  "name": "John Smith",
  "profileImage": "https://example.com/avatar.jpg",
  "description": "Professional tennis coach with 10 years experience",
  "rating": 4.8,
  "reviewCount": 25,
  "location": "New York, NY",
  "level": "USPTA Certified",
  "completedSessions": 150,
  "createdAt": "2023-01-15T10:30:00Z",
  "availableSlots": [
    {
      "startTime": "09:00",
      "endTime": "10:00"
    },
    {
      "startTime": "14:00",
      "endTime": "15:00"
    }
  ],
  "lessonTypes": [
    {
      "_id": "64a1b2c3d4e5f6789012346",
      "user": "64a1b2c3d4e5f6789012345",
      "type": "single",
      "name": "Private Lesson",
      "description": "One-on-one coaching session",
      "createdAt": "2023-01-15T10:30:00Z",
      "updatedAt": "2023-01-15T10:30:00Z"
    }
  ],
  "price": 75,
  "coachingDetails": {
    "experience": "10 years professional coaching",
    "certification": "USPTA Certified"
  }
}
```

---

## Redux Integration Examples

### Redux Actions
```typescript
// actions/coachesActions.ts
export const fetchCoaches = (filters?: CoachFilters) => ({
  type: 'FETCH_COACHES',
  payload: filters
});

export const fetchCoachById = (id: string) => ({
  type: 'FETCH_COACH_BY_ID',
  payload: id
});

export const fetchAllCoaches = () => ({
  type: 'FETCH_ALL_COACHES'
});
```

### Redux Reducer
```typescript
// reducers/coachesReducer.ts
interface CoachesState {
  coaches: CoachesDto[];
  selectedCoach: CoachDetailResponse | null;
  allCoaches: LegacyCoachResponse[];
  loading: boolean;
  error: string | null;
}

const initialState: CoachesState = {
  coaches: [],
  selectedCoach: null,
  allCoaches: [],
  loading: false,
  error: null
};

export const coachesReducer = (state = initialState, action: any) => {
  switch (action.type) {
    case 'FETCH_COACHES_REQUEST':
      return { ...state, loading: true, error: null };
    case 'FETCH_COACHES_SUCCESS':
      return { ...state, loading: false, coaches: action.payload };
    case 'FETCH_COACHES_FAILURE':
      return { ...state, loading: false, error: action.payload };
    case 'FETCH_COACH_BY_ID_SUCCESS':
      return { ...state, selectedCoach: action.payload };
    case 'FETCH_ALL_COACHES_SUCCESS':
      return { ...state, allCoaches: action.payload };
    default:
      return state;
  }
};
```

### Redux Saga/Thunk
```typescript
// sagas/coachesSaga.ts
import { call, put, takeEvery } from 'redux-saga/effects';
import axios from 'axios';

function* fetchCoachesSaga(action: any) {
  try {
    const response = yield call(axios.get, '/coaches', {
      params: action.payload
    });
    yield put({ type: 'FETCH_COACHES_SUCCESS', payload: response.data });
  } catch (error) {
    yield put({ type: 'FETCH_COACHES_FAILURE', payload: error.message });
  }
}

function* fetchCoachByIdSaga(action: any) {
  try {
    const response = yield call(axios.get, `/coaches/${action.payload}`);
    yield put({ type: 'FETCH_COACH_BY_ID_SUCCESS', payload: response.data });
  } catch (error) {
    yield put({ type: 'FETCH_COACH_BY_ID_FAILURE', payload: error.message });
  }
}

export function* coachesSaga() {
  yield takeEvery('FETCH_COACHES', fetchCoachesSaga);
  yield takeEvery('FETCH_COACH_BY_ID', fetchCoachByIdSaga);
}
```

### React Component Usage
```typescript
// components/CoachesList.tsx
import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';

const CoachesList: React.FC = () => {
  const dispatch = useDispatch();
  const { coaches, loading, error } = useSelector((state: any) => state.coaches);

  useEffect(() => {
    dispatch(fetchCoaches());
  }, [dispatch]);

  const handleFilter = (filters: CoachFilters) => {
    dispatch(fetchCoaches(filters));
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return (
    <div>
      {coaches.map((coach: CoachesDto) => (
        <div key={coach.id}>
          <h3>{coach.fullName}</h3>
          <p>{coach.bio}</p>
          <p>Rating: {coach.rating} ({coach.totalReviews} reviews)</p>
          <p>Rate: ${coach.hourlyRate}/hour</p>
        </div>
      ))}
    </div>
  );
};
```

## Error Handling

All endpoints may return the following error responses:

**400 Bad Request:**
```json
{
  "statusCode": 400,
  "message": "Invalid query parameters",
  "error": "Bad Request"
}
```

**404 Not Found:**
```json
{
  "statusCode": 404,
  "message": "Coach not found",
  "error": "Not Found"
}
```

**500 Internal Server Error:**
```json
{
  "statusCode": 500,
  "message": "Internal server error",
  "error": "Internal Server Error"
}
```

## Notes

1. **Authentication:** All endpoints are currently public (no authentication required)
2. **Pagination:** Currently not implemented, all results are returned at once
3. **Rate Limiting:** Consider implementing rate limiting for production use
4. **Caching:** Consider implementing caching for frequently accessed coach data
5. **Future Enhancements:** 
   - The `/coaches/all` endpoint has a TODO for `nextAvailability` field
   - Consider adding pagination for large result sets
   - Consider adding sorting options (by rating, price, etc.)
