import { WRoute } from "../types/w-route";
import { PrayerTimes, CalculationMethod } from "adhan";
import { getQuery } from "../utils/get-query";
import { find } from "geo-tz";
import { toZonedTime, format } from "date-fns-tz";
import { geocodeWithCache } from "../utils/geocoding-cache";

export default function route(): WRoute {
    return {
        url: "/prayer-times/:q?",
        method: "GET",
        cache: {
            duration: 45,
            durationType: "seconds"
        },
        handler: async (request, reply) => {
            try {
                // Extract location from URL path (after /prayer-times/) or from query parameters
                const pathLocation = decodeURIComponent(request.url.replace(/^\/prayer-times\//, "").split("?")[0]);
                const query = pathLocation || getQuery(request.query, request.params);

                if (!query) {
                    return await reply.code(400).send({
                        error: "No location provided",
                        description: "Please provide a location either as a path parameter (/prayer-times/New York) or as a query parameter (?q=New York)",
                    });
                }

                try {
                    const geocoderResult = await geocodeWithCache(query);

                    if (geocoderResult.length === 0) {
                        return await reply.code(400).send({
                            error: "Location Not Found",
                            description: `Could not find a location matching "${query}". Try being more specific.`,
                        });
                    }

                    const resolvedLocation = geocoderResult[0];
                    const {
                        longitude,
                        latitude,
                        city,
                        country,
                        state,
                        administrativeLevels,
                        countryCode,
                        formattedAddress,
                    } = resolvedLocation;

                    if (!latitude || !longitude) {
                        return await reply.code(400).send({
                            error: "Coordinates Not Found",
                            description: `Could not resolve coordinates for "${query}". Try being more specific.`,
                        });
                    }

                    const timezoneIdQuery = find(latitude, longitude);

                    if (!timezoneIdQuery || timezoneIdQuery.length === 0) {
                        return await reply.code(400).send({
                            error: "Timezone Information Not Found",
                            description: `Could not resolve timezone information for "${query}". Try another keyword or location.`,
                        });
                    }

                    const resolvedTimezoneId = timezoneIdQuery[0];
                    const now = new Date();

                    // Get the current time in the local timezone for accurate calculations
                    const localNow = toZonedTime(now, resolvedTimezoneId);
                    const timeCalculator = new TimeCalculator(now, localNow, resolvedTimezoneId);

                    // Use localNow for prayer time calculations to ensure same date
                    const prayerTimes = new PrayerTimes(
                        { latitude, longitude },
                        localNow,
                        CalculationMethod.Karachi()
                    );

                    // If requested, adjust Asr prayer time.
                    const { asr_adjustment } = request.query as {
                        asr_adjustment: string | undefined;
                    };
                    if (asr_adjustment === "true") {
                        prayerTimes.asr = new Date(
                            (prayerTimes.dhuhr.getTime() + prayerTimes.sunset.getTime()) / 2,
                        );
                    }

                    const prayerTimesUTC = {
                        fajr: prayerTimes.fajr,
                        dhuhr: prayerTimes.dhuhr,
                        asr: prayerTimes.asr,
                        maghrib: prayerTimes.maghrib,
                        isha: prayerTimes.isha,
                        sunrise: prayerTimes.sunrise,
                        sunset: prayerTimes.sunset,
                    };

                    const prayerTimesLocal = Object.entries(prayerTimesUTC).reduce(
                        (acc, [key, value]) => {
                            acc[key as keyof typeof prayerTimesUTC] =
                                timeCalculator.formatTime(value);
                            return acc;
                        },
                        {} as Record<keyof typeof prayerTimesUTC, string>,
                    );

                    const prayerTimeDifferences = Object.entries(prayerTimesUTC).reduce(
                        (acc, [key, value]) => {
                            acc[`time_to_${key}` as keyof typeof acc] =
                                timeCalculator.computeTimeDifference(value);
                            return acc;
                        },
                        {} as Record<string, string>,
                    );

                    let currentPrayer = prayerTimes.currentPrayer();
                    let upcomingPrayer = prayerTimes.nextPrayer();

                    // Handle "none" cases by determining current prayer based on actual time comparison
                    if (currentPrayer === "none") {
                        currentPrayer = determineCurrentPrayer(localNow, prayerTimesUTC, resolvedTimezoneId);
                    }

                    if (upcomingPrayer === "none") {
                        upcomingPrayer = determineUpcomingPrayer(localNow, prayerTimesUTC, resolvedTimezoneId);
                    }

                    const currentPrayerTimeElapsed = timeCalculator.computeTimeElapsed(
                        prayerTimesUTC[currentPrayer as keyof typeof prayerTimesUTC],
                    );
                    const upcomingPrayerTimeLeft =
                        prayerTimeDifferences[`time_to_${upcomingPrayer}`];

                    const { highlight } = request.query as { highlight?: string };

                    const statusString = `It's currently ${capitalize(
                        currentPrayer,
                        highlight === "true",
                    )}. ${capitalize(upcomingPrayer, highlight === "true")} in ${prayerTimeDifferences[`time_to_${upcomingPrayer}`]
                        }.`;

                    const response = {
                        status_string: statusString,
                        location_string: formattedAddress || query,
                        country: country || "",
                        country_code: countryCode || "",
                        city: city || "",
                        region:
                            administrativeLevels?.level1short ||
                            state ||
                            administrativeLevels?.level1long ||
                            "",
                        local_time: timeCalculator.getLocalTime(),
                        local_timezone: timeCalculator.getLocalTimezoneName(),
                        local_timezone_id: resolvedTimezoneId,
                        coordinates: { latitude, longitude },
                        times: prayerTimesLocal,
                        times_in_utc: prayerTimesUTC,
                        times_left: {
                            fajr: prayerTimeDifferences.time_to_fajr,
                            dhuhr: prayerTimeDifferences.time_to_dhuhr,
                            asr: prayerTimeDifferences.time_to_asr,
                            maghrib: prayerTimeDifferences.time_to_maghrib,
                            isha: prayerTimeDifferences.time_to_isha,
                            sunrise: prayerTimeDifferences.time_to_sunrise,
                            sunset: prayerTimeDifferences.time_to_sunset,
                        },
                        current_prayer: currentPrayer,
                        upcoming_prayer: upcomingPrayer,
                        current_prayer_time_elapsed: currentPrayerTimeElapsed,
                        upcoming_prayer_time_left: upcomingPrayerTimeLeft,
                    };

                    return await reply.code(200).send(response);

                } catch (error) {
                    if (error instanceof Error && error.message.includes("geocoding failed")) {
                        return await reply.code(400).send({
                            error: "Location Not Found",
                            description: `Could not find a location matching "${query}". Please try a different location or check your spelling.`,
                        });
                    }

                    return await reply.code(500).send({
                        error: "Internal Server Error",
                        message: error instanceof Error ? error.message : "Unknown error"
                    });
                }

            } catch (error) {
                return reply.code(500).send({
                    error: "Internal Server Error",
                    message: error instanceof Error ? error.message : "Unknown error"
                });
            }
        }
    };
}

function capitalize(
    input: string | undefined | null,
    applyMarkdownHighlight: boolean,
): string {
    if (!input) return "";
    return applyMarkdownHighlight
        ? `**${input.charAt(0).toUpperCase() + input.slice(1)}**`
        : input.charAt(0).toUpperCase() + input.slice(1);
}

class TimeCalculator {
    private now: Date;
    private localNow: Date;
    private timezoneId: string;

    constructor(now: Date, localNow: Date, timezoneId: string) {
        this.now = now;
        this.localNow = localNow;
        this.timezoneId = timezoneId;
    }

    formatTime(time: Date | undefined): string {
        if (!time) return "N/A";
        const zonedTime = toZonedTime(time, this.timezoneId);
        return format(zonedTime, "h:mm a", { timeZone: this.timezoneId });
    }

    computeTimeDifference(prayerTime: Date | undefined): string {
        if (!prayerTime) return "N/A";

        // Convert prayer time to local timezone for accurate comparison
        const localPrayerTime = toZonedTime(prayerTime, this.timezoneId);
        let diffMs = localPrayerTime.getTime() - this.localNow.getTime();

        // If the prayer time has passed today, calculate time until next occurrence (tomorrow)
        if (diffMs < 0) {
            diffMs += 24 * 60 * 60 * 1000; // Add 24 hours
        }

        return this.formatTimeDifference(diffMs);
    }

    computeTimeElapsed(prayerTime: Date | undefined): string {
        if (!prayerTime) return "N/A";

        // Convert prayer time to local timezone for accurate comparison
        const localPrayerTime = toZonedTime(prayerTime, this.timezoneId);
        const diffMs = this.localNow.getTime() - localPrayerTime.getTime();

        // Return absolute value to avoid negative times
        return this.formatTimeDifference(Math.abs(diffMs));
    }

    private formatTimeDifference(diffMs: number): string {
        // Ensure we're working with a positive number
        const absDiffMs = Math.abs(diffMs);

        const diffHours = Math.floor(absDiffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((absDiffMs % (1000 * 60 * 60)) / (1000 * 60));

        // Format consistently: always show hours and minutes
        if (diffHours === 0) {
            return `${diffMinutes}m`;
        }

        return `${diffHours}h ${diffMinutes}m`;
    }

    getLocalTimezoneName(): string {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone: this.timezoneId,
            timeZoneName: "long",
        });
        const parts = formatter.formatToParts(this.now);
        return (
            parts.find((part) => part.type === "timeZoneName")?.value ||
            "Unknown Timezone"
        );
    }

    getLocalTime(): string {
        return format(this.localNow, "h:mm a", { timeZone: this.timezoneId });
    }
}

function determineCurrentPrayer(
    localNow: Date,
    prayerTimes: { fajr: Date; dhuhr: Date; asr: Date; maghrib: Date; isha: Date; sunrise: Date; sunset: Date },
    timezoneId: string
): "fajr" | "dhuhr" | "asr" | "maghrib" | "isha" {
    // Convert prayer times to local timezone for accurate comparison
    const localFajr = toZonedTime(prayerTimes.fajr, timezoneId);
    const localDhuhr = toZonedTime(prayerTimes.dhuhr, timezoneId);
    const localAsr = toZonedTime(prayerTimes.asr, timezoneId);
    const localMaghrib = toZonedTime(prayerTimes.maghrib, timezoneId);
    const localIsha = toZonedTime(prayerTimes.isha, timezoneId);

    const currentTime = localNow.getTime();

    // Determine current prayer based on time ranges
    if (currentTime >= localFajr.getTime() && currentTime < localDhuhr.getTime()) {
        return "fajr";
    } else if (currentTime >= localDhuhr.getTime() && currentTime < localAsr.getTime()) {
        return "dhuhr";
    } else if (currentTime >= localAsr.getTime() && currentTime < localMaghrib.getTime()) {
        return "asr";
    } else if (currentTime >= localMaghrib.getTime() && currentTime < localIsha.getTime()) {
        return "maghrib";
    } else {
        // Before Fajr or after Isha - this is the Isha period
        return "isha";
    }
}

function determineUpcomingPrayer(
    localNow: Date,
    prayerTimes: { fajr: Date; dhuhr: Date; asr: Date; maghrib: Date; isha: Date; sunrise: Date; sunset: Date },
    timezoneId: string
): "fajr" | "dhuhr" | "asr" | "maghrib" | "isha" {
    // Convert prayer times to local timezone for accurate comparison
    const localFajr = toZonedTime(prayerTimes.fajr, timezoneId);
    const localDhuhr = toZonedTime(prayerTimes.dhuhr, timezoneId);
    const localAsr = toZonedTime(prayerTimes.asr, timezoneId);
    const localMaghrib = toZonedTime(prayerTimes.maghrib, timezoneId);
    const localIsha = toZonedTime(prayerTimes.isha, timezoneId);

    const currentTime = localNow.getTime();

    // Determine upcoming prayer based on current time
    if (currentTime < localFajr.getTime()) {
        return "fajr";
    } else if (currentTime < localDhuhr.getTime()) {
        return "dhuhr";
    } else if (currentTime < localAsr.getTime()) {
        return "asr";
    } else if (currentTime < localMaghrib.getTime()) {
        return "maghrib";
    } else if (currentTime < localIsha.getTime()) {
        return "isha";
    } else {
        // After Isha - next prayer is Fajr (tomorrow)
        return "fajr";
    }
}
