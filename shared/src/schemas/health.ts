import { z } from "zod";

// Kept in exact sync with ios/HealthBridge/HealthKit/HealthMetric.swift's raw
// values by hand — Swift and TypeScript can't share a single source file, so
// any addition/removal there must be mirrored here too.
export const HealthMetricSchema = z.enum([
  "heart_rate",
  "steps",
  "active_energy",
  "weight",
  "vo2max",
  "distance",
  "flights_climbed",
  "resting_heart_rate",
  "walking_heart_rate",
  "heart_rate_variability",
  "respiratory_rate",
  "blood_oxygen",
  "body_fat_percentage",
  "bmi",
  "basal_energy",
  "exercise_minutes",
  "height",
  "lean_body_mass",
  "waist_circumference",
  "body_temperature",
  "walking_speed",
  "walking_step_length",
  "walking_asymmetry",
  "walking_double_support",
  "stair_ascent_speed",
  "stair_descent_speed",
  "six_minute_walk_distance",
  "walking_steadiness",
  "running_speed",
  "running_power",
  "running_stride_length",
  "running_vertical_oscillation",
  "running_ground_contact_time",
  "cycling_speed",
  "cycling_power",
  "cycling_cadence",
  "cycling_ftp",
  "distance_cycling",
  "distance_swimming",
  "distance_snow_sports",
  "distance_wheelchair",
  "swimming_stroke_count",
  "push_count",
  "blood_pressure_systolic",
  "blood_pressure_diastolic",
  "blood_glucose",
  "electrodermal_activity",
  "fev1",
  "forced_vital_capacity",
  "peak_expiratory_flow",
  "peripheral_perfusion_index",
  "alcoholic_beverages",
  "blood_alcohol_content",
  "inhaler_usage",
  "times_fallen",
  "environmental_audio_exposure",
  "headphone_audio_exposure",
  "uv_exposure",
  "time_in_daylight",
  "water_temperature",
  "underwater_depth",
  "sleeping_wrist_temperature",
  "physical_effort",
]);
export type HealthMetric = z.infer<typeof HealthMetricSchema>;

export const HealthEventPayloadSchema = z.object({
  source: z.string().min(1),
  metric: HealthMetricSchema,
  // { offset: true } accepts numeric-offset ISO timestamps (e.g. "...+05:30"),
  // not only UTC "Z" — the iOS bridge app is not guaranteed to pre-normalize to UTC.
  timestamp: z.string().datetime({ offset: true }),
  value: z.number(),
  unit: z.string().optional(),
});
export type HealthEventPayload = z.infer<typeof HealthEventPayloadSchema>;

// HKWorkout has a fundamentally different shape than a quantity sample (no
// single scalar value+unit), so it gets its own payload/endpoint rather than
// being forced into HealthEventPayloadSchema. Read-only sync: this app has no
// feature that creates HKWorkout data, so there is no write-back path or
// PendingWrite entry for this type, unlike HealthMetric.
export const WorkoutPayloadSchema = z.object({
  source: z.string().min(1),
  activityType: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
  durationSeconds: z.number().nonnegative(),
  totalEnergyBurnedKcal: z.number().nonnegative().optional(),
  totalDistanceMeters: z.number().nonnegative().optional(),
});
export type WorkoutPayload = z.infer<typeof WorkoutPayloadSchema>;

// HKCategorySample types (sleep stages, stand hours, mindful sessions, and
// heart/audio/hygiene "event" markers) all share one shape — an enum-like
// integer value over a time range — so they share one generic payload/model,
// unlike quantity samples and workouts which each needed their own.
export const HealthCategoryMetricSchema = z.enum([
  "sleep_analysis",
  "stand_hour",
  "mindful_session",
  "high_heart_rate_event",
  "low_heart_rate_event",
  "irregular_heart_rhythm_event",
  "handwashing_event",
  "toothbrushing_event",
  "walking_steadiness_event",
  "low_cardio_fitness_event",
]);
export type HealthCategoryMetric = z.infer<typeof HealthCategoryMetricSchema>;

export const CategorySamplePayloadSchema = z.object({
  source: z.string().min(1),
  category: HealthCategoryMetricSchema,
  value: z.string().min(1),
  startDate: z.string().datetime({ offset: true }),
  endDate: z.string().datetime({ offset: true }),
});
export type CategorySamplePayload = z.infer<typeof CategorySamplePayloadSchema>;

// HKStateOfMind (Apple's "State of Mind" mood logging, iOS 18+) — the user
// logs this themselves in the Health/Mindfulness app; this app only reads
// it, same read-only stance as workouts and category samples.
export const MoodPayloadSchema = z.object({
  source: z.string().min(1),
  kind: z.enum(["momentary_emotion", "daily_mood"]),
  valence: z.number().min(-1).max(1),
  valenceClassification: z.string().optional(),
  labels: z.array(z.string()),
  associations: z.array(z.string()),
  date: z.string().datetime({ offset: true }),
});
export type MoodPayload = z.infer<typeof MoodPayloadSchema>;
