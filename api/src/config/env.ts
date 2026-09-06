export type Env = {
  port: number;
  mongoUri: string;
  sessionSecret: string;
  appPassword: string;
  mcpAccessToken: string;
  webOrigin: string;
  geminiApiKey: string;
};

export function loadEnv(): Env {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required env var: ${name}`);
    return value;
  };

  return {
    port: Number(process.env.PORT ?? 4000),
    mongoUri: required("MONGO_URI"),
    // iron-session rejects anything shorter, and it would otherwise only throw
    // on the first authenticated request rather than at boot.
    sessionSecret: (() => {
      const value = required("SESSION_SECRET");
      if (value.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters");
      return value;
    })(),
    appPassword: required("APP_PASSWORD"),
    mcpAccessToken: required("MCP_ACCESS_TOKEN"),
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:3000",
    geminiApiKey: required("GEMINI_API_KEY"),
  };
}
