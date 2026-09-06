import { Exercise } from "../../models/Exercise.js";
import { ProgramTemplate } from "../../models/ProgramTemplate.js";

export async function listExercises(equipment?: string) {
  const filter = equipment ? { equipment } : {};
  return Exercise.find(filter).lean();
}

export async function listPrograms() {
  return ProgramTemplate.find({}).lean();
}
