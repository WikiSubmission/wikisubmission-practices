import dotenv from "dotenv";
import { Server } from "./server";

(async () => {
    try {
        process.env.TZ = "UTC";
        
        // [Environment]
        dotenv.config();
        Server.instance.log(
            `NODE_ENV: ${process.env.NODE_ENV || 'development (default)'}`,
        );
        if (process.env.GOOGLE_API_KEY) {
            Server.instance.log(`Environment variables loaded (GOOGLE_API_KEY found)\n`);
        } else {
            Server.instance.error(
                `Missing environment variables (GOOGLE_API_KEY)`,
                true,
            );
        }

        // [Start server]
        await Server.instance.start();
    } catch (error) {
        console.error(error);
    }
})();