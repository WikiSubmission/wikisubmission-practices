import { WRoute } from "../types/w-route";
import { PrayerTimes, CalculationMethod, Coordinates } from "adhan";
import { getQuery } from "../utils/get-query";
import { find } from "geo-tz";
import { toZonedTime, format } from "date-fns-tz";
import { geocodeWithCache } from "../utils/geocoding-cache";
import * as Astronomy from "astronomy-engine";

export default function route(): WRoute {
    return {
        url: "/ramadan/:q?",
        method: "GET",
        handler: async (request, reply) => {
            try {
                // 1. Extract location and year
                const pathLocation = decodeURIComponent(request.url.replace(/^\/ramadan\//, "").split("?")[0]);
                const params = request.query as { year?: string };
                // Parsing logic to handle non-specific requests
                const query = pathLocation || getQuery(request.query, request.params);
                const year = params.year ? parseInt(params.year) : new Date().getFullYear();

                if (!query || query.length <= 2) {
                    return await reply.code(400).send({
                        error: "No location provided",
                        description: "Please provide a location either as a path parameter (/ramadan/New York) or as a query parameter (?q=New York)",
                    });
                }

                // 2. Geocode
                const geocoderResult = await geocodeWithCache(query);
                if (geocoderResult.length === 0) {
                    return await reply.code(400).send({
                        error: "Location Not Found",
                        description: `Could not find a location matching "${query}".`,
                    });
                }

                const resolvedLocation = geocoderResult[0];
                const { latitude, longitude, city, country, formattedAddress } = resolvedLocation;

                if (!latitude || !longitude) {
                    return await reply.code(400).send({
                        error: "Coordinates Not Found",
                        description: `Could not resolve coordinates for "${query}".`,
                    });
                }

                // 3. Timezone
                const timezoneIdQuery = find(latitude, longitude);
                const timezoneId = timezoneIdQuery?.[0]; // Fallback if necessary

                if (!timezoneId) {
                    return await reply.code(400).send({
                        error: "Timezone Not Found",
                        description: "Could not determine timezone for the location.",
                    });
                }

                // 4. Calculate Ramadan Dates
                // Find approximate start of Ramadan to narrow search for New Moon
                const ramadanDetails = calculateRamadanDates(year, latitude, longitude, timezoneId);

                if (!ramadanDetails) {
                    return await reply.code(500).send({
                        error: "Calculation Error",
                        description: "Could not calculate Ramadan dates.",
                    });
                }

                const {
                    firstFastingDay,
                    lastFastingDay,
                    nightOfDestiny,
                    startLast10Nights,
                    startNewMoon,
                    endNewMoon,
                    startSunset,
                    endSunset
                } = ramadanDetails;

                // 5. Generate Schedule
                const { schedule, averageDuration } = generateSchedule(firstFastingDay, lastFastingDay, latitude, longitude, timezoneId);

                // Calculate current day
                // Get local time now
                const now = new Date();
                const localNow = toZonedTime(now, timezoneId);
                const localFirstFastingDay = toZonedTime(firstFastingDay, timezoneId);
                const localLastFastingDay = toZonedTime(lastFastingDay, timezoneId);

                // Normalize to midnight for day comparison
                const localNowMidnight = new Date(localNow);
                localNowMidnight.setHours(0, 0, 0, 0);

                const startMidnight = new Date(localFirstFastingDay);
                startMidnight.setHours(0, 0, 0, 0);

                const endMidnight = new Date(localLastFastingDay);
                endMidnight.setHours(0, 0, 0, 0);

                let currentDay = 0;
                let statusString = "";
                if (localNowMidnight.getTime() >= startMidnight.getTime() && localNowMidnight.getTime() <= endMidnight.getTime()) {
                    const diffTime = localNowMidnight.getTime() - startMidnight.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    currentDay = diffDays + 1;
                    statusString = `Today is Day ${currentDay} of Ramadan!`;
                } else if (localNowMidnight.getTime() < startMidnight.getTime()) {
                    const diffTime = startMidnight.getTime() - localNowMidnight.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    statusString = `Ramadan starts in ${diffDays} day${diffDays === 1 ? "" : "s"} (${format(localFirstFastingDay, "MMMM do", { timeZone: timezoneId })}), and ends on ${format(localLastFastingDay, "MMMM do", { timeZone: timezoneId })}.`;
                } else {
                    const diffTime = localNowMidnight.getTime() - endMidnight.getTime();
                    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
                    currentDay = -diffDays;
                    statusString = `Ramadan ended ${diffDays} day${diffDays === 1 ? "" : "s"} ago.`;
                }

                // 6. Format Response
                const response = {
                    query: decodeURIComponent(query),
                    year: `${year}`,
                    current_day: currentDay,
                    status_string: statusString,
                    location_string: formattedAddress || query,
                    average_fasting_duration: averageDuration,
                    first_fasting_day: formatDate(firstFastingDay, timezoneId),
                    last_fasting_day: formatDate(lastFastingDay, timezoneId),
                    night_of_destiny: formatDate(nightOfDestiny, timezoneId),
                    begin_last_10_nights: formatDate(startLast10Nights, timezoneId),
                    moon_data: {
                        start: {
                            new_moon_utc: startNewMoon.toISOString(),
                            new_moon_local: format(toZonedTime(startNewMoon, timezoneId), "yyyy-MM-dd h:mm a", { timeZone: timezoneId }),
                            sunset_local: format(toZonedTime(startSunset, timezoneId), "yyyy-MM-dd h:mm a", { timeZone: timezoneId }),
                        },
                        end: {
                            new_moon_utc: endNewMoon.toISOString(),
                            new_moon_local: format(toZonedTime(endNewMoon, timezoneId), "yyyy-MM-dd h:mm a", { timeZone: timezoneId }),
                            sunset_local: format(toZonedTime(endSunset, timezoneId), "yyyy-MM-dd h:mm a", { timeZone: timezoneId }), // Sunset of the day we checked
                        }
                    },
                    schedule
                };

                return await reply.code(200).send(response);

            } catch (error) {
                console.error(error);
                return await reply.code(500).send({
                    error: "Internal Server Error",
                    message: error instanceof Error ? error.message : "Unknown error"
                });
            }
        }
    };
}

function calculateRamadanDates(year: number, lat: number, lng: number, timezoneId: string) {
    // 1. Estimate Ramadan Start (Month 9)
    // Ramadan shifts backwards by ~11 days each solar year.
    // Anchor: Ramadan 2025 started approx Feb 28 / March 1. 2026 approx Feb 17.
    // We calculate a rough "search center" date.

    // Feb 28 is the 59th day of the year (non-leap).
    // shift = (year - 2025) * 11
    // Center Date ~= Feb 28 - shift days.

    // robust estimation:
    const approxDaysShift = (year - 2025) * 11;
    // Base date: Feb 28 of the given year.
    // Note: We construct the date in the TARGET year.
    const searchCenterDate = new Date(year, 1, 28); // Month is 0-indexed (1 = Feb)
    searchCenterDate.setDate(searchCenterDate.getDate() - approxDaysShift);

    // Search window: +/- 20 days around the estimated center.
    const searchStart = new Date(searchCenterDate);
    searchStart.setDate(searchStart.getDate() - 20);

    // Find Next New Moon from searchStart
    const startNewMoonDetails = Astronomy.SearchMoonPhase(0, searchStart, 40);
    if (!startNewMoonDetails) return null;

    const startNewMoonDate = startNewMoonDetails.date; // Javascript Date (UTC)
    const localStartNewMoon = toZonedTime(startNewMoonDate, timezoneId);

    // Find sunset on the same local day as New Moon
    // Search from 18 hours before New Moon (safe anchor for prior sunset or same day sunset search)
    const searchFromStart = new Date(startNewMoonDate.getTime() - 18 * 3600 * 1000);
    const observer = new Astronomy.Observer(lat, lng, 0);

    let startSunsetEvent = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, searchFromStart, 30);
    let startSunset = startSunsetEvent ? startSunsetEvent.date : null;

    if (startSunset) {
        // Iterate until we find the sunset on the same local day
        while (startSunset) {
            const localSunset = toZonedTime(startSunset, timezoneId);
            if (localSunset.getDate() === localStartNewMoon.getDate()) {
                break;
            }
            if (localSunset > localStartNewMoon) {
                break;
            }
            // Found sunset is earlier, search next.
            startSunsetEvent = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, new Date(startSunset.getTime() + 60000), 1);
            startSunset = startSunsetEvent ? startSunsetEvent.date : null;
        }
    }

    if (!startSunset) {
        const adhanParams = CalculationMethod.Karachi();
        const prayerTimes = new PrayerTimes(new Coordinates(lat, lng), startNewMoonDate, adhanParams);
        startSunset = prayerTimes.sunset;
    }

    let firstFastingDay: Date;

    if (startNewMoonDate.getTime() < startSunset.getTime()) {
        firstFastingDay = addDays(startNewMoonDate, 1);
    } else {
        firstFastingDay = addDays(startNewMoonDate, 2);
    }

    // End of Ramadan
    const endSearchStart = new Date(startNewMoonDate.getTime() + 25 * 86400 * 1000);
    const endNewMoonDetails = Astronomy.SearchMoonPhase(0, endSearchStart, 10);
    if (!endNewMoonDetails) return null;

    const endNewMoonDate = endNewMoonDetails.date;
    const localEndNewMoon = toZonedTime(endNewMoonDate, timezoneId);

    // Find sunset on the day of End New Moon
    const searchFromEnd = new Date(endNewMoonDate.getTime() - 18 * 3600 * 1000);
    let endSunsetEvent = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, searchFromEnd, 1);
    let endSunset = endSunsetEvent ? endSunsetEvent.date : null;

    if (endSunset) {
        while (endSunset) {
            const localSunset = toZonedTime(endSunset, timezoneId);
            if (localSunset.getDate() === localEndNewMoon.getDate()) {
                break;
            }
            endSunsetEvent = Astronomy.SearchRiseSet(Astronomy.Body.Sun, observer, -1, new Date(endSunset.getTime() + 60000), 1);
            endSunset = endSunsetEvent ? endSunsetEvent.date : null;
        }
    }

    if (!endSunset) {
        const adhanParams = CalculationMethod.Karachi();
        const prayerTimes = new PrayerTimes(new Coordinates(lat, lng), endNewMoonDate, adhanParams);
        endSunset = prayerTimes.sunset;
    }

    let lastFastingDay: Date;

    if (endNewMoonDate.getTime() < endSunset.getTime()) {
        lastFastingDay = endNewMoonDate;
    } else {
        lastFastingDay = addDays(endNewMoonDate, 1);
    }

    // Night of Destiny: Sunset of the 26th day of fasting.
    const day26 = addDays(firstFastingDay, 25);
    const nightOfDestiny = day26;

    // Last 10 nights: Starts 10 days before the last day.
    const startLast10Nights = addDays(lastFastingDay, -10);

    return {
        firstFastingDay,
        lastFastingDay,
        nightOfDestiny,
        startLast10Nights,
        startNewMoon: startNewMoonDate,
        endNewMoon: endNewMoonDate,
        startSunset,
        endSunset
    };
}

