import { WRoute } from "../types/w-route";
import { PrayerTimes, CalculationMethod } from "adhan";
import { getQuery } from "../utils/get-query";
import { getEnv } from "../utils/get-env";
import { find } from "geo-tz";
import { toZonedTime, format } from "date-fns-tz";
import NodeGeocoder from "node-geocoder";

/**
 * Returns the actual file requested, on a best-effort basis as URL syntax may slightly vary.
 * Proxies through Supabase's CDN.
 */
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

                const GOOGLE_API_KEY = await getEnv("GOOGLE_API_KEY");
                const geocoder = NodeGeocoder({
                    provider: "google",
                    apiKey: GOOGLE_API_KEY,
                });

                try {
                    const geocoderResult = await geocoder.geocode(query);

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
                    const timeCalculator = new TimeCalculator(now, resolvedTimezoneId);

                    const prayerTimes = new PrayerTimes(
                        { latitude, longitude },
                        now,
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

                    // Adjust "none" current / next prayer case. None is technically still Isha.
                    if (currentPrayer === "none") {
                        currentPrayer = "isha";
                    }

                    if (upcomingPrayer === "none") {
                        upcomingPrayer = "fajr";
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
    private timezoneId: string;

    constructor(now: Date, timezoneId: string) {
        this.now = now;
        this.timezoneId = timezoneId;
    }

    formatTime(time: Date | undefined): string {
        if (!time) return "N/A";
        const zonedTime = toZonedTime(time, this.timezoneId);
        return format(zonedTime, "h:mm a", { timeZone: this.timezoneId });
    }

    computeTimeDifference(prayerTime: Date | undefined): string {
        if (!prayerTime) return "N/A";
        let diffMs = prayerTime.getTime() - this.now.getTime();
        if (diffMs < 0) {
            diffMs += 24 * 60 * 60 * 1000; // Add 24 hours if prayer time has passed
        }
        return this.formatTimeDifference(diffMs);
    }

    computeTimeElapsed(prayerTime: Date | undefined): string {
        if (!prayerTime) return "N/A";
        const diffMs = this.now.getTime() - prayerTime.getTime();
        return this.formatTimeDifference(diffMs);
    }

    private formatTimeDifference(diffMs: number): string {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${diffHours}h ${diffMinutes}m`.replace(/-/g, "").replace("0h ", "");
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
        const zonedTime = toZonedTime(this.now, this.timezoneId);
        return format(zonedTime, "h:mm a", { timeZone: this.timezoneId });
    }
}
