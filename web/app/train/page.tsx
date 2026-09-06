"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Chart, type Point } from "../../components/Chart";
import { DayStrip } from "../../components/DayStrip";
import { IconPlus } from "../../components/icons";
import { DataTable, EmptyState, ErrorState, Loading, PageHeader, Section } from "../../components/ui";
import { getTodayLocal } from "../../lib/date";
import { DOMAINS } from "../../lib/domains";
import { humanizeSlug, mediumDate, repRange } from "../../lib/format";
import { computeE1RM, findPRs } from "../../lib/training-metrics";
import { useExercises } from "../../lib/useExercises";
import {
  buildLedgerDays,
  useProgression,
  useRollups,
  useSleepSessions,
  useWorkouts,
  type ProgressionState,
  type WorkoutSession,
} from "../../lib/useLedger";

/** What the progression engine is about to do with this lift, said plainly. */
function progressionVerdict(state: ProgressionState): { text: string; tone: "good" | "hold" | "watch" } {
  if (state.consecutiveMisses >= 2) return { text: "Deload next miss", tone: "watch" };
  if (state.consecutiveTopOfRange >= 1) return { text: "Adding weight next session", tone: "good" };
  if (state.consecutiveBelowRange >= 1) return { text: "Holding — reps fell short", tone: "hold" };
  return { text: "On target", tone: "good" };
}

function bestE1RMByDate(sessions: WorkoutSession[], exerciseId: string): Point[] {
  const best = new Map<string, number>();
  for (const session of sessions) {
    for (const exercise of session.exercises) {
      if (exercise.exerciseId !== exerciseId) continue;
      for (const set of exercise.sets) {
        if (set.type === "warmup" || set.reps > 12 || set.reps === 0) continue;
        const value = computeE1RM(set.weight, set.reps);
        best.set(session.date, Math.max(best.get(session.date) ?? 0, value));
      }
    }
  }
  return [...best.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([x, y]) => ({ x, y }));
}

