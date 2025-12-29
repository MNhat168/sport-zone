// ai.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Groq from 'groq-sdk';
import OpenAI from 'openai';

export interface DetailedFieldOwnerStats {
    fieldOwnerId: string;
    fieldOwnerName: string;
    totalFields: number;
    averageRating: number;
    totalBookings: number;
    totalFavorites: number;
    monthlyBookings: { month: string; count: number; revenue: number }[];
    sportsDistribution: { sport: string; count: number; percentage: number }[];
    bookingTrend: 'increasing' | 'decreasing' | 'stable';
    revenueTrend: 'increasing' | 'decreasing' | 'stable';
    peakBookingHours: string[];
    cancellationRate: number;
    repeatCustomerRate: number;
}

export interface DetailedCoachStats {
    coachId: string;
    coachName: string;
    sports: string[];
    averageRating: number;
    totalBookings: number;
    totalFavorites: number;
    hourlyRate: number;
    monthlyBookings: { month: string; count: number; revenue: number }[];
    bookingTrend: 'increasing' | 'decreasing' | 'stable';
    clientRetentionRate: number;
    peakAvailability: string[];
    certificationLevel: string;
    experienceLevel: 'beginner' | 'intermediate' | 'expert';
}

export interface PlatformAnalytics {
    summary: {
        totalRevenue: number;
        totalBookings: number;
        totalUsers: number;
        averageRating: number;
        growthRate: number;
    };
    revenueAnalysis: {
        monthlyRevenue: { month: string; revenue: number; growth: number }[];
        revenueBySport: { sport: string; revenue: number; percentage: number }[];
        revenueByType: { type: 'field' | 'coach' | 'tournament'; revenue: number; percentage: number }[];
        peakRevenuePeriods: string[];
    };
    popularityAnalysis: {
        sportsPopularity: { sport: string; bookings: number; tournaments: number; favorites: number; score: number }[];
        fieldPopularity: { fieldId: string; name: string; bookings: number; favorites: number; rating: number }[];
        coachPopularity: { coachId: string; name: string; bookings: number; favorites: number; rating: number }[];
        trendingSports: string[];
    };
    userBehavior: {
        bookingPatterns: {
            peakBookingDays: string[];
            peakBookingHours: string[];
            averageBookingDuration: number;
            preferredSports: string[];
        };
        retentionMetrics: {
            repeatBookingRate: number;
            favoriteToBookingConversion: number;
            userSatisfactionScore: number;
        };
    };
    recommendations: string[];
}

export interface PlatformAnalyticsData {
    revenueData: { month: string; revenue: number; count?: number }[];
    revenueBySport: { sport: string; revenue: number; count?: number }[];
    revenueByType: { type: string; revenue: number; count?: number }[];
    bookingStats: {
        total: number;
        fieldBookings: number;
        coachBookings: number;
    };
    userStats: {
        total: number;
        activeUsers: number;
    };
    sportsFieldBookings: { _id: string; count: number }[];
    sportsTournamentParticipation: { _id: string; count: number }[];
    topFieldsByFavorites: {
        fieldId: string;
        name: string;
        sportType: string;
        rating: number;
        totalReviews: number;
        favoritesCount: number;
    }[];
    topCoachesByFavorites: {
        coachId: string;
        name: string;
        sports: string[];
        rating: number;
        favoritesCount: number;
    }[];
    bookingPatterns: {
        peakBookingDays: string[];
        peakBookingHours: string[];
        averageBookingDuration: number;
        preferredSports: string[];
    };
    retentionMetrics: {
        repeatBookingRate: number;
        favoriteToBookingConversion: number;
        userSatisfactionScore: number;
    };
}

@Injectable()
export class AiService {
    private readonly logger = new Logger(AiService.name);
    private groq: Groq;
    private openai: OpenAI;

    constructor(private configService: ConfigService) {
        const groqApiKey = this.configService.get<string>('GROQ_API_KEY');
        const openaiApiKey = this.configService.get<string>('OPENAI_API_KEY');

        if (!groqApiKey || groqApiKey === 'tba') {
            this.logger.warn('Groq API Key is not set. Using enhanced simulated insights with actual data.');
        } else {
            this.groq = new Groq({
                apiKey: groqApiKey,
            });
            this.logger.log('Groq AI initialized successfully');
        }

        if (openaiApiKey) {
            this.openai = new OpenAI({
                apiKey: openaiApiKey,
            });
            this.logger.log('OpenAI AI initialized successfully');
        } else {
            this.logger.warn('OpenAI API Key is not set. OCR features will be disabled.');
        }
    }

