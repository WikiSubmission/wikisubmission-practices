import { FastifyReply, FastifyRequest } from "fastify";
import { WRoute } from "../types/w-route";

export default function route(): WRoute {
    return {
        url: "*",
        method: "GET",
        handler: async (request: FastifyRequest, reply: FastifyReply) => {
            return reply.code(404).send({
                status: "ok",
                timestamp: new Date().toISOString()
            });
        },
    };
} 