export default function TrainingPage() {
  const today = getTodayLocal();
  const workouts = useWorkouts();
  const progression = useProgression();
  const exercises = useExercises();
  const rollups = useRollups();
  const sleep = useSleepSessions();
  const [selected, setSelected] = useState<string | null>(null);

  const sessions = useMemo(
    () => [...(workouts.data ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
    [workouts.data]
  );

  // A 42 kg warm-up is not a record. findPRs deliberately scores every set it
  // is given, so the filtering belongs here, at the point of display.
  const workingSessions = useMemo(
    () =>
      sessions.map((session) => ({
        ...session,
        exercises: session.exercises.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.filter((set) => set.type !== "warmup"),
        })),
      })),
    [sessions]
  );

  const trained = useMemo(() => {
    const seen = new Map<string, number>();
    for (const session of sessions) {
      for (const exercise of session.exercises) {
        seen.set(exercise.exerciseId, (seen.get(exercise.exerciseId) ?? 0) + 1);
      }
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  }, [sessions]);

  const name = (slug: string) => exercises.data?.find((e) => e.slug === slug)?.name ?? humanizeSlug(slug);
  const active = selected ?? trained[0] ?? null;

  const fourWeeksAgo = new Date(`${today}T00:00:00Z`);
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);
  const recentSessionCount = new Set(
    sessions.filter((s) => s.date >= fourWeeksAgo.toISOString().slice(0, 10)).map((s) => s.date)
  ).size;

  const e1rmPoints = active ? bestE1RMByDate(sessions, active) : [];
  const prs = active ? findPRs(workingSessions, active) : [];

  // The lifts currently in the programme come first; the rest of the catalogue
  // stays visible underneath rather than burying today's numbers.
  const orderedProgression = useMemo(() => {
    const rank = new Map(trained.map((slug, i) => [slug, i]));
    return [...(progression.data ?? [])].sort(
      (a, b) => (rank.get(a.exerciseId) ?? 99) - (rank.get(b.exerciseId) ?? 99)
    );
  }, [progression.data, trained]);

  const days = buildLedgerDays(rollups.data, sleep.data);

  if (workouts.isLoading) {
    return (
      <>
        <PageHeader title="Train" domain="train" blurb="What you lifted, and what the programme wants next." />
        <main className="measure py-8">
          <Loading rows={4} label="Loading your training record" />
        </main>
      </>
    );
  }

  if (workouts.isError) {
    return (
      <>
        <PageHeader title="Train" domain="train" blurb="What you lifted, and what the programme wants next." />
        <main className="measure py-8">
          <ErrorState what="Your training record didn't load." onRetry={() => void workouts.refetch()} />
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Train"
        domain="train"
        blurb="What you lifted, and what the programme wants next."
        stat={{
          value: `${recentSessionCount}`,
          caption: "sessions in the last four weeks",
        }}
      >
        {rollups.data && <DayStrip days={days} onBand only="train" />}
      </PageHeader>

      <main className="measure py-8">
        <Section
          title="What the programme wants next"
          note="The progression engine sets these from your logged reps and reps-in-reserve. Hit the top of the range and the load goes up on its own."
          action={
            <Link href="/train/log" className="btn btn-primary" style={{ ["--domain" as string]: DOMAINS.train.color }}>
              <IconPlus size={18} />
              Log a session
            </Link>
          }
        >
          {progression.isError ? (
            <ErrorState what="Your progression targets didn't load." onRetry={() => void progression.refetch()} />
          ) : progression.isLoading ? (
            <Loading rows={3} label="Loading progression targets" />
          ) : progression.data?.length ? (
            <DataTable
              columns={[
                { key: "lift", label: "Lift" },
                { key: "target", label: "Next target", numeric: true },
                { key: "range", label: "Rep range", numeric: true },
                { key: "verdict", label: "Standing" },
              ]}
              rows={orderedProgression.map((state) => {
                const verdict = progressionVerdict(state);
                return {
                  lift: name(state.exerciseId),
                  target:
                    state.phase === "barbell" && state.loadKg
                      ? `${state.loadKg} kg`
                      : `level ${state.level}`,
                  range: repRange(state.repRangeLow, state.repRangeHigh, false),
                  verdict: (
                    <span
                      style={{
                        color:
                          verdict.tone === "watch"
                            ? "var(--c-bad)"
                            : verdict.tone === "hold"
                              ? "var(--c-warn)"
                              : "var(--c-good)",
                      }}
                    >
                      {verdict.text}
                    </span>
                  ),
                };
              })}
            />
          ) : (
            <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
              No progression targets seeded yet.
            </p>
          )}
        </Section>

        {trained.length === 0 ? (
          <div className="mt-9">
            <EmptyState
              headline="Nothing logged yet"
              body="Log your first session and the strength trend, records and progression targets fill in from there."
              action={{ href: "/train/log", label: "Log a session" }}
            />
          </div>
        ) : (
          <>
            <Section
              title="Estimated one-rep max"
              note="Estimated from every working set with twelve reps or fewer. It is a trend line, not a number to test."
            >
              <div className="mb-4 flex flex-wrap gap-1.5">
                {trained.slice(0, 6).map((slug) => (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => setSelected(slug)}
                    className="btn btn-secondary min-h-9 text-[0.8125rem]"
                    style={
                      slug === active
                        ? {
                            borderColor: DOMAINS.train.color,
                            color: DOMAINS.train.color,
                            fontWeight: 700,
                          }
                        : undefined
                    }
                    aria-pressed={slug === active}
                  >
                    {name(slug)}
                  </button>
                ))}
              </div>

              <div className="panel">
                <Chart
                  points={e1rmPoints}
                  color={DOMAINS.train.color}
                  unit=" kg"
                  label={`Estimated one-rep max for ${active ? name(active) : "this lift"}`}
                  formatValue={(v) => `${Math.round(v)}`}
                />
              </div>
            </Section>

            <Section title="Records">
              {prs.length > 0 ? (
                <DataTable
                  caption={`Every time ${active ? name(active) : "this lift"} beat its own best by at least one percent.`}
                  columns={[
                    { key: "date", label: "Date" },
                    { key: "e1rm", label: "Estimated 1RM", numeric: true },
                    { key: "gain", label: "Gain", numeric: true },
                  ]}
                  rows={prs
                    .slice()
                    .reverse()
                    .map((pr, i, all) => {
                      const previous = all[i + 1];
                      return {
                        date: mediumDate(pr.date),
                        e1rm: `${Math.round(pr.e1RM)} kg`,
                        gain: previous ? `+${(pr.e1RM - previous.e1RM).toFixed(1)} kg` : "first",
                      };
                    })}
                />
              ) : (
                <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                  No records for this lift yet.
                </p>
              )}
            </Section>

            <Section title="Recent sessions">
              <ul className="ruled panel py-0">
                {sessions
                  .slice(-8)
                  .reverse()
                  .map((session) => (
                    <li key={session.date} className="py-3.5">
                      <p className="t-caption">{mediumDate(session.date)}</p>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {session.exercises.map((exercise) => (
                          <li key={exercise.exerciseId} className="flex flex-wrap items-baseline gap-x-3">
                            <span className="t-small" style={{ fontWeight: 600, minWidth: "11rem" }}>
                              {name(exercise.exerciseId)}
                            </span>
                            <span className="t-num t-small" style={{ color: "var(--c-ink-soft)" }}>
                              {exercise.sets
                                .filter((s) => s.type !== "warmup")
                                .map((s) => `${s.reps} × ${s.weight} kg`)
                                .join("    ")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
              </ul>
            </Section>
          </>
        )}
      </main>
    </>
  );
}
