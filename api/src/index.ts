import "dotenv/config";
import { createApp } from "./app.js";
import { loadEnv } from "./config/env.js";
import { connectDb } from "./lib/db.js";
import { scheduleNightlyRollup } from "./jobs/scheduler.js";

const env = loadEnv();

await connectDb(env.mongoUri);
scheduleNightlyRollup();

const app = createApp();
app.listen(env.port, () => {
  console.log(`api listening on port ${env.port}`);
});
