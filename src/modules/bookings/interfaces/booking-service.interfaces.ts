export interface CreateFieldBookingPayload {
  user: string;
  field: string;  // Changed from schedule to field (Pure Lazy Creation)
  date: Date;     // Added date field to replace schedule dependency
  startTime: string;
  endTime: string;
  totalPrice: number;
}

export interface CreateSessionBookingPayload {
  user: string;
  field: string;       // Changed from fieldSchedule to field (Pure Lazy Creation)
  coach: string;       // Changed from coachSchedule to coach (Pure Lazy Creation)
  date: Date;          // Added date field to replace schedule dependency
  fieldStartTime: string;
  fieldEndTime: string;
  coachStartTime: string;
  coachEndTime: string;
  fieldPrice: number;
  coachPrice: number;
}

export interface CancelBookingPayload {
  bookingId: string;
  userId: string;
  cancellationReason?: string;
}

export interface CancelSessionBookingPayload {
  fieldBookingId: string;
  coachBookingId: string;
  userId: string;
  cancellationReason?: string;
}


