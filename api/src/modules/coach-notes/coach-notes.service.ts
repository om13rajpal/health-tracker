import { CoachNote } from "../../models/CoachNote.js";

const DEFAULT_LIMIT = 10;

export async function listCoachNotes(limit: number = DEFAULT_LIMIT) {
  return CoachNote.find({}).sort({ createdAt: -1 }).limit(limit).lean();
}
