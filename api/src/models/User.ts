import { Schema, model } from "mongoose";

const userSchema = new Schema({
  createdAt: { type: Date, default: Date.now },
});

export const User = model("User", userSchema);
