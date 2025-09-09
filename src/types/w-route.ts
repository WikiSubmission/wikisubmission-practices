import { RouteOptions } from "fastify";

export interface WRoute extends RouteOptions {
    cache?: {
        duration: number;
        durationType: "seconds" | "minutes" | "hours" | "days";
    }
}