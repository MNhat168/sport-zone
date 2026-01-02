// admin-stats.dto.ts
export class FieldOwnerStatsDto {
    fieldOwnerId: string;
    fieldOwnerName: string;
    totalFields: number;
    averageRating: number;
    totalBookings: number;
    bookingRate: number;
    totalFavorites: number;
    aiInsight: string;
    
    // Enhanced fields
    monthlyBookings: MonthlyBookingDto[];
    sportsDistribution: SportsDistributionDto[];
    bookingTrend: 'increasing' | 'decreasing' | 'stable';
    revenueTrend: 'increasing' | 'decreasing' | 'stable';
    peakBookingHours: string[];
    cancellationRate: number;
    repeatCustomerRate: number;
    performanceScore: number;
    marketPosition: 'leader' | 'strong' | 'average' | 'developing';
    growthPotential: number;
    strengths: string[];
    opportunities: string[];
    recommendations: string[];
}

export class CoachStatsDto {
    coachId: string;
    coachName: string;
    averageRating: number;
    totalBookings: number;
    totalFavorites: number;
    aiInsight: string;
    
    // Enhanced fields
    sports: string;
    hourlyRate: number;
    monthlyBookings: MonthlyBookingDto[];
    bookingTrend: 'increasing' | 'decreasing' | 'stable';
    clientRetentionRate: number;
    peakAvailability: string[];
    certificationLevel: string;
    experienceLevel: 'beginner' | 'intermediate' | 'expert';
    performanceScore: number;
    marketPosition: 'leader' | 'strong' | 'average' | 'developing';
    strengths: string[];
    opportunities: string[];
    recommendations: string[];
}

export class PlatformAnalyticsDto {
    summary: PlatformSummaryDto;
    revenueAnalysis: RevenueAnalysisDto;
    popularityAnalysis: PopularityAnalysisDto;
    userBehavior: UserBehaviorDto;
    recommendations: string[];
}

// Supporting DTOs
export class MonthlyBookingDto {
    month: string;
    count: number;
    revenue: number;
    growth?: number;
}

export class SportsDistributionDto {
    sport: string;
    count: number;
    percentage: number;
}

export class PlatformSummaryDto {
    totalRevenue: number;
    totalBookings: number;
    totalUsers: number;
    averageRating: number;
    growthRate: number;
}

export class RevenueAnalysisDto {
    monthlyRevenue: MonthlyRevenueDto[];
    revenueBySport: RevenueBySportDto[];
    revenueByType: RevenueByTypeDto[];
    peakRevenuePeriods: string[];
}

export class MonthlyRevenueDto {
    month: string;
    revenue: number;
    growth: number;
}

export class RevenueBySportDto {
    sport: string;
    revenue: number;
    percentage: number;
}

export class RevenueByTypeDto {
    type: 'field' | 'coach' | 'tournament';
    revenue: number;
    percentage: number;
}

export class PopularityAnalysisDto {
    sportsPopularity: SportsPopularityDto[];
    fieldPopularity: FieldPopularityDto[];
    coachPopularity: CoachPopularityDto[];
    trendingSports: string[];
}

export class SportsPopularityDto {
    sport: string;
    bookings: number;
    tournaments: number;
    favorites: number;
    score: number;
}

export class FieldPopularityDto {
    fieldId: string;
    name: string;
    bookings: number;
    favorites: number;
    rating: number;
}

export class CoachPopularityDto {
    coachId: string;
    name: string;
    bookings: number;
    favorites: number;
    rating: number;
}

export class UserBehaviorDto {
    bookingPatterns: BookingPatternsDto;
    retentionMetrics: RetentionMetricsDto;
}

export class BookingPatternsDto {
    peakBookingDays: string[];
    peakBookingHours: string[];
    averageBookingDuration: number;
    preferredSports: string[];
}

export class RetentionMetricsDto {
    repeatBookingRate: number;
    favoriteToBookingConversion: number;
    userSatisfactionScore: number;
}

// Request DTOs for filtering
export class AnalyticsFilterDto {
    startDate?: Date;
    endDate?: Date;
    sportType?: string;
    timeRange?: 'week' | 'month' | 'quarter' | 'year' | 'all';
}

export class DetailedFieldOwnerStatsDto extends FieldOwnerStatsDto {
    revenueByMonth: RevenueByMonthDto[];
    fieldDetails: FieldDetailDto[];
    customerDemographics: CustomerDemographicsDto;
}

export class RevenueByMonthDto {
    month: string;
    revenue: number;
    bookings: number;
    averageBookingValue: number;
}

export class FieldDetailDto {
    fieldId: string;
    name: string;
    sportType: string;
    rating: number;
    bookings: number;
    revenue: number;
    utilizationRate: number;
}

export class CustomerDemographicsDto {
    ageGroups: AgeGroupDto[];
    repeatCustomers: number;
    newCustomers: number;
    preferredBookingTimes: string[];
}

export class AgeGroupDto {
    range: string;
    percentage: number;
}