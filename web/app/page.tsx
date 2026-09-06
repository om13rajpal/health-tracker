"use client";

import Link from "next/link";
import { DayStrip } from "../components/DayStrip";
import { Meter } from "../components/Meter";
import { DataTable, ErrorState, Loading, PageHeader, Reading, Section } from "../components/ui";
import { DOMAINS } from "../lib/domains";
import { getTodayLocal } from "../lib/date";
import { count, durationHours, humanizeSlug, istClock, longDate, mediumDate, shortDate } from "../lib/format";
import { countHardSets } from "../lib/training-metrics";
import { useExercises } from "../lib/useExercises";
import {
  buildLedgerDays,
  HARD_SET_TARGET,
  PROTEIN_TARGET_G,
  STEP_TARGET,
  useCoachNotes,
  useNutritionSummary,
  useRollups,
  useSleepSessions,
  useWorkouts,
  WINDOW_DAYS,
} from "../lib/useLedger";

export default function TodayPage() {
  const today = getTodayLocal();
  const rollups = useRollups();
  const sleep = useSleepSessions();
  const workouts = useWorkouts();
  const summary = useNutritionSummary(today);
  const notes = useCoachNotes(1);
  const exercises = useExercises();

  const failed = rollups.isError || sleep.isError;
  const loading = rollups.isLoading || sleep.isLoading;

  // Today's rollup is written overnight, so today's training and protein come
  // from the live sources and only the Apple Health readings wait for the job.
  // Both stay undefined until something is actually logged — a zero would put
  // today on the record and quietly overstate the streak.
  const trainedToday = (workouts.data ?? []).some((s) => s.date === today);
  const todaySets = trainedToday ? countHardSets(workouts.data ?? [], today) : undefined;
  const ateToday = (summary.data?.calories ?? 0) > 0 || (summary.data?.proteinG ?? 0) > 0;
  const todayProtein = ateToday ? summary.data?.proteinG : undefined;

  const days = buildLedgerDays(rollups.data, sleep.data, WINDOW_DAYS, {
    hardSets: todaySets,
    proteinG: todayProtein,
  });
  const recorded = days.filter((d) => Object.values(d.readings).some((v) => v !== null)).length;
  const firstDay = days[0]?.date;

  const latestBodyReading = [...(rollups.data ?? [])].reverse().find((r) => r.totalSteps > 0 || r.weightKg);
  const bodyIsStale = latestBodyReading !== undefined && latestBodyReading.date !== today;
  const lastNight = sleep.data?.[sleep.data.length - 1];
  const sessionsThisWeek = new Set(
    (workouts.data ?? []).filter((s) => s.date >= days[days.length - 7]?.date).map((s) => s.date)
  ).size;
  const lastSession = workouts.data?.[workouts.data.length - 1];
  const exerciseName = (slug: string) => exercises.data?.find((e) => e.slug === slug)?.name ?? humanizeSlug(slug);

  const week = days.slice(-7);

  return (
    <>
      <PageHeader
        title="Today"
        blurb={longDate(today)}
        stat={
          failed || loading
            ? undefined
            : {
                value: `${recorded}`,
                unit: `/ ${WINDOW_DAYS}`,
                caption: firstDay ? `days on the record since ${shortDate(firstDay)}` : "days on the record",
              }
        }
      >
        {loading ? (
          <div className="skeleton" style={{ height: "3.75rem" }} />
        ) : failed ? null : (
          <DayStrip days={days} onBand />
        )}
      </PageHeader>

      <main className="measure py-8">
        {failed && (
          <div className="mb-7">
            <ErrorState what="Today's record didn't load." onRetry={() => void rollups.refetch()} />
          </div>
        )}

        <Section title="Where today stands">
          {loading ? (
            <Loading rows={4} label="Loading today's readings" />
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* Train ------------------------------------------------------ */}
              <Link href="/train" className="row" style={{ ["--domain" as string]: DOMAINS.train.color }}>
                <div className="row-grid">
                  <div>
                    <p className="t-caption">Train</p>
                    <Reading
                      value={todaySets === undefined ? null : `${todaySets}`}
                      unit="hard sets"
                      label={`${HARD_SET_TARGET} is a full session`}
                      color={DOMAINS.train.color}
                      emptyLabel="nothing today"
                    />
                  </div>
                  <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                    {sessionsThisWeek === 0
                      ? "Nothing trained in the last seven days."
                      : `${sessionsThisWeek} ${sessionsThisWeek === 1 ? "session" : "sessions"} in the last seven days.`}
                  </p>
                  <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                    {lastSession ? (
                      <>
                        Last session {mediumDate(lastSession.date)} —{" "}
                        {lastSession.exercises.map((e) => exerciseName(e.exerciseId)).join(", ")}.
                      </>
                    ) : (
                      "No sessions logged yet."
                    )}
                  </p>
                </div>
              </Link>

              {/* Eat -------------------------------------------------------- */}
              <Link href="/nutrition" className="row" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
                <div className="row-grid">
                  <div>
                    <p className="t-caption">Eat</p>
                    <Reading
                      value={todayProtein === undefined ? null : `${Math.round(todayProtein)}`}
                      unit="g protein"
                      label="today, so far"
                      color={DOMAINS.eat.color}
                      emptyLabel="nothing today"
                    />
                  </div>
                  <Meter
                    value={todayProtein ?? 0}
                    target={summary.data?.proteinTargetG ?? PROTEIN_TARGET_G}
                    color={DOMAINS.eat.color}
                    unit="g"
                    label="Protein today against target"
                  />
                  {summary.data ? (
                    <div className="flex gap-7">
                      <Reading size="sm" value={`${Math.round(summary.data.calories)}`} unit="kcal" label="eaten" />
                      <Reading size="sm" value={`${Math.round(summary.data.carbsG)}`} unit="g" label="carbs" />
                      <Reading size="sm" value={`${Math.round(summary.data.fatG)}`} unit="g" label="fat" />
                    </div>
                  ) : (
                    <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                      No meals logged today yet.
                    </p>
                  )}
                </div>
              </Link>

              {/* Sleep ------------------------------------------------------ */}
              <Link href="/sleep" className="row" style={{ ["--domain" as string]: DOMAINS.sleep.color }}>
                <div className="row-grid">
                  <div>
                    <p className="t-caption">Sleep</p>
                    <Reading
                      value={
                        lastNight
                          ? durationHours(
                              (new Date(lastNight.wakeTime).getTime() - new Date(lastNight.bedTime).getTime()) /
                                3_600_000
                            )
                          : null
                      }
                      label={lastNight ? `last night, ${mediumDate(lastNight.date)}` : "last night"}
                      emptyLabel="no night logged"
                      color={DOMAINS.sleep.color}
                    />
                  </div>
                  {lastNight ? (
                    <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                      Bed <span className="t-num">{istClock(lastNight.bedTime)}</span>, woke{" "}
                      <span className="t-num">{istClock(lastNight.wakeTime)}</span>.
                    </p>
                  ) : (
                    <span />
                  )}
                  {lastNight?.stages ? (
                    <div className="flex gap-7">
                      <Reading size="sm" value={`${Math.round(lastNight.stages.deep ?? 0)}`} unit="m" label="deep" />
                      <Reading size="sm" value={`${Math.round(lastNight.stages.rem ?? 0)}`} unit="m" label="REM" />
                      <Reading size="sm" value={`${Math.round(lastNight.stages.awake ?? 0)}`} unit="m" label="awake" />
                    </div>
                  ) : (
                    <span />
                  )}
                </div>
              </Link>

              {/* Move ------------------------------------------------------- */}
              <div className="row" style={{ ["--domain" as string]: DOMAINS.body.color }}>
                <div className="row-grid">
                  <div>
                    <p className="t-caption">Move</p>
                    <Reading
                      value={latestBodyReading ? count(latestBodyReading.totalSteps) : null}
                      unit="steps"
                      label={`${count(STEP_TARGET)} is the day's mark`}
                      color={DOMAINS.body.color}
                    />
                  </div>
                  <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
                    Read from Apple Health by the bridge app.{" "}
                    {bodyIsStale && latestBodyReading
                      ? `Last totalled ${mediumDate(latestBodyReading.date)} — today's totals land overnight.`
                      : "Nothing to log here."}
                  </p>
                  <div className="flex gap-8">
                    <Reading
                      size="sm"
                      value={latestBodyReading?.restingHeartRate ? `${latestBodyReading.restingHeartRate}` : null}
                      unit="bpm"
                      label="resting heart rate"
                    />
                    <Reading
                      size="sm"
                      value={latestBodyReading?.weightKg ? latestBodyReading.weightKg.toFixed(1) : null}
                      unit="kg"
                      label="weight"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </Section>

        <Section title="The last seven days">
          {loading ? (
            <Loading rows={3} label="Loading the week" />
          ) : (
            <DataTable
              caption="A dash means nothing was recorded that day."
              columns={[
                { key: "day", label: "Day" },
                { key: "sets", label: "Hard sets", numeric: true },
                { key: "protein", label: "Protein", numeric: true },
                { key: "sleep", label: "Sleep", numeric: true },
                { key: "steps", label: "Steps", numeric: true },
              ]}
              rows={week.map((d) => ({
                day: mediumDate(d.date),
                sets: d.detail.train === "no record" ? "—" : d.detail.train.replace(" hard sets", ""),
                protein: d.detail.eat === "no record" ? "—" : d.detail.eat.replace(" protein", ""),
                sleep: d.detail.sleep === "no record" ? "—" : d.detail.sleep,
                steps: d.detail.body === "no record" ? "—" : d.detail.body.replace(" steps", ""),
              }))}
            />
          )}
        </Section>

        <Section
          title="Latest coach note"
          action={
            <Link href="/coach-notes" className="t-small no-underline" style={{ color: "var(--c-ink-soft)" }}>
              All notes
            </Link>
          }
        >
          {notes.isLoading ? (
            <Loading rows={2} label="Loading the latest note" />
          ) : notes.isError ? (
            <ErrorState what="The latest coach note didn't load." onRetry={() => void notes.refetch()} />
          ) : notes.data?.length ? (
            <Link href="/coach-notes" className="row" style={{ ["--domain" as string]: DOMAINS.body.color }}>
              <p className="t-caption">Week of {shortDate(notes.data[0].weekOf)}</p>
              <p className="t-body mt-2">{notes.data[0].summary}</p>
            </Link>
          ) : (
            <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
              No notes yet. One arrives each week once a coaching session writes it.
            </p>
          )}
        </Section>
      </main>
    </>
  );
}