function generateSchedule(start: Date, end: Date, lat: number, lng: number, timezoneId: string) {
    const schedule = [];
    let totalDurationMs = 0;

    // We loop from day 0 to day N
    const totalDays = Math.round((end.getTime() - start.getTime()) / (86400 * 1000)) + 1;

    for (let i = 0; i < totalDays; i++) {
        const date = addDays(start, i);

        // Use Adhan for prayer times
        const params = CalculationMethod.Karachi();

        const prayerTimes = new PrayerTimes(new Coordinates(lat, lng), date, params);

        const formatTime = (d: Date) => format(toZonedTime(d, timezoneId), "h:mm a", { timeZone: timezoneId });

        const durationMs = prayerTimes.maghrib.getTime() - prayerTimes.fajr.getTime();
        totalDurationMs += durationMs;

        schedule.push({
            day_number: i + 1,
            day: format(toZonedTime(date, timezoneId), "EEE MMM d", { timeZone: timezoneId }),
            dawn: formatTime(prayerTimes.fajr),
            sunrise: formatTime(prayerTimes.sunrise),
            noon: formatTime(prayerTimes.dhuhr),
            afternoon: formatTime(prayerTimes.asr),
            sunset: formatTime(prayerTimes.maghrib),
            night: formatTime(prayerTimes.isha),
            fast_duration: formatDuration(durationMs)
        });
    }

    const averageDurationMs = totalDurationMs / totalDays;
    const averageDuration = formatDuration(averageDurationMs);

    return { schedule, averageDuration };
}

function formatDuration(ms: number): string {
    const totalMinutes = Math.round(ms / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const mins = totalMinutes % 60;
    return `${hours}h ${mins}m`;
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatDate(date: Date, timezoneId: string): string {
    return format(toZonedTime(date, timezoneId), "PPPP", { timeZone: timezoneId });
}
