"use client";

import { useEffect, useState } from "react";
import { IconCheck, IconPlus, IconTrash } from "../../../components/icons";
import { NumberField } from "../../../components/NumberField";
import { PageHeader, Section } from "../../../components/ui";
import { getTodayLocal } from "../../../lib/date";
import { DOMAINS } from "../../../lib/domains";
import { mediumDate, repRange } from "../../../lib/format";
import { queueForSync } from "../../../lib/outbox";
import { useExercises } from "../../../lib/useExercises";
import { useProgression, useWorkouts } from "../../../lib/useLedger";

type SetInput = { reps: number; weight: number; rir?: number; type: "warmup" | "normal" };

const BLANK_SET: SetInput = { reps: 0, weight: 0, type: "normal" };

export default function LogWorkoutPage() {
  const { data: exercises, isLoading, isError: exercisesFailedToLoad } = useExercises();
  const progression = useProgression();
  const workouts = useWorkouts();
  const [exerciseId, setExerciseId] = useState("");
  const [sets, setSets] = useState<SetInput[]>([{ ...BLANK_SET }]);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const target = progression.data?.find((state) => state.exerciseId === exerciseId);
  const lastTime = [...(workouts.data ?? [])]
    .reverse()
    .find((session) => (session.exercises ?? []).some((e) => e.exerciseId === exerciseId));
  const lastSets = lastTime?.exercises
    .find((e) => e.exerciseId === exerciseId)
    ?.sets.filter((s) => s.type !== "warmup");

  // Starting an exercise with the programme's own numbers already in the field
  // is the difference between logging between sets and logging afterwards from
  // memory. The prefill only ever applies to a set that has not been typed in.
  useEffect(() => {
    if (!exerciseId || !target) return;
    setSets((current) =>
      current.length === 1 && current[0].reps === 0 && current[0].weight === 0
        ? [{ reps: target.repRangeLow ?? 0, weight: target.loadKg ?? 0, type: "normal" }]
        : current
    );
  }, [exerciseId, target]);

  function updateSet(index: number, patch: Partial<SetInput>) {
    setSets((current) => current.map((set, i) => (i === index ? { ...set, ...patch } : set)));
  }

  async function handleSubmit() {
    setSaveError(null);
    setSaved(false);
    // An all-zero session is not an inert write: the backend reads it as a
    // real working set that missed its target and advances
    // ProgressionState.consecutiveMisses toward a deload. One stray tap on
    // Save would silently corrupt the training program.
    if (!sets.some((set) => set.reps > 0)) {
      setSaveError("Enter at least one set with reps before saving.");
      return;
    }
    setIsSaving(true);
    try {
      // queueForSync only fails if the LOCAL IndexedDB write itself fails
      // (e.g. quota exceeded, or a browser blocking IndexedDB in private
      // mode) — it never fails due to network conditions, since it writes
      // locally first and syncs later. That's rare but must still surface
      // an error rather than silently pretending the set was saved.
      await queueForSync("workout", {
        date: getTodayLocal(),
        exercises: [{ exerciseId, sets }],
      });
      setSaved(true);
    } catch {
      setSaveError("Couldn't save this session on this device. Try again, or check your browser's storage settings.");
    } finally {
      setIsSaving(false);
    }
  }

  const header = (
    <PageHeader
      title="Log a session"
      domain="train"
      backTo={{ href: "/train", label: "Train" }}
      blurb={`Today, ${mediumDate(getTodayLocal())}. Saved on this device first, so bad gym wifi can't lose a set.`}
    />
  );

  if (isLoading) {
    return (
      <>
        {header}
        <main className="measure py-8">
          <p className="t-body">Loading exercises…</p>
        </main>
      </>
    );
  }

  if (exercisesFailedToLoad) {
    return (
      <>
        {header}
        <main className="measure py-8">
          <div className="notice notice-bad" role="alert">
            The exercise list didn&rsquo;t load. Check your connection and reload — nothing you have typed is lost.
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      {header}
      {/* A form reads better in a narrower column than a dashboard, but the
          column stays flush with the header band rather than re-centring. */}
      <main className="measure py-8" style={{ ["--domain" as string]: DOMAINS.train.color }}>
        <div className="max-w-3xl">
        <Section title="Exercise">
          <label htmlFor="exercise" className="label">
            Which lift
          </label>
          <select
            id="exercise"
            value={exerciseId}
            onChange={(e) => setExerciseId(e.target.value)}
            className="field max-w-md"
          >
            <option value="">Select exercise</option>
            {exercises?.map((ex) => (
              <option key={ex.slug} value={ex.slug}>
                {ex.name}
              </option>
            ))}
          </select>

          {exerciseId && (
            <div className="row mt-4" style={{ ["--domain" as string]: DOMAINS.train.color }}>
              <p className="t-small">
                {target?.loadKg
                  ? `The programme wants ${target.loadKg} kg for ${repRange(target.repRangeLow, target.repRangeHigh)}.`
                  : target
                    ? `Bodyweight progression, level ${target.level}, ${repRange(target.repRangeLow, target.repRangeHigh)}.`
                    : "No progression target set for this lift — log it and it will still count."}
              </p>
              {lastTime && lastSets?.length ? (
                <p className="t-small mt-1.5" style={{ color: "var(--c-ink-soft)" }}>
                  Last time, {mediumDate(lastTime.date)}:{" "}
                  <span className="ml-1 inline-flex flex-wrap gap-x-4">
                    {lastSets.map((s, i) => (
                      <span key={i} className="t-num">
                        {s.reps} × {s.weight} kg
                      </span>
                    ))}
                  </span>
                </p>
              ) : null}
            </div>
          )}
        </Section>

        <Section title="Sets" note="Reps-in-reserve is how many more you had in you. Leave it blank if you didn't judge it.">
          <div className="flex flex-col gap-2.5">
            {sets.map((set, i) => (
              <div key={i} className="panel">
                <div className="mb-3 flex items-center justify-between">
                  <p className="t-caption">
                    Set <span className="t-num">{i + 1}</span>
                    {set.type === "warmup" ? " — warm-up" : ""}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="btn btn-quiet min-h-9 text-[0.8125rem]"
                      onClick={() => updateSet(i, { type: set.type === "warmup" ? "normal" : "warmup" })}
                      aria-pressed={set.type === "warmup"}
                    >
                      {set.type === "warmup" ? "Make it a working set" : "Mark as warm-up"}
                    </button>
                    {sets.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-quiet min-h-9 px-2"
                        onClick={() => setSets(sets.filter((_, index) => index !== i))}
                        aria-label={`Remove set ${i + 1}`}
                      >
                        <IconTrash size={16} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <NumberField
                    id={`reps-${i}`}
                    label="Reps"
                    placeholder="Reps"
                    value={set.reps}
                    onChange={(reps) => updateSet(i, { reps })}
                  />
                  <NumberField
                    id={`weight-${i}`}
                    label="Weight"
                    placeholder="Weight (kg)"
                    suffix="kg"
                    step={target?.increment ?? 2.5}
                    value={set.weight}
                    onChange={(weight) => updateSet(i, { weight })}
                  />
                  <NumberField
                    id={`rir-${i}`}
                    label="Reps in reserve"
                    placeholder="RIR"
                    max={10}
                    value={set.rir ?? 0}
                    onChange={(rir) => updateSet(i, { rir: rir === 0 ? undefined : rir })}
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setSets([...sets, { ...(sets[sets.length - 1] ?? BLANK_SET), type: "normal" }])}
            className="btn btn-secondary mt-3"
          >
            <IconPlus size={18} />
            Add set
          </button>
        </Section>

        <div className="mt-8 flex flex-wrap items-center gap-4 border-t pt-6">
          <button onClick={handleSubmit} disabled={!exerciseId || isSaving} className="btn btn-primary">
            {isSaving ? "Saving…" : "Save session"}
          </button>
          {!exerciseId && (
            <p className="t-small" style={{ color: "var(--c-ink-faint)" }}>
              Pick a lift first.
            </p>
          )}
        </div>

        {saveError && (
          <p className="notice notice-bad mt-4" role="alert">
            {saveError}
          </p>
        )}
        {saved && (
          <p className="notice notice-good mt-4" role="status">
            <span className="mt-px flex-none" style={{ color: "var(--c-good)" }}>
              <IconCheck size={18} />
            </span>
            Saved — will sync automatically, even if you&rsquo;re offline right now.
          </p>
        )}
        </div>
      </main>
    </>
  );
}
