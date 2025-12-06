export enum ReservationStatus {
  PENDING = 'pending', // Temporary hold
  CONFIRMED = 'confirmed', // Converted to booking
  RELEASED = 'released', // Cancelled due to low turnout
  EXPIRED = 'expired', // Past deadline
}
