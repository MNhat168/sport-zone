export interface CreateFieldBookingPayload {
  user: string;
  schedule: string;
  startTime: string;
  endTime: string;
  totalPrice: number;
}

export interface CreateSessionBookingPayload {
  user: string;
  fieldSchedule: string;
  coachSchedule: string;
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


