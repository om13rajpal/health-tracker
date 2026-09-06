import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import type { Request, Response, NextFunction } from "express";

export type SessionData = {
  loggedIn?: boolean;
};

function sessionOptions(): SessionOptions {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("SESSION_SECRET must be set and at least 32 characters");
  }
  // In production the web app (Vercel) and this API (Render) are on different
  // registrable domains, so every authenticated request is a cross-site
  // subresource fetch. SameSite=Lax cookies are withheld on those, which would
  // 401 every call after a successful login. SameSite=None requires Secure,
  // and the browser only honours it alongside the specific CORS origin +
  // credentials:true that app.ts already sets.
  const isProduction = process.env.NODE_ENV === "production";
  return {
    cookieName: "health-tracker-session",
    password: secret,
    cookieOptions: {
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      httpOnly: true,
    },
  };
}

export async function getSession(req: Request, res: Response): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(req, res, sessionOptions());
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const session = await getSession(req, res);
  if (!session.loggedIn) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}
