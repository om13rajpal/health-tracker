import { Schema, model } from "mongoose";

const coachNoteSchema = new Schema({
  weekOf: { type: String, required: true },
  digest: { type: Schema.Types.Mixed, required: true },
  llmModel: { type: String },
  summary: { type: String, required: true },
  suggestions: { type: [String], default: [] },
  source: { type: String, required: true, enum: ["vendor_scheduled_task", "mcp_session"] },
  createdAt: { type: Date, default: Date.now },
});

// listCoachNotes() reads `find({}).sort({ createdAt: -1 }).limit(n)`, which
// without this is a collection scan followed by an in-memory sort.
coachNoteSchema.index({ createdAt: -1 });

export const CoachNote = model("CoachNote", coachNoteSchema);
