# System Role Allocation & Permissions

> **Purpose**: Overview of the current role-based access control (RBAC) system, defining capabilities and access levels for each user role.
> **Associated Enums**: `UserRole` (`admin`, `field_owner`, `coach`, `user`)

---

## 1. Role Overview

| Role | Identifier | Description | Key Responsibilities |
|------|------------|-------------|----------------------|
| **Admin** | `admin` | System Administrator | Platform management, verification, statistics, dispute resolution. |
| **Field Owner** | `field_owner` | Field/Facility Owner | Managing fields, setting schedules/prices, viewing bookings. |
| **Coach** | `coach` | Sport Coach | Managing profile, availability slots, receiving bookings. |
| **User** | `user` | End Customer | Searching for fields/coaches, booking, making payments. |

---

## 2. Detailed Permissions by Role

### 🛡️ Admin (`admin`)
*Highest level of access. Protected by `Roles(UserRole.ADMIN)`.*

**User & Content Management:**
- **Users**: View all users, ban/unban (update active status).
- **Profiles**: View all Field Owner and Coach profiles (including pending/unverified).

**Verification & Approvals:**
- **Field Owners**: View, Approve, or Reject registration requests.
- **Coaches**: View, Approve, or Reject registration requests.
- **Fields**: Verify field listings (toggle `isAdminVerify`).
- **Bank Accounts**: Verify or Reject bank accounts submitted by owners.

**Statistics & Analytics:**
- **Dashboard**: View platform-wide overview, revenue graphs, transaction history.
- **Detailed Stats**: Deep dive into specific Field Owner or Coach performance.
- **Trends**: Analyze user behavior, sport popularity, and revenue trends.

**System:**
- **Notifications**: Send system-wide notifications to all users.

---

### 🏟️ Field Owner (`field_owner`)
*Role for partners managing sport facilities.*

**Field Management:**
- **CRUD**: Create, Update, Delete own fields.
- **Media**: Upload avatar and gallery images.
- **Pricing & Schedule**: Set operating hours, price ranges, and schedule future price updates.
- **Amenities**: Manage available amenities and pricing.

**Business Operations:**
- **Bookings**: View bookings for their fields (filter by date, status, type).
- **Profile**: Manage owner profile (eKYC, business info).
- **Financial**: Add and manage bank accounts for payouts (subject to Admin verification).
- **Verification**: Submit registration requests and documents (Business License/eKYC).

---

### 👟 Coach (`coach`)
*Role for independent coaches offering training services.*

**Profile & Service:**
- **Profile Management**: Update professional details, rates, and experience.
- **Media**: Upload/Delete gallery images.
- **Registration**: Submit coach registration requests for Admin approval.

**Operations:**
- **Availability**: Manage available time slots for training.
- **Bookings**: (Implicit) Receive bookings from users (managed via general Booking flow).

---

### 👤 User (`user`)
*Standard access for customers.*

**Discovery:**
- **Search**: Find fields and coaches by location, sport, rating, etc.
- **View Details**: Access public profiles of fields and coaches, view availability.

**Booking & Payments:**
- **Create Booking**: Book fields or coaches.
  - Supports **"Pure Lazy"** booking (checking availability without pre-booking).
  - **Recurring**: Book consecutive days or weekly patterns.
  - **Payment**: Initiate payments (PayOS, Wallet) or submit bank transfer proof.
- **History**: View personal booking history and transaction status.

**Account:**
- **Profile**: Manage personal user profile.

---

## 3. Public / Guest Access
*Capabilities available without logging in.*

- **Search**: View fields and coaches.
- **Availability**: Check field/coach availability slots.
- **Guest Booking**: Create specific types of bookings (e.g., specific PayOS or Hold flows) if `guestEmail` is provided (controlled by `OptionalJwtAuthGuard`).

---

## 4. Protected Resources Summary

| Resource | Admin | Field Owner | Coach | User | Guest |
|----------|:---:|:---:|:---:|:---:|:---:|
| **All Users List** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Platform Stats** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Verify Entities** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Manage Own Fields**| ❌ | ✅ | ❌ | ❌ | ❌ |
| **Manage Own Profile**| (Read) | ✅ | ✅ | ✅ | ❌ |
| **Book Field/Coach** | ❌ | ❌ | ❌ | ✅ | ⚠️(Ltd) |
| **View Bookings** | ✅ (All) | ✅ (Own) | ✅ (Own) | ✅ (Own) | ❌ |

> **Note**: "Own" implies access is restricted to resources belonging to that user ID.
