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

// Team size mapping based on sport category
export const TeamSizeMap: Record<SportType, Record<string, number>> = {
  [SportType.FOOTBALL]: {
    '5_a_side': 5,
    '7_a_side': 7,
    '11_a_side': 11,
    'mens': 11,
    'womens': 11,
    'mixed': 11,
    'youth': 11,
    'veterans': 11
  },
  [SportType.BASKETBALL]: {
    '3x3': 3,
    '5x5': 5,
    'mens': 5,
    'womens': 5,
    'youth': 5
  },
  [SportType.VOLLEYBALL]: {
    'mens': 6,
    'womens': 6,
    'mixed': 6,
    'beach': 2,
    'indoor': 6
  },
  [SportType.TENNIS]: {
    'singles': 1,
    'doubles': 2,
    'mixed_doubles': 2
  },
  [SportType.BADMINTON]: {
    'singles': 1,
    'doubles': 2,
    'mixed_doubles': 2
  },
  [SportType.PICKLEBALL]: {
    'singles': 1,
    'doubles': 2,
    'mixed_doubles': 2
  },
  [SportType.SWIMMING]: {
    'freestyle': 1,
    'breaststroke': 1,
    'backstroke': 1,
    'butterfly': 1,
    'individual_medley': 1,
    'relay': 4
  },
  [SportType.GYM]: {
    'bodybuilding': 1,
    'powerlifting': 1,
    'crossfit': 1,
    'calisthenics': 1,
    'weightlifting': 1
  }
};

export interface SportRules {
  sportType: SportType;
  minTeams: number;
  maxTeams: number;
  minParticipants: number;
  maxParticipants: number;
  minFieldsRequired: number;
  maxFieldsRequired: number;
  typicalDuration: number;
  description: string;
  displayName: string;
  availableCategories: string[];
  availableFormats: CompetitionFormat[];
  defaultFormat: CompetitionFormat;
  supportsTeamSizeOverride?: boolean;
}

export const SPORT_RULES_MAP: Record<SportType, SportRules> = {
  [SportType.FOOTBALL]: {
    sportType: SportType.FOOTBALL,
    minTeams: 4,
    maxTeams: 16,
    minParticipants: 20,
    maxParticipants: 176,
    minFieldsRequired: 1,
    maxFieldsRequired: 2,
    typicalDuration: 2,
    description: 'Football tournament with flexible team sizes',
    displayName: 'Football',
    availableCategories: Object.values(SportCategories.FOOTBALL),
    availableFormats: [CompetitionFormat.GROUP_STAGE, CompetitionFormat.KNOCKOUT, CompetitionFormat.LEAGUE],
    defaultFormat: CompetitionFormat.GROUP_STAGE,
    supportsTeamSizeOverride: true
  },
  [SportType.TENNIS]: {
    sportType: SportType.TENNIS,
    minTeams: 8,
    maxTeams: 32,
    minParticipants: 8,
    maxParticipants: 64,
    minFieldsRequired: 1,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    description: 'Tennis tournament',
    displayName: 'Tennis',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.DOUBLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION,
    supportsTeamSizeOverride: false
  },
  [SportType.BADMINTON]: {
    sportType: SportType.BADMINTON,
    minTeams: 8,
    maxTeams: 32,
    minParticipants: 8,
    maxParticipants: 64,
    minFieldsRequired: 2,
    maxFieldsRequired: 8,
    typicalDuration: 4,
    description: 'Badminton tournament',
    displayName: 'Badminton',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.DOUBLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION,
    supportsTeamSizeOverride: false
  },
  [SportType.PICKLEBALL]: {
    sportType: SportType.PICKLEBALL,
    minTeams: 8,
    maxTeams: 32,
    minParticipants: 8,
    maxParticipants: 64,
    minFieldsRequired: 2,
    maxFieldsRequired: 6,
    typicalDuration: 3,
    description: 'Pickleball tournament',
    displayName: 'Pickleball',
    availableCategories: Object.values(SportCategories.NET_SPORTS),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.ROUND_ROBIN,
    supportsTeamSizeOverride: false
  },
  [SportType.BASKETBALL]: {
    sportType: SportType.BASKETBALL,
    minTeams: 4,
    maxTeams: 16,
    minParticipants: 12,
    maxParticipants: 80,
    minFieldsRequired: 1,
    maxFieldsRequired: 3,
    typicalDuration: 3,
    description: 'Basketball tournament with 5 players per team',
    displayName: 'Basketball',
    availableCategories: Object.values(SportCategories.BASKETBALL),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN, CompetitionFormat.LEAGUE],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION,
    supportsTeamSizeOverride: true
  },
  [SportType.VOLLEYBALL]: {
    sportType: SportType.VOLLEYBALL,
    minTeams: 4,
    maxTeams: 16,
    minParticipants: 8,
    maxParticipants: 96,
    minFieldsRequired: 1,
    maxFieldsRequired: 4,
    typicalDuration: 3,
    description: 'Volleyball tournament with 6 players per team',
    displayName: 'Volleyball',
    availableCategories: Object.values(SportCategories.VOLLEYBALL),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.ROUND_ROBIN,
    supportsTeamSizeOverride: true
  },
  [SportType.SWIMMING]: {
    sportType: SportType.SWIMMING,
    minTeams: 1,
    maxTeams: 50,
    minParticipants: 4,
    maxParticipants: 200,
    minFieldsRequired: 1,
    maxFieldsRequired: 2,
    typicalDuration: 2,
    description: 'Individual swimming competition',
    displayName: 'Swimming',
    availableCategories: Object.values(SportCategories.SWIMMING),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION,
    supportsTeamSizeOverride: true
  },
  [SportType.GYM]: {
    sportType: SportType.GYM,
    minTeams: 1,
    maxTeams: 40,
    minParticipants: 4,
    maxParticipants: 120,
    minFieldsRequired: 1,
    maxFieldsRequired: 1,
    typicalDuration: 2,
    description: 'Fitness competition or workshop',
    displayName: 'Gym/Fitness',
    availableCategories: Object.values(SportCategories.GYM),
    availableFormats: [CompetitionFormat.SINGLE_ELIMINATION, CompetitionFormat.ROUND_ROBIN],
    defaultFormat: CompetitionFormat.SINGLE_ELIMINATION,
    supportsTeamSizeOverride: true
  },
};

// Helper function to calculate participants based on teams
export const calculateParticipants = (
  numberOfTeams: number,
  sportType: SportType,
  category: string,
  teamSize?: number
): number => {
  const baseTeamSize = TeamSizeMap[sportType]?.[category] || 1;
  const finalTeamSize = teamSize || baseTeamSize;
  return numberOfTeams * finalTeamSize;
};

// Helper function to check if sport is team-based
export const isTeamSport = (sportType: SportType): boolean => {
  const teamSports = [SportType.FOOTBALL, SportType.BASKETBALL, SportType.VOLLEYBALL];
  return teamSports.includes(sportType);
};

// Helper functions for display names
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