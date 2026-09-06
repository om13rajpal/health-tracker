import type { Request, Response, NextFunction } from "express";
import { constantTimeEquals } from "./crypto.js";

export function requireBearerToken(expectedToken: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";

    if (!constantTimeEquals(token, expectedToken)) {
      res.status(401).json({ error: "Invalid or missing bearer token" });
      return;
    }

    next();
  };
}
