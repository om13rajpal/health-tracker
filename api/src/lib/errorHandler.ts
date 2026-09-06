import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";

export const jsonErrorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Malformed JSON bodies surface as a SyntaxError thrown by express.json().
  if (err instanceof SyntaxError && "body" in err) {
    res.status(400).json({ error: "Malformed JSON body" });
    return;
  }

  if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
    res.status(400).json({ error: "Invalid data", details: err.message });
    return;
  }

  // Never echo an arbitrary error's message/stack to the client — log it
  // server-side for debugging and return a generic message instead.
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
};