    /**
     * Extracts transaction data from a receipt image using OpenAI Vision
     */
    async extractTransactionData(imageBuffer: Buffer, mimetype: string): Promise<{
        amount: number;
        transactionDate?: Date;
        referenceCode?: string;
        isReceipt: boolean;
        confidence: number;
    }> {
        if (!this.openai) {
            this.logger.error('OpenAI not initialized. Cannot extract transaction data.');
            return { amount: 0, isReceipt: false, confidence: 0 };
        }

        try {
            const base64Image = imageBuffer.toString('base64');
            const response = await this.openai.chat.completions.create({
                model: "gpt-5.1",
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Scan this transaction receipt and extract the following data in JSON format: amount (number, just the value, e.g., 50000), transactionDate (ISO string), and referenceCode (string). Also, include a field 'isReceipt' (boolean) to indicate if this is actually a payment receipt, and 'confidence' (0-1) for how certain you are about the amount. Only return the JSON object."
                            },
                            {
                                type: "image_url",
                                image_url: {
                                    url: `data:${mimetype};base64,${base64Image}`,
                                },
                            },
                        ],
                    },
                ],
                max_completion_tokens: 300,
                response_format: { type: "json_object" },
            });

            const content = response.choices[0]?.message?.content || "{}";
            const extracted = JSON.parse(content);

            return {
                amount: Number(extracted.amount) || 0,
                transactionDate: extracted.transactionDate ? new Date(extracted.transactionDate) : undefined,
                referenceCode: extracted.referenceCode,
                isReceipt: !!extracted.isReceipt,
                confidence: Number(extracted.confidence) || 0,
            };
        } catch (error) {
            this.logger.error('Failed to extract transaction data from image:', error);
            return { amount: 0, isReceipt: false, confidence: 0 };
        }
    }

    async generatePlatformAnalytics(data: PlatformAnalyticsData): Promise<PlatformAnalytics> {
        if (!this.groq) {
            return this.generateEnhancedSimulatedPlatformAnalytics(data);
        }

        try {
            const prompt = this.buildPlatformAnalyticsPrompt(data);

            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a senior sports analytics expert. Provide data-driven insights with actionable recommendations. For revenue types, use ONLY 'field', 'coach', or 'tournament' exactly as written. Always base your analysis on the provided data, not assumptions."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.7,
                max_completion_tokens: 2000,
                response_format: { type: "json_object" },
            });

            const response = chatCompletion.choices[0]?.message?.content || "{}";
            const parsedData = JSON.parse(response);

            // Validate and convert the response
            return this.convertToPlatformAnalytics(parsedData, data);

        } catch (error) {
            this.logger.error('Failed to generate platform analytics:', error);
            return this.generateEnhancedSimulatedPlatformAnalytics(data);
        }
    }

    private buildPlatformAnalyticsPrompt(data: PlatformAnalyticsData): string {
        // Calculate derived metrics from actual data
        const totalRevenue = data.revenueData?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const totalBookings = data.bookingStats?.total || 0;
        const totalUsers = data.userStats?.total || 0;
        const activeUsers = data.userStats?.activeUsers || 0;

        // Calculate revenue by type percentages
        const revenueByTypeWithPercentages = data.revenueByType?.map(item => ({
            ...item,
            percentage: totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0
        })) || [];

        // Calculate sports popularity scores from actual data
        const sportsPopularity = this.calculateSportsPopularityFromData(data);

        return `
        Analyze this comprehensive sports booking platform data (ALL NUMBERS ARE REAL DATA FROM DATABASE):

        ## SUMMARY METRICS (Real Data)
        Total Revenue: $${totalRevenue.toLocaleString()}
        Total Bookings: ${totalBookings.toLocaleString()}
        Total Users: ${totalUsers.toLocaleString()}
        Active Users: ${activeUsers.toLocaleString()}
        
        ## REVENUE DATA (Last 6 Months)
        ${JSON.stringify(data.revenueData || [], null, 2)}
        
        ## REVENUE BY SPORT
        ${JSON.stringify(data.revenueBySport || [], null, 2)}
        
        ## REVENUE BY TYPE (with calculated percentages)
        ${JSON.stringify(revenueByTypeWithPercentages, null, 2)}
        
        ## BOOKING STATISTICS
        Total: ${data.bookingStats?.total || 0}
        Field Bookings: ${data.bookingStats?.fieldBookings || 0}
        Coach Bookings: ${data.bookingStats?.coachBookings || 0}
        
        ## USER STATISTICS
        Total Users: ${data.userStats?.total || 0}
        Active Users: ${data.userStats?.activeUsers || 0}
        
        ## SPORTS FIELD BOOKINGS (Real counts)
        ${JSON.stringify(data.sportsFieldBookings || [], null, 2)}
        
        ## SPORTS TOURNAMENT PARTICIPATION
        ${JSON.stringify(data.sportsTournamentParticipation || [], null, 2)}
        
        ## TOP FIELDS BY FAVORITES
        ${JSON.stringify(data.topFieldsByFavorites?.slice(0, 10) || [], null, 2)}
        
        ## TOP COACHES BY FAVORITES
        ${JSON.stringify(data.topCoachesByFavorites?.slice(0, 10) || [], null, 2)}
        
        ## BOOKING PATTERNS
        Peak Days: ${data.bookingPatterns?.peakBookingDays?.join(', ') || 'N/A'}
        Peak Hours: ${data.bookingPatterns?.peakBookingHours?.join(', ') || 'N/A'}
        Average Duration: ${data.bookingPatterns?.averageBookingDuration || 0} hours
        Preferred Sports: ${data.bookingPatterns?.preferredSports?.join(', ') || 'N/A'}
        
        ## RETENTION METRICS
        Repeat Booking Rate: ${data.retentionMetrics?.repeatBookingRate || 0}%
        Favorite to Booking Conversion: ${data.retentionMetrics?.favoriteToBookingConversion || 0}%
        User Satisfaction Score: ${data.retentionMetrics?.userSatisfactionScore || 0}/5
        
        Provide a comprehensive analysis in the following EXACT JSON structure, using ONLY the data provided above:
        {
            "summary": {
                "totalRevenue": ${totalRevenue},
                "totalBookings": ${totalBookings},
                "totalUsers": ${activeUsers},
                "averageRating": ${this.calculateAverageRatingFromData(data)},
                "growthRate": ${this.calculateGrowthRateFromData(data)}
            },
            "revenueAnalysis": {
                "monthlyRevenue": [Calculate from revenueData array with growth percentages],
                "revenueBySport": [Use revenueBySport array with calculated percentages],
                "revenueByType": [Use revenueByTypeWithPercentages array - type must be exactly "field", "coach", or "tournament"],
                "peakRevenuePeriods": [Infer from bookingPatterns and revenue trends]
            },
            "popularityAnalysis": {
                "sportsPopularity": ${JSON.stringify(sportsPopularity)},
                "fieldPopularity": [Use topFieldsByFavorites array with additional metrics],
                "coachPopularity": [Use topCoachesByFavorites array with additional metrics],
                "trendingSports": [Identify from sportsFieldBookings growth trends]
            },
            "userBehavior": {
                "bookingPatterns": ${JSON.stringify(data.bookingPatterns || {})},
                "retentionMetrics": ${JSON.stringify(data.retentionMetrics || {})}
            },
            "recommendations": [Generate 5-8 actionable recommendations based on the real data above]
        }
        
        IMPORTANT: 
        1. Use EXACT numbers provided above - do not invent data
        2. For "type" field in "revenueByType": MUST be exactly "field", "coach", or "tournament"
        3. For sportsPopularity: Use the calculated scores from ${JSON.stringify(sportsPopularity.slice(0, 5))}
        4. Recommendations should be specific to this platform's actual performance metrics
    `;
    }

    private calculateSportsPopularityFromData(data: PlatformAnalyticsData): Array<{
        sport: string;
        bookings: number;
        tournaments: number;
        favorites: number;
        score: number;
    }> {
        // Create a map to aggregate data from different sources
        const sportMap = new Map<string, {
            sport: string;
            bookings: number;
            tournaments: number;
            favorites: number;
        }>();

        // Aggregate field bookings
        data.sportsFieldBookings?.forEach(item => {
            if (item._id) {
                const existing = sportMap.get(item._id) || { sport: item._id, bookings: 0, tournaments: 0, favorites: 0 };
                existing.bookings += item.count || 0;
                sportMap.set(item._id, existing);
            }
        });

        // Aggregate tournament participation
        data.sportsTournamentParticipation?.forEach(item => {
            if (item._id) {
                const existing = sportMap.get(item._id) || { sport: item._id, bookings: 0, tournaments: 0, favorites: 0 };
                existing.tournaments += item.count || 0;
                sportMap.set(item._id, existing);
            }
        });

        // Calculate scores and return sorted array
        return Array.from(sportMap.values())
            .map(sport => ({
                ...sport,
                score: this.calculatePopularityScore(sport.bookings, sport.tournaments, sport.favorites)
            }))
            .sort((a, b) => b.score - a.score);
    }

    private calculatePopularityScore(bookings: number, tournaments: number, favorites: number): number {
        const bookingScore = Math.min(bookings * 0.5, 40); // Max 40 points
        const tournamentScore = Math.min(tournaments * 2, 30); // Max 30 points
        const favoriteScore = Math.min(favorites * 0.1, 30); // Max 30 points
        return Math.min(100, bookingScore + tournamentScore + favoriteScore);
    }

    private calculateAverageRatingFromData(data: PlatformAnalyticsData): number {
        // Calculate average rating from top fields and coaches
        const fieldRatings = data.topFieldsByFavorites?.map(f => f.rating || 0) || [];
        const coachRatings = data.topCoachesByFavorites?.map(c => c.rating || 0) || [];
        const allRatings = [...fieldRatings, ...coachRatings];

        if (allRatings.length === 0) return 4.0; // Default if no ratings

        const sum = allRatings.reduce((acc, rating) => acc + rating, 0);
        return Number((sum / allRatings.length).toFixed(1));
    }

    private calculateGrowthRateFromData(data: PlatformAnalyticsData): number {
        // Calculate growth rate from monthly revenue data
        if (!data.revenueData || data.revenueData.length < 2) return 0;

        const lastMonth = data.revenueData[data.revenueData.length - 1];
        const prevMonth = data.revenueData[data.revenueData.length - 2];

        if (!lastMonth || !prevMonth || prevMonth.revenue === 0) return 0;

        const growth = ((lastMonth.revenue - prevMonth.revenue) / prevMonth.revenue) * 100;
        return Number(growth.toFixed(1));
    }

    async generateFieldOwnerInsights(stats: DetailedFieldOwnerStats): Promise<{
        summary: string;
        strengths: string[];
        opportunities: string[];
        recommendations: string[];
        metrics: {
            performanceScore: number;
            marketPosition: 'leader' | 'strong' | 'average' | 'developing';
            growthPotential: number;
        };
    }> {
        if (!this.groq) {
            return this.generateEnhancedFieldOwnerInsights(stats);
        }

        try {
            const prompt = this.buildFieldOwnerPrompt(stats);

            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a business analyst specializing in sports facility management. Provide strategic insights for field owners based on their actual performance data."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.7,
                max_completion_tokens: 500,
                response_format: { type: "json_object" },
            });

            const response = chatCompletion.choices[0]?.message?.content || "{}";
            return JSON.parse(response);

        } catch (error) {
            this.logger.error('Failed to generate field owner insights:', error);
            return this.generateEnhancedFieldOwnerInsights(stats);
        }
    }

    async generateCoachInsights(stats: DetailedCoachStats): Promise<{
        summary: string;
        strengths: string[];
        opportunities: string[];
        recommendations: string[];
        metrics: {
            performanceScore: number;
            marketPosition: 'leader' | 'strong' | 'average' | 'developing';
            growthPotential: number;
        };
    }> {
        if (!this.groq) {
            return this.generateEnhancedCoachInsights(stats);
        }

        try {
            const prompt = this.buildCoachPrompt(stats);

            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a sports business consultant specializing in coaching services. Provide strategic insights for coaches based on their actual performance data."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.7,
                max_completion_tokens: 500,
                response_format: { type: "json_object" },
            });

            const response = chatCompletion.choices[0]?.message?.content || "{}";
            return JSON.parse(response);

        } catch (error) {
            this.logger.error('Failed to generate coach insights:', error);
            return this.generateEnhancedCoachInsights(stats);
        }
    }
    async moderateContent(text: string): Promise<{ isSafe: boolean; reason?: string; flaggedWords?: string[] }> {
        if (!this.groq) {
            // If Groq is not available, we default to safe (or could use a basic regex list)
            // For now, allow everything if AI is down to avoid blocking legitimate users
            return { isSafe: true };
        }

        try {
            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: `You are a content moderation AI. Analyze the text for inappropriate content including:
                        - Profanity/Swearing (in English, Vietnamese, or other languages)
                        - Hate speech, discrimination, harassment
                        - Sexual content
                        - Violence or threats
                        
                        Return ONLY a JSON object: { "isSafe": boolean, "reason": string | null, "flaggedWords": string[] }
                        If isSafe is false:
                        - provide a short, polite reason (e.g., "Contains profanity").
                        - list the specific words or phrases that triggered the flag in "flaggedWords".`
                    },
                    {
                        role: "user",
                        content: text
                    }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0, // Deterministic
                max_completion_tokens: 100,
                response_format: { type: "json_object" },
            });

            const response = chatCompletion.choices[0]?.message?.content || "{}";
            const result = JSON.parse(response);

            return {
                isSafe: !!result.isSafe,
                reason: result.reason || undefined,
                flaggedWords: Array.isArray(result.flaggedWords) ? result.flaggedWords : []
            };

        } catch (error) {
            this.logger.error('Failed to moderate content:', error);
            // Fail open (allow) if AI fails, to prevent service disruption
            return { isSafe: true };
        }
    }


    private buildFieldOwnerPrompt(stats: DetailedFieldOwnerStats): string {
        const totalRevenue = stats.monthlyBookings?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const avgMonthlyRevenue = stats.monthlyBookings?.length > 0
            ? totalRevenue / stats.monthlyBookings.length
            : 0;

        return `
        Analyze this field owner's ACTUAL performance data:

        Field Owner: ${stats.fieldOwnerName}
        
        ## BASIC METRICS
        Total Fields: ${stats.totalFields}
        Average Rating: ${stats.averageRating.toFixed(1)}/5
        Total Bookings: ${stats.totalBookings}
        Total Favorites: ${stats.totalFavorites}
        Total Revenue: $${totalRevenue.toLocaleString()}
        Average Monthly Revenue: $${avgMonthlyRevenue.toLocaleString()}
        
        ## TRENDS
        Booking Trend: ${stats.bookingTrend}
        Revenue Trend: ${stats.revenueTrend}
        
        ## SPORTS DISTRIBUTION (Real Data)
        ${JSON.stringify(stats.sportsDistribution, null, 2)}
        
        ## MONTHLY PERFORMANCE (Last 6 Months)
        ${JSON.stringify(stats.monthlyBookings, null, 2)}
        
        ## QUALITY METRICS
        Cancellation Rate: ${stats.cancellationRate.toFixed(1)}%
        Repeat Customer Rate: ${stats.repeatCustomerRate.toFixed(1)}%
        Peak Booking Hours: ${stats.peakBookingHours?.join(', ') || 'N/A'}
        
        ## CALCULATED METRICS
        - Booking to Favorite Ratio: ${stats.totalFavorites > 0 ? ((stats.totalBookings / stats.totalFavorites) * 100).toFixed(1) : 0}%
        - Revenue per Booking: $${totalRevenue > 0 ? (totalRevenue / stats.totalBookings).toFixed(2) : 0}
        - Field Utilization: ${(stats.totalFields > 0 ? (stats.totalBookings / stats.totalFields) : 0).toFixed(1)} bookings per field
        
        Provide strategic insights in JSON format with:
        1. summary: Brief performance summary based on actual numbers
        2. strengths: 3-4 key strengths from the data
        3. opportunities: 3-4 improvement opportunities based on metrics
        4. recommendations: 4-5 actionable recommendations specific to this owner
        5. metrics: {
            performanceScore: 0-100 (calculate from: rating×15 + bookings/100×30 + favorites/50×25 + (1-cancellationRate)×20 + repeatCustomerRate×0.1),
            marketPosition: 'leader'|'strong'|'average'|'developing' (based on performanceScore),
            growthPotential: 0-100 (inverse of performanceScore or based on opportunities)
        }
    `;
    }

    private buildCoachPrompt(stats: DetailedCoachStats): string {
        const totalRevenue = stats.monthlyBookings?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const avgMonthlyRevenue = stats.monthlyBookings?.length > 0
            ? totalRevenue / stats.monthlyBookings.length
            : 0;
        const revenuePerBooking = stats.totalBookings > 0 ? totalRevenue / stats.totalBookings : 0;

        return `
        Analyze this coach's ACTUAL performance data:

        Coach: ${stats.coachName}
        
        ## BASIC METRICS
        Sports: ${stats.sports?.join(', ') || 'Not specified'}
        Hourly Rate: $${stats.hourlyRate}
        Average Rating: ${stats.averageRating.toFixed(1)}/5
        Total Bookings: ${stats.totalBookings}
        Total Favorites: ${stats.totalFavorites}
        Total Revenue: $${totalRevenue.toLocaleString()}
        
        ## TRENDS
        Booking Trend: ${stats.bookingTrend}
        
        ## MONTHLY PERFORMANCE (Last 6 Months)
        ${JSON.stringify(stats.monthlyBookings, null, 2)}
        
        ## QUALITY METRICS
        Client Retention Rate: ${stats.clientRetentionRate.toFixed(1)}%
        Peak Availability: ${stats.peakAvailability?.join(', ') || 'N/A'}
        
        ## PROFESSIONAL DETAILS
        Certification: ${stats.certificationLevel || 'Not specified'}
        Experience Level: ${stats.experienceLevel}
        
        ## CALCULATED METRICS
        - Revenue per Booking: $${revenuePerBooking.toFixed(2)}
        - Booking to Favorite Ratio: ${stats.totalFavorites > 0 ? ((stats.totalBookings / stats.totalFavorites) * 100).toFixed(1) : 0}%
        - Monthly Average Revenue: $${avgMonthlyRevenue.toLocaleString()}
        - Hourly Rate vs Market: ${stats.hourlyRate > 50 ? 'Premium' : stats.hourlyRate > 30 ? 'Average' : 'Economy'}
        
        Provide strategic insights in JSON format with:
        1. summary: Brief performance summary based on actual numbers
        2. strengths: 3-4 key strengths from the data
        3. opportunities: 3-4 improvement opportunities based on metrics
        4. recommendations: 4-5 actionable recommendations specific to this coach
        5. metrics: {
            performanceScore: 0-100 (calculate from: rating×15 + bookings/20×30 + favorites/30×25 + clientRetentionRate×0.3 + experienceBonus),
            marketPosition: 'leader'|'strong'|'average'|'developing' (based on performanceScore),
            growthPotential: 0-100 (inverse of performanceScore or based on opportunities)
        }
        
        Note: experienceBonus = expert:15, intermediate:10, beginner:5
    `;
    }

    private generateEnhancedSimulatedPlatformAnalytics(data: PlatformAnalyticsData): PlatformAnalytics {
        // Use actual data from the database instead of hardcoded values
        const totalRevenue = data.revenueData?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const totalBookings = data.bookingStats?.total || 0;
        const totalUsers = data.userStats?.activeUsers || 0;

        // Calculate monthly revenue with growth
        const monthlyRevenue = data.revenueData?.map((month, index, array) => {
            if (index === 0) return { month: month.month, revenue: month.revenue || 0, growth: 0 };

            const prevMonth = array[index - 1];
            const growth = prevMonth.revenue > 0
                ? ((month.revenue - prevMonth.revenue) / prevMonth.revenue) * 100
                : 0;

            return {
                month: month.month,
                revenue: month.revenue || 0,
                growth: Number(growth.toFixed(2))
            };
        }) || [];

        // Calculate revenue by sport percentages
        const revenueBySport = data.revenueBySport?.map(sport => ({
            sport: sport.sport,
            revenue: sport.revenue || 0,
            percentage: totalRevenue > 0 ? (sport.revenue / totalRevenue) * 100 : 0
        })) || [];

        // Calculate revenue by type with fixed types
        const revenueByType: { type: 'field' | 'coach' | 'tournament'; revenue: number; percentage: number }[] =
            data.revenueByType?.map(item => ({
                type: this.validateRevenueType(item.type),
                revenue: item.revenue || 0,
                percentage: totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0
            })) || [
                { type: 'field', revenue: totalRevenue * 0.65, percentage: 65 },
                { type: 'coach', revenue: totalRevenue * 0.23, percentage: 23 },
                { type: 'tournament', revenue: totalRevenue * 0.12, percentage: 12 }
            ];

        // Calculate sports popularity from actual data
        const sportsPopularity = this.calculateSportsPopularityFromData(data);

        // Use actual top fields and coaches
        const fieldPopularity = data.topFieldsByFavorites?.slice(0, 10).map(field => ({
            fieldId: field.fieldId,
            name: field.name,
            bookings: 0, // Would need actual booking counts
            favorites: field.favoritesCount || 0,
            rating: field.rating || 0
        })) || [];

        const coachPopularity = data.topCoachesByFavorites?.slice(0, 10).map(coach => ({
            coachId: coach.coachId,
            name: coach.name,
            bookings: 0, // Would need actual booking counts
            favorites: coach.favoritesCount || 0,
            rating: coach.rating || 0
        })) || [];

        // Identify trending sports based on recent growth
        const trendingSports = this.identifyTrendingSports(data);

        return {
            summary: {
                totalRevenue,
                totalBookings,
                totalUsers,
                averageRating: this.calculateAverageRatingFromData(data),
                growthRate: this.calculateGrowthRateFromData(data)
            },
            revenueAnalysis: {
                monthlyRevenue,
                revenueBySport,
                revenueByType,
                peakRevenuePeriods: data.bookingPatterns?.peakBookingHours
                    ? [`Evenings (${data.bookingPatterns.peakBookingHours.join(', ')})`, 'Weekends']
                    : ['Weekends', 'Evenings (6-9 PM)']
            },
            popularityAnalysis: {
                sportsPopularity: sportsPopularity.slice(0, 10),
                fieldPopularity,
                coachPopularity,
                trendingSports
            },
            userBehavior: {
                bookingPatterns: data.bookingPatterns || {
                    peakBookingDays: [],
                    peakBookingHours: [],
                    averageBookingDuration: 0,
                    preferredSports: []
                },
                retentionMetrics: data.retentionMetrics || {
                    repeatBookingRate: 0,
                    favoriteToBookingConversion: 0,
                    userSatisfactionScore: 0
                }
            },
            recommendations: this.generateRecommendationsFromData(data)
        };
    }

    private generateEnhancedFieldOwnerInsights(stats: DetailedFieldOwnerStats): any {
        // Calculate performance score based on actual data
        const performanceScore = Math.min(
            100,
            (stats.averageRating * 15) +
            (Math.min(stats.totalBookings / 100, 30)) +
            (Math.min(stats.totalFavorites / 50, 25)) +
            ((1 - stats.cancellationRate / 100) * 20) +
            (stats.repeatCustomerRate * 0.1)
        );

        const topSport = stats.sportsDistribution?.length > 0
            ? stats.sportsDistribution[0]
            : null;

        const totalRevenue = stats.monthlyBookings?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const revenuePerBooking = stats.totalBookings > 0 ? totalRevenue / stats.totalBookings : 0;

        return {
            summary: `${stats.fieldOwnerName} manages ${stats.totalFields} fields with ${stats.totalBookings} total bookings. ` +
                `Maintains a ${stats.averageRating.toFixed(1)}/5 rating and ${stats.repeatCustomerRate.toFixed(1)}% repeat customer rate. ` +
                `${topSport ? `Strongest in ${topSport.sport} (${topSport.percentage.toFixed(1)}% of inventory).` : ''}`,
            strengths: [
                `High average rating of ${stats.averageRating.toFixed(1)}/5`,
                `${stats.totalFavorites.toLocaleString()} user favorites`,
                `${stats.repeatCustomerRate.toFixed(1)}% repeat customer rate`,
                `Well-distributed across ${stats.sportsDistribution?.length || 0} sports`,
                `Revenue per booking: $${revenuePerBooking.toFixed(2)}`
            ].filter(Boolean),
            opportunities: [
                `Reduce cancellation rate (currently ${stats.cancellationRate.toFixed(1)}%)`,
                `Optimize pricing during peak hours: ${stats.peakBookingHours?.join(', ') || 'not identified'}`,
                `Increase off-peak utilization`,
                `Expand into additional sports categories`,
                `Improve booking-to-favorite conversion (currently ${stats.totalFavorites > 0 ? ((stats.totalBookings / stats.totalFavorites) * 100).toFixed(1) : 0}%)`
            ],
            recommendations: [
                "Implement a loyalty program targeting repeat customers",
                `Introduce ${topSport?.sport || 'popular sport'} tournament packages`,
                "Offer bundled deals for multiple field bookings",
                "Add premium amenities to increase average booking value by 15-20%",
                "Use dynamic pricing during identified peak hours",
                "Create promotional packages for underutilized time slots"
            ],
            metrics: {
                performanceScore: Math.round(performanceScore),
                marketPosition: performanceScore > 80 ? 'leader' :
                    performanceScore > 60 ? 'strong' :
                        performanceScore > 40 ? 'average' : 'developing',
                growthPotential: Math.round(100 - performanceScore)
            }
        };
    }

    private generateEnhancedCoachInsights(stats: DetailedCoachStats): any {
        // Calculate performance score based on actual data
        const experienceBonus = stats.experienceLevel === 'expert' ? 15 :
            stats.experienceLevel === 'intermediate' ? 10 : 5;

        const performanceScore = Math.min(
            100,
            (stats.averageRating * 15) +
            (Math.min(stats.totalBookings / 20, 30)) +
            (Math.min(stats.totalFavorites / 30, 25)) +
            (stats.clientRetentionRate * 0.3) +
            experienceBonus
        );

        const totalRevenue = stats.monthlyBookings?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const revenuePerBooking = stats.totalBookings > 0 ? totalRevenue / stats.totalBookings : 0;
        const hourlyRateCategory = stats.hourlyRate > 50 ? 'Premium' :
            stats.hourlyRate > 30 ? 'Average' : 'Economy';

        return {
            summary: `${stats.coachName} is a ${stats.experienceLevel} ${stats.certificationLevel || 'certified'} coach ` +
                `specializing in ${stats.sports?.join(', ') || 'multiple sports'}. ` +
                `Maintains a ${stats.averageRating.toFixed(1)}/5 rating with ${stats.clientRetentionRate.toFixed(1)}% client retention. ` +
                `Charges $${stats.hourlyRate}/hr (${hourlyRateCategory} tier).`,
            strengths: [
                `High average rating of ${stats.averageRating.toFixed(1)}/5`,
                `Strong client retention (${stats.clientRetentionRate.toFixed(1)}%)`,
                `${stats.totalFavorites.toLocaleString()} user favorites`,
                `${stats.experienceLevel} level experience`,
                `Revenue per booking: $${revenuePerBooking.toFixed(2)}`
            ],
            opportunities: [
                `Expand availability during ${stats.peakAvailability?.join(', ') || 'peak hours'}`,
                `Increase hourly rate based on ${stats.experienceLevel} experience and ${stats.averageRating.toFixed(1)} rating`,
                `Develop specialized programs for ${stats.sports?.[0] || 'primary sport'}`,
                `Improve online presence and client reviews`,
                `Target group coaching sessions to increase revenue`
            ],
            recommendations: [
                `Create ${stats.sports?.[0] || 'sport'}-specific training packages`,
                "Offer 10-session bundles with loyalty discounts",
                "Implement a referral program (offer 1 free session for 3 referrals)",
                "Record coaching sessions for digital product creation",
                "Partner with local sports clubs for group sessions",
                "Create seasonal training camps during holidays"
            ],
            metrics: {
                performanceScore: Math.round(performanceScore),
                marketPosition: performanceScore > 80 ? 'leader' :
                    performanceScore > 60 ? 'strong' :
                        performanceScore > 40 ? 'average' : 'developing',
                growthPotential: Math.round(100 - performanceScore)
            }
        };
    }

    private identifyTrendingSports(data: PlatformAnalyticsData): string[] {
        // Identify trending sports based on field bookings
        return data.sportsFieldBookings
            ?.sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, 3)
            .map(item => item._id)
            .filter(Boolean) || [];
    }

    private generateRecommendationsFromData(data: PlatformAnalyticsData): string[] {
        const recommendations: string[] = [];

        // Revenue-based recommendations
        const totalRevenue = data.revenueData?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0;
        const fieldRevenueItem = data.revenueByType?.find(item => item.type === 'field');
        const fieldRevenuePercent = fieldRevenueItem && totalRevenue > 0
            ? (fieldRevenueItem.revenue / totalRevenue) * 100
            : 65;

        if (fieldRevenuePercent > 70) {
            recommendations.push("Diversify revenue streams by expanding coach and tournament offerings");
        }

        if (totalRevenue < 10000) {
            recommendations.push("Focus on customer acquisition with targeted promotions for new users");
        }

        // Booking pattern recommendations
        const peakHours = data.bookingPatterns?.peakBookingHours || [];
        if (peakHours.length > 0 && peakHours.every(hour => hour.includes('18') || hour.includes('19'))) {
            recommendations.push("Introduce morning and afternoon discounts to improve off-peak utilization");
        }

        // Sports popularity recommendations
        const topSports = data.sportsFieldBookings
            ?.sort((a, b) => (b.count || 0) - (a.count || 0))
            .slice(0, 2)
            .map(s => s._id) || [];

        if (topSports.length > 0) {
            recommendations.push(`Create premium packages for ${topSports.join(' and ')} to increase average booking value`);
        }

        // User behavior recommendations
        const repeatRate = data.retentionMetrics?.repeatBookingRate || 0;
        if (repeatRate < 30) {
            recommendations.push("Implement a loyalty program to increase repeat bookings beyond 35%");
        }

        // Field and coach recommendations
        if (data.topFieldsByFavorites?.length > 0) {
            recommendations.push(`Feature top-rated fields like "${data.topFieldsByFavorites[0].name}" in marketing campaigns`);
        }

        if (data.topCoachesByFavorites?.length > 0) {
            recommendations.push(`Promote top coaches like "${data.topCoachesByFavorites[0].name}" with featured profiles`);
        }

        // Add some general recommendations
        recommendations.push(
            "Optimize mobile booking experience for younger demographics",
            "Introduce family packages for weekend bookings",
            "Partner with equipment brands for cross-promotional opportunities",
            "Implement seasonal pricing adjustments based on demand patterns"
        );

        return recommendations.slice(0, 8); // Limit to 8 recommendations
    }

    private convertToPlatformAnalytics(parsedData: any, originalData: PlatformAnalyticsData): PlatformAnalytics {
        // Validate and clean the AI response
        const validatedData = this.validatePlatformAnalyticsResponse(parsedData, originalData);

        return {
            summary: validatedData.summary || {
                totalRevenue: originalData.revenueData?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0,
                totalBookings: originalData.bookingStats?.total || 0,
                totalUsers: originalData.userStats?.activeUsers || 0,
                averageRating: this.calculateAverageRatingFromData(originalData),
                growthRate: this.calculateGrowthRateFromData(originalData)
            },
            revenueAnalysis: {
                monthlyRevenue: Array.isArray(validatedData.revenueAnalysis?.monthlyRevenue)
                    ? validatedData.revenueAnalysis.monthlyRevenue
                    : this.generateEnhancedSimulatedPlatformAnalytics(originalData).revenueAnalysis.monthlyRevenue,
                revenueBySport: Array.isArray(validatedData.revenueAnalysis?.revenueBySport)
                    ? validatedData.revenueAnalysis.revenueBySport.map((item: any) => ({
                        sport: item.sport || 'Unknown',
                        revenue: Number(item.revenue) || 0,
                        percentage: Number(item.percentage) || 0
                    }))
                    : this.generateEnhancedSimulatedPlatformAnalytics(originalData).revenueAnalysis.revenueBySport,
                revenueByType: Array.isArray(validatedData.revenueAnalysis?.revenueByType)
                    ? validatedData.revenueAnalysis.revenueByType.map((item: any) => ({
                        type: this.validateRevenueType(item.type),
                        revenue: Number(item.revenue) || 0,
                        percentage: Number(item.percentage) || 0
                    }))
                    : this.generateEnhancedSimulatedPlatformAnalytics(originalData).revenueAnalysis.revenueByType,
                peakRevenuePeriods: Array.isArray(validatedData.revenueAnalysis?.peakRevenuePeriods)
                    ? validatedData.revenueAnalysis.peakRevenuePeriods
                    : ['Weekends', 'Evenings']
            },
            popularityAnalysis: {
                sportsPopularity: Array.isArray(validatedData.popularityAnalysis?.sportsPopularity)
                    ? validatedData.popularityAnalysis.sportsPopularity
                    : this.calculateSportsPopularityFromData(originalData).slice(0, 10),
                fieldPopularity: Array.isArray(validatedData.popularityAnalysis?.fieldPopularity)
                    ? validatedData.popularityAnalysis.fieldPopularity
                    : originalData.topFieldsByFavorites?.slice(0, 10).map(field => ({
                        fieldId: field.fieldId,
                        name: field.name,
                        bookings: 0,
                        favorites: field.favoritesCount || 0,
                        rating: field.rating || 0
                    })) || [],
                coachPopularity: Array.isArray(validatedData.popularityAnalysis?.coachPopularity)
                    ? validatedData.popularityAnalysis.coachPopularity
                    : originalData.topCoachesByFavorites?.slice(0, 10).map(coach => ({
                        coachId: coach.coachId,
                        name: coach.name,
                        bookings: 0,
                        favorites: coach.favoritesCount || 0,
                        rating: coach.rating || 0
                    })) || [],
                trendingSports: Array.isArray(validatedData.popularityAnalysis?.trendingSports)
                    ? validatedData.popularityAnalysis.trendingSports
                    : this.identifyTrendingSports(originalData)
            },
            userBehavior: validatedData.userBehavior || {
                bookingPatterns: originalData.bookingPatterns || {
                    peakBookingDays: ['Saturday', 'Sunday', 'Friday'],
                    peakBookingHours: ['18:00-20:00', '19:00-21:00', '14:00-16:00'],
                    averageBookingDuration: 2.5,
                    preferredSports: this.calculateSportsPopularityFromData(originalData).slice(0, 3).map(s => s.sport)
                },
                retentionMetrics: originalData.retentionMetrics || {
                    repeatBookingRate: 42.5,
                    favoriteToBookingConversion: 28.3,
                    userSatisfactionScore: 4.3
                }
            },
            recommendations: Array.isArray(validatedData.recommendations)
                ? validatedData.recommendations.slice(0, 8)
                : this.generateRecommendationsFromData(originalData)
        };
    }

    private validatePlatformAnalyticsResponse(parsedData: any, originalData: PlatformAnalyticsData): any {
        // Basic validation to ensure required fields exist
        const validated = { ...parsedData };

        if (!validated.summary) {
            validated.summary = {
                totalRevenue: originalData.revenueData?.reduce((sum, month) => sum + (month.revenue || 0), 0) || 0,
                totalBookings: originalData.bookingStats?.total || 0,
                totalUsers: originalData.userStats?.activeUsers || 0,
                averageRating: this.calculateAverageRatingFromData(originalData),
                growthRate: this.calculateGrowthRateFromData(originalData)
            };
        }

        if (!validated.revenueAnalysis) {
            validated.revenueAnalysis = {};
        }

        if (!validated.popularityAnalysis) {
            validated.popularityAnalysis = {};
        }

        if (!validated.userBehavior) {
            validated.userBehavior = {
                bookingPatterns: originalData.bookingPatterns,
                retentionMetrics: originalData.retentionMetrics
            };
        }

        if (!validated.recommendations || !Array.isArray(validated.recommendations)) {
            validated.recommendations = this.generateRecommendationsFromData(originalData);
        }

        return validated;
    }

    private validateRevenueType(type: any): 'field' | 'coach' | 'tournament' {
        if (typeof type === 'string') {
            const lowerType = type.toLowerCase();
            if (lowerType === 'field' || lowerType === 'coach' || lowerType === 'tournament') {
                return lowerType as 'field' | 'coach' | 'tournament';
            }
        }
        return 'field'; // Default value
    }

    async generateInsights(promptContext: string, stats: any): Promise<string> {
        if (!this.groq) {
            this.logger.warn('Groq API not initialized. Returning enhanced simulated insight.');
            return this.generateEnhancedInsight(stats);
        }

        try {
            const prompt = `
            You are a helpful data analyst for a sports booking platform.
            
            Analyze the following statistics for a ${promptContext} (ALL REAL DATA):
            
            ${JSON.stringify(stats, null, 2)}
            
            Provide a concise (1-2 sentences) strategic insight or recommendation to improve their performance.
            Focus on practical, actionable advice based on the actual numbers provided.
            Keep it very brief and to the point.
            `;

            this.logger.log(`Generating Groq AI insight for ${promptContext}...`);

            const chatCompletion = await this.groq.chat.completions.create({
                messages: [
                    {
                        role: "system",
                        content: "You are a data analyst specializing in sports business analytics. Provide concise, actionable insights based on real data."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                model: "llama-3.1-8b-instant",
                temperature: 0.7,
                max_completion_tokens: 150,
                top_p: 1,
                stream: false,
            });

            const insight = chatCompletion.choices[0]?.message?.content || "No insight generated.";
            return insight.trim();

        } catch (error) {
            this.logger.error('Failed to call Groq API:', {
                error: error.message,
                promptContext,
                stats: JSON.stringify(stats)
            });

            return this.generateEnhancedInsight(stats);
        }
    }

    private generateEnhancedInsight(stats: any): string {
        const rating = stats.averageRating || 0;
        const bookings = stats.totalBookings || 0;
        const favorites = stats.totalFavorites || 0;
        const revenue = stats.revenue || stats.totalRevenue || 0;
        const repeatRate = stats.repeatCustomerRate || stats.clientRetentionRate || 0;

        if (rating < 3.0) {
            return "Critical: Rating below 3.0 indicates serious service issues. Immediate customer feedback collection and service improvement needed.";
        } else if (rating < 3.5 && bookings < 10) {
            return "Low ratings combined with few bookings. Consider revising pricing, improving service quality, and running promotional campaigns.";
        } else if (repeatRate > 60 && rating > 4.0) {
            return "Excellent client retention and high ratings. Consider premium offerings and referral programs to leverage satisfied customers.";
        } else if (favorites > 50 && bookings < favorites) {
            return "High popularity (favorites) but lower booking conversion. Consider targeted promotions to convert favorites into bookings.";
        } else if (revenue > 10000 && bookings > 100) {
            return "Strong revenue performance. Focus on increasing average transaction value through upselling and package deals.";
        }

        return "Performance metrics are within expected ranges. Focus on incremental improvements through customer feedback and service optimization.";
    }
}