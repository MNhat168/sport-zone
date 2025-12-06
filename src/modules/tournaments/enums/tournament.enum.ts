export enum TournamentStatus {
  DRAFT = 'draft', // Initial creation, fields not reserved
  PENDING = 'pending', // Fields reserved, waiting for minimum participants
  CONFIRMED = 'confirmed', // Minimum threshold met, fields booked
  ONGOING = 'ongoing',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

