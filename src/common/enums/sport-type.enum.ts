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

export interface SportConfig {
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  pointSystem: {
    winPoints: number;
    drawPoints: number;
    lossPoints: number;
    scoringUnit: string;  
    tiebreakerRule: string;
  };
  defaultRules: string;
  equipment: string[];
  durationUnit: 'minutes' | 'sets' | 'laps';
  defaultDuration: number;
}

export const SportConfigurations: Record<SportType, SportConfig> = {
  [SportType.FOOTBALL]: {
    displayName: 'Football',
    minPlayers: 7,
    maxPlayers: 11,
    pointSystem: {
      winPoints: 3,
      drawPoints: 1,
      lossPoints: 0,
      scoringUnit: 'goals',
      tiebreakerRule: 'Extra time then penalty kicks'
    },
    defaultRules: 'Two 45-minute halves. Offside rule applies. No hands except goalkeepers within penalty area.',
    equipment: ['football', 'goals', 'corner flags', 'cones'],
    durationUnit: 'minutes',
    defaultDuration: 90
  },
  [SportType.TENNIS]: {
    displayName: 'Tennis',
    minPlayers: 1,
    maxPlayers: 2,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'sets',
      tiebreakerRule: '7-point tiebreak at 6-6'
    },
    defaultRules: 'Best of 3 sets. Advantage scoring after deuce. Lets are replayed.',
    equipment: ['tennis rackets', 'tennis balls', 'net'],
    durationUnit: 'sets',
    defaultDuration: 3
  },
  [SportType.BADMINTON]: {
    displayName: 'Badminton',
    minPlayers: 1,
    maxPlayers: 2,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'points',
      tiebreakerRule: 'First to 21, win by 2 points'
    },
    defaultRules: 'Best of 3 games to 21 points. Rally scoring system.',
    equipment: ['badminton rackets', 'shuttlecocks', 'net'],
    durationUnit: 'minutes',
    defaultDuration: 45
  },
  [SportType.PICKLEBALL]: {
    displayName: 'Pickleball',
    minPlayers: 2,
    maxPlayers: 4,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'points',
      tiebreakerRule: 'Win by 2 points'
    },
    defaultRules: 'Games to 11 points (win by 2). Only serving team scores. Non-volley zone rules apply.',
    equipment: ['paddles', 'plastic ball', 'net'],
    durationUnit: 'minutes',
    defaultDuration: 60
  },
  [SportType.BASKETBALL]: {
    displayName: 'Basketball',
    minPlayers: 3,
    maxPlayers: 5,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'points',
      tiebreakerRule: 'Overtime periods of 5 minutes'
    },
    defaultRules: 'Four 10-minute quarters. 24-second shot clock. Personal foul limit: 5 per player.',
    equipment: ['basketball', 'hoops', 'shot clock'],
    durationUnit: 'minutes',
    defaultDuration: 40
  },
  [SportType.VOLLEYBALL]: {
    displayName: 'Volleyball',
    minPlayers: 6,
    maxPlayers: 6,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'points',
      tiebreakerRule: 'First to 15 in deciding set'
    },
    defaultRules: 'Best of 5 sets to 25 points (win by 2). Rally scoring. Rotation order must be maintained.',
    equipment: ['volleyball', 'net', 'antennae'],
    durationUnit: 'sets',
    defaultDuration: 5
  },
  [SportType.SWIMMING]: {
    displayName: 'Swimming',
    minPlayers: 1,
    maxPlayers: 1,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'time',
      tiebreakerRule: 'Swim-off for ties'
    },
    defaultRules: 'Starts from diving blocks. No underwater propulsion beyond 15m. Touch pad finish required.',
    equipment: ['lanes', 'starting blocks', 'touch pads'],
    durationUnit: 'minutes',
    defaultDuration: 30
  },
  [SportType.GYM]: {
    displayName: 'Gym',
    minPlayers: 1,
    maxPlayers: 1,
    pointSystem: {
      winPoints: 1,
      drawPoints: 0,
      lossPoints: 0,
      scoringUnit: 'points',
      tiebreakerRule: 'Highest execution score'
    },
    defaultRules: 'Safety spotters required for heavy lifts. Proper athletic attire mandatory. Wipe down equipment after use.',
    equipment: ['weights', 'machines', 'mats'],
    durationUnit: 'minutes',
    defaultDuration: 60
  },
};