export enum SportType {
  FOOTBALL = 'football',
  TENNIS = 'tennis',
  BADMINTON = 'badminton',
  PICKLEBALL = 'pickleball',
  BASKETBALL = 'basketball',
  VOLLEYBALL = 'volleyball',
  SWIMMING = 'swimming',
  GYM = 'gym',
}

export enum AmenityType {
  COACH = 'coach',
  DRINK = 'drink',
  FACILITY = 'facility',
  OTHER = 'other',
}

export interface SportRules {
  sportType: SportType;
  minParticipants: number;
  maxParticipants: number;
  minFieldsRequired: number;
  maxFieldsRequired: number;
  typicalDuration: number; // in hours
  teamSize: number;
  description: string;
}

export const SPORT_RULES_MAP: Record<SportType, SportRules> = {
  [SportType.FOOTBALL]: {
    sportType: SportType.FOOTBALL,
    minParticipants: 10,
    maxParticipants: 22,
    minFieldsRequired: 1,
    maxFieldsRequired: 2,
    typicalDuration: 2,
    teamSize: 11,
    description: 'Football tournament with 11 players per team',
  },
  [SportType.TENNIS]: {
    sportType: SportType.TENNIS,
    minParticipants: 4,
    maxParticipants: 32,
    minFieldsRequired: 1,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    teamSize: 1,
    description: 'Singles tennis tournament',
  },
  [SportType.BADMINTON]: {
    sportType: SportType.BADMINTON,
    minParticipants: 8,
    maxParticipants: 32,
    minFieldsRequired: 2,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    teamSize: 2,
    description: 'Doubles badminton tournament',
  },
  [SportType.PICKLEBALL]: {
    sportType: SportType.PICKLEBALL,
    minParticipants: 8,
    maxParticipants: 32,
    minFieldsRequired: 2,
    maxFieldsRequired: 6,
    typicalDuration: 3,
    teamSize: 2,
    description: 'Doubles pickleball tournament',
  },
  [SportType.BASKETBALL]: {
    sportType: SportType.BASKETBALL,
    minParticipants: 10,
    maxParticipants: 20,
    minFieldsRequired: 1,
    maxFieldsRequired: 3,
    typicalDuration: 3,
    teamSize: 5,
    description: 'Basketball tournament with 5 players per team',
  },
  [SportType.VOLLEYBALL]: {
    sportType: SportType.VOLLEYBALL,
    minParticipants: 12,
    maxParticipants: 24,
    minFieldsRequired: 1,
    maxFieldsRequired: 4,
    typicalDuration: 3,
    teamSize: 6,
    description: 'Volleyball tournament with 6 players per team',
  },
  [SportType.SWIMMING]: {
    sportType: SportType.SWIMMING,
    minParticipants: 8,
    maxParticipants: 50,
    minFieldsRequired: 1,
    maxFieldsRequired: 2,
    typicalDuration: 2,
    teamSize: 1,
    description: 'Individual swimming competition',
  },
  [SportType.GYM]: {
    sportType: SportType.GYM,
    minParticipants: 10,
    maxParticipants: 40,
    minFieldsRequired: 1,
    maxFieldsRequired: 1,
    typicalDuration: 2,
    teamSize: 1,
    description: 'Fitness competition or workshop',
  },
};