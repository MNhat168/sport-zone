// Enums for the matching system

export enum SkillLevel {
    BEGINNER = 'beginner',
    INTERMEDIATE = 'intermediate',
    ADVANCED = 'advanced',
    PROFESSIONAL = 'professional',
    ANY = 'any',
}

export enum SwipeAction {
    LIKE = 'like',
    PASS = 'pass',
    SUPER_LIKE = 'super_like',
}

export enum MatchStatus {
    ACTIVE = 'active',
    SCHEDULED = 'scheduled',
    COMPLETED = 'completed',
    CANCELLED = 'cancelled',
}

export enum Gender {
    MALE = 'male',
    FEMALE = 'female',
    OTHER = 'other',
    PREFER_NOT_TO_SAY = 'prefer_not_to_say',
}

export enum GenderPreference {
    MALE = 'male',
    FEMALE = 'female',
    ANY = 'any',
}

export enum GroupSessionStatus {
    OPEN = 'open',
    FULL = 'full',
    IN_PROGRESS = 'in_progress',
    COMPLETED = 'completed',
    CANCELLED = 'cancelled',
}

export enum PaymentStatus {
    PENDING = 'pending',
    PAID = 'paid',
    FAILED = 'failed',
    REFUNDED = 'refunded',
}

export enum VoteType {
    FIELD = 'field',
    TIME = 'time',
    CUSTOM = 'custom',
}
