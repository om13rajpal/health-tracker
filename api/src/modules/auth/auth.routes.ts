import { Router } from "express";
import rateLimit from "express-rate-limit";
import { getSession, requireAuth } from "../../lib/session.js";
import { constantTimeEquals } from "../../lib/crypto.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post("/login", loginLimiter, async (req, res) => {
  const { password } = req.body as { password?: string };

  if (!constantTimeEquals(password ?? "", process.env.APP_PASSWORD ?? "")) {
    res.status(401).json({ error: "Invalid password" });
    return;
  }

  const session = await getSession(req, res);
  session.loggedIn = true;
  await session.save();
  res.json({ loggedIn: true });
});

authRouter.post("/logout", async (req, res) => {
  const session = await getSession(req, res);
  session.destroy();
  res.json({ loggedIn: false });
});

authRouter.get("/whoami", requireAuth, (_req, res) => {
  res.json({ loggedIn: true });
});
