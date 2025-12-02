// sport-type.enum.ts - Enhanced with categories and competition formats
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

// Competition formats
export enum CompetitionFormat {
  SINGLE_ELIMINATION = 'single_elimination',
  DOUBLE_ELIMINATION = 'double_elimination',
  ROUND_ROBIN = 'round_robin',
  GROUP_STAGE = 'group_stage',
  LEAGUE = 'league',
  KNOCKOUT = 'knockout'
}

// Sport-specific categories
export const SportCategories = {
  // Net sports (Tennis, Badminton, Pickleball)
  NET_SPORTS: {
    SINGLES: 'singles',
    DOUBLES: 'doubles',
    MIXED_DOUBLES: 'mixed_doubles'
  },
  
  // Football categories
  FOOTBALL: {
    MENS: 'mens',
    WOMENS: 'womens',
    MIXED: 'mixed',
    YOUTH: 'youth',
    VETERANS: 'veterans',
    FIVE_A_SIDE: '5_a_side',
    SEVEN_A_SIDE: '7_a_side',
    ELEVEN_A_SIDE: '11_a_side'
  },
  
  // Basketball categories  
  BASKETBALL: {
    MENS: 'mens',
    WOMENS: 'womens',
    THREE_ON_THREE: '3x3',
    FIVE_ON_FIVE: '5x5',
    YOUTH: 'youth'
  },
  
  // Volleyball categories
  VOLLEYBALL: {
    MENS: 'mens',
    WOMENS: 'womens', 
    MIXED: 'mixed',
    BEACH: 'beach',
    INDOOR: 'indoor'
  },
  
  // Swimming categories
  SWIMMING: {
    FREESTYLE: 'freestyle',
    BREASTSTROKE: 'breaststroke',
    BACKSTROKE: 'backstroke',
    BUTTERFLY: 'butterfly',
    INDIVIDUAL_MEDLEY: 'individual_medley',
    RELAY: 'relay'
  },
  
  // Gym/Fitness categories
  GYM: {
    BODYBUILDING: 'bodybuilding',
    POWERLIFTING: 'powerlifting',
    CROSSFIT: 'crossfit',
    CALISTHENICS: 'calisthenics',
    WEIGHTLIFTING: 'weightlifting'
  }
} as const;

export interface SportRules {
  sportType: SportType;
  minParticipants: number;
  maxParticipants: number;
  minFieldsRequired: number;
  maxFieldsRequired: number;
  typicalDuration: number; // in hours
  teamSize: number;
  description: string;
  displayName: string;
  availableCategories: string[];
  availableFormats: CompetitionFormat[];
  defaultFormat: CompetitionFormat;
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
    displayName: 'Football',
    availableCategories: Object.values(SportCategories.FOOTBALL),
    availableFormats: [CompetitionFormat.GROUP_STAGE, CompetitionFormat.KNOCKOUT, CompetitionFormat.LEAGUE],
    defaultFormat: CompetitionFormat.GROUP_STAGE
  },
  [SportType.TENNIS]: {
    sportType: SportType.TENNIS,
    minParticipants: 4,
    maxParticipants: 32,
    minFieldsRequired: 1,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    teamSize: 1,
    description: 'Tennis tournament',
    displayName: 'Tennis',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.DOUBLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION
  },
  [SportType.BADMINTON]: {
    sportType: SportType.BADMINTON,
    minParticipants: 8,
    maxParticipants: 32,
    minFieldsRequired: 2,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    teamSize: 2,
    description: 'Badminton tournament',
    displayName: 'Badminton',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.DOUBLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION
  },
  [SportType.PICKLEBALL]: {
    sportType: SportType.PICKLEBALL,
    minParticipants: 8,
    maxParticipants: 32,
    minFieldsRequired: 2,
    maxFieldsRequired: 6,
    typicalDuration: 3,
    teamSize: 2,
    description: 'Pickleball tournament',
    displayName: 'Pickleball',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.ROUND_ROBIN
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
    displayName: 'Basketball',
    availableCategories: Object.values(SportCategories.BASKETBALL),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN, CompetitionFormat.LEAGUE],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION
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
    displayName: 'Volleyball',
    availableCategories: Object.values(SportCategories.VOLLEYBALL),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.ROUND_ROBIN
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
    displayName: 'Swimming',
    availableCategories: Object.values(SportCategories.SWIMMING),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION
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
    displayName: 'Gym/Fitness',
    availableCategories: Object.values(SportCategories.GYM),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION
  },
};

// Helper functions for display names (optional, can be used in frontend)
export const getCategoryDisplayName = (category: string, sportType: SportType): string => {
  const categoryMappings: Record<SportType, Record<string, string>> = {
    [SportType.TENNIS]: {
      'singles': 'Singles',
      'doubles': 'Doubles',
      'mixed_doubles': 'Mixed Doubles'
    },
    [SportType.BADMINTON]: {
      'singles': 'Singles',
      'doubles': 'Doubles', 
      'mixed_doubles': 'Mixed Doubles'
    },
    [SportType.PICKLEBALL]: {
      'singles': 'Singles',
      'doubles': 'Doubles',
      'mixed_doubles': 'Mixed Doubles'
    },
    [SportType.FOOTBALL]: {
      'mens': "Men's",
      'womens': "Women's",
      'mixed': 'Mixed',
      'youth': 'Youth',
      'veterans': 'Veterans',
      '5_a_side': '5-a-side',
      '7_a_side': '7-a-side',
      '11_a_side': '11-a-side'
    },
    [SportType.BASKETBALL]: {
      'mens': "Men's",
      'womens': "Women's",
      '3x3': '3x3',
      '5x5': '5x5',
      'youth': 'Youth'
    },
    [SportType.VOLLEYBALL]: {
      'mens': "Men's",
      'womens': "Women's",
      'mixed': 'Mixed',
      'beach': 'Beach',
      'indoor': 'Indoor'
    },
    [SportType.SWIMMING]: {
      'freestyle': 'Freestyle',
      'breaststroke': 'Breaststroke',
      'backstroke': 'Backstroke',
      'butterfly': 'Butterfly',
      'individual_medley': 'Individual Medley',
      'relay': 'Relay'
    },
    [SportType.GYM]: {
      'bodybuilding': 'Bodybuilding',
      'powerlifting': 'Powerlifting',
      'crossfit': 'CrossFit',
      'calisthenics': 'Calisthenics',
      'weightlifting': 'Weightlifting'
    }
  };

  return categoryMappings[sportType]?.[category] || category;
};

export const getFormatDisplayName = (format: CompetitionFormat): string => {
  const formatNames: Record<CompetitionFormat, string> = {
    [CompetitionFormat.SINGLE_ELIMINATION]: 'Single Elimination',
    [CompetitionFormat.DOUBLE_ELIMINATION]: 'Double Elimination',
    [CompetitionFormat.ROUND_ROBIN]: 'Round Robin',
    [CompetitionFormat.GROUP_STAGE]: 'Group Stage',
    [CompetitionFormat.LEAGUE]: 'League',
    [CompetitionFormat.KNOCKOUT]: 'Knockout'
  };
  return formatNames[format] || format;
};

export const getSportDisplayName = (sportType: SportType): string => {
  return SPORT_RULES_MAP[sportType]?.displayName || sportType;
};