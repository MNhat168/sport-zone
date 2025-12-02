# Field Owner API

All field-owner functionality now lives under the `/field-owner` prefix. Unless noted otherwise, endpoints require a JWT access token issued to a `field_owner` user. Responses are automatically wrapped by the global response interceptor (`{ success: boolean, data: any }`).

## Field Management

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/field-owner/fields` | List current owner's fields with optional `name`, `sportType`, `isActive`, `page`, `limit`. |
| `POST` | `/field-owner/fields` | Create a field with JSON payload identical to the old `POST /fields`. |
| `POST` | `/field-owner/fields/with-images` | Multipart version that accepts `images[]` and the same form fields as before. |
| `PUT` | `/field-owner/fields/:id` | Update a field. |
| `DELETE` | `/field-owner/fields/:id` | Delete a field. |
| `PUT` | `/field-owner/fields/:id/amenities` | Replace amenities list (`{ amenities: [{ amenityId, price }] }`). |

### Price Scheduling

| Method | Path | Notes |
| ------ | ---- | ----- |
| `POST` | `/field-owner/fields/:id/schedule-price-update` | Schedule future pricing/operating changes (`newOperatingHours`, `newPriceRanges`, `newBasePrice`, `effectiveDate`). |
| `DELETE` | `/field-owner/fields/:id/scheduled-price-update` | Body `{ effectiveDate: string }`. Cancels pending update. |
| `GET` | `/field-owner/fields/:id/scheduled-price-updates` | Lists all pending updates. |

## Bookings

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/field-owner/bookings/today` | Today's bookings for all active fields. |
| `GET` | `/field-owner/bookings` | Historical bookings. Supports `fieldName`, `status`, `transactionStatus`, `startDate`, `endDate`, `page`, `limit`. |

## Owner Profile & Registration

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/field-owner/profile` | Create profile (field owner role required). |
| `GET` | `/field-owner/profile` | Get current owner's profile. |
| `PATCH` | `/field-owner/profile` | Update current owner's profile. |
| `GET` | `/field-owner/profile/:id` | Public profile lookup. |
| `POST` | `/field-owner/registration-request` | Submit owner registration. |
| `GET` | `/field-owner/registration-request/my` | View current request status. |
| `POST` | `/field-owner/registration-request/upload-document` | Upload supporting file (`multipart/form-data`, field `file`). |

## Banking

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/field-owner/profile/bank-account` | Add bank account to current profile. |
| `GET` | `/field-owner/profile/bank-accounts` | List owner's bank accounts. |
| `POST` | `/field-owner/bank-account/validate` | Validate bank account via PayOS (`{ bankCode, accountNumber }`). |

### Admin Banking

Requires admin role + `JwtAccessTokenGuard`.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `POST` | `/field-owner/admin/bank-accounts/:id/verify` | Mark account verified. Body `{ notes?: string }`. |
| `POST` | `/field-owner/admin/bank-accounts/:id/reject` | Reject account. Body `{ notes?: string, rejectionReason?: string }`. |

## Admin: Owner Profiles & Registrations

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/field-owner/admin/profiles` | Paginated list of owner profiles. Query params: `page`, `limit`, `search`, `isVerified`, `sortBy`, `sortOrder`. |
| `GET` | `/field-owner/admin/registration-requests` | Paginated registration requests (`page`, `limit`). |
| `GET` | `/field-owner/admin/registration-requests/:id` | View single request. |
| `POST` | `/field-owner/admin/registration-requests/:id/approve` | Body mirrors original approve DTO; converts request into `FieldOwnerProfile`. |
| `POST` | `/field-owner/admin/registration-requests/:id/reject` | Body `{ reason: string }`. Sends rejection email. |

## Response & Payload Notes

- DTOs (`CreateFieldDto`, `FieldOwnerProfileDto`, etc.) are unchanged. Only the controller/module moved.
- Authentication + guards mirror the previous implementation (JWT via `AuthGuard('jwt')` for owner endpoints, `JwtAccessTokenGuard + RolesGuard` for admin endpoints).
- All endpoints now live in `src/modules/field-owner`, so FE must update every call from `/fields/...` to the new `/field-owner/...` paths summarized above.

