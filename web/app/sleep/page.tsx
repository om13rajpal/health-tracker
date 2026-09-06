"use client";

import Link from "next/link";
import { Chart } from "../../components/Chart";
import { DayStrip } from "../../components/DayStrip";
import { IconPlus } from "../../components/icons";
import { DataTable, EmptyState, ErrorState, Loading, PageHeader, Reading, Section } from "../../components/ui";
import { DOMAINS } from "../../lib/domains";
import { clockFromMinutes, durationHours, istClock, istMinutesOfDay, mediumDate } from "../../lib/format";
import { computeSocialJetlag, computeWakeTimeConsistency } from "../../lib/sleep-metrics";
import { buildLedgerDays, useRollups, useSleepSessions, type SleepSession } from "../../lib/useLedger";

const STAGES = [
  { key: "deep", label: "Deep", color: "var(--c-indigo)" },
  { key: "rem", label: "REM", color: "color-mix(in oklab, var(--c-indigo) 70%, var(--c-field))" },
  { key: "core", label: "Core", color: "color-mix(in oklab, var(--c-indigo) 44%, var(--c-field))" },
  { key: "awake", label: "Awake", color: "var(--c-rule)" },
] as const;

function hoursOf(session: SleepSession): number {
  return (new Date(session.wakeTime).getTime() - new Date(session.bedTime).getTime()) / 3_600_000;
}

/** A wake time near midnight has to be unwrapped before it can be plotted, or
 *  a 00:10 wake would sit at the bottom of the axis instead of beside 23:50. */
function plottableWakeMinutes(iso: string): number {
  const minutes = istMinutesOfDay(iso);
  return minutes > 18 * 60 ? minutes - 1440 : minutes;
}

export default function SleepPage() {
  const sleep = useSleepSessions();
  const rollups = useRollups();

  const sessions = sleep.data ?? [];
  const jetlag = sessions.length ? computeSocialJetlag(sessions) : null;
  const consistency = sessions.length ? computeWakeTimeConsistency(sessions) : null;
  const lastNight = sessions[sessions.length - 1];

  const days = buildLedgerDays(rollups.data, sleep.data);

  const averageHours = sessions.length
    ? sessions.reduce((sum, s) => sum + hoursOf(s), 0) / sessions.length
    : null;

  // Plotted across the whole twelve weeks rather than across the nights that
  // happen to exist, so a week with no record shows as a break in the line
  // instead of being quietly closed up.
  const byDate = new Map(sessions.map((s) => [s.date, s]));
  const wakePoints = days.map((d) => {
    const s = byDate.get(d.date);
    return { x: d.date, y: s ? plottableWakeMinutes(s.wakeTime) : null };
  });
  const durationPoints = days.map((d) => {
    const s = byDate.get(d.date);
    return { x: d.date, y: s ? hoursOf(s) : null };
  });

  const lastNightStages = lastNight?.stages;
  const stageTotal = lastNightStages
    ? STAGES.reduce((sum, stage) => sum + (lastNightStages[stage.key] ?? 0), 0)
    : 0;

  if (sleep.isLoading) {
    return (
      <>
        <PageHeader title="Sleep" domain="sleep" blurb="When you slept, and how steady the schedule held." />
        <main className="measure py-8">
          <Loading rows={4} label="Loading your sleep record" />
        </main>
      </>
    );
  }

  if (sleep.isError) {
    return (
      <>
        <PageHeader title="Sleep" domain="sleep" blurb="When you slept, and how steady the schedule held." />
        <main className="measure py-8">
          <ErrorState what="Your sleep record didn't load." onRetry={() => void sleep.refetch()} />
        </main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Sleep"
        domain="sleep"
        blurb="When you slept, and how steady the schedule held. Wake time is the anchor — it sets everything else."
        stat={
          consistency !== null
            ? {
                value: `±${Math.round(consistency)}`,
                unit: "min",
                caption: "how far your wake time drifts, night to night",
              }
            : undefined
        }
      >
        {rollups.data && <DayStrip days={days} onBand only="sleep" />}
      </PageHeader>

      <main className="measure py-8">
        {sessions.length === 0 ? (
          <EmptyState
            headline="No nights on the record yet"
            body="Log a night, or let the bridge app bring sleep across from Apple Health. Two weeks in, the drift and jetlag numbers start to mean something."
            action={{ href: "/sleep/log", label: "Log a night" }}
          />
        ) : (
          <>
            <Section
              title="Last night"
              action={
                <Link
                  href="/sleep/log"
                  className="btn btn-primary"
                  style={{ ["--domain" as string]: DOMAINS.sleep.color }}
                >
                  <IconPlus size={18} />
                  Log a night
                </Link>
              }
            >
              <div className="panel">
                <div className="flex flex-wrap gap-x-10 gap-y-5">
                  <Reading
                    value={durationHours(hoursOf(lastNight))}
                    label={mediumDate(lastNight.date)}
                    color={DOMAINS.sleep.color}
                  />
                  <Reading value={istClock(lastNight.bedTime)} label="in bed" />
                  <Reading value={istClock(lastNight.wakeTime)} label="awake" />
                  <Reading value={istClock(lastNight.midpoint)} label="midpoint" />
                </div>

                {lastNightStages && stageTotal > 0 && (
                  <div className="mt-7">
                    <p className="t-caption mb-1.5">How the night was spent</p>
                    <div
                      className="flex h-3 w-full gap-[2px]"
                      role="img"
                      aria-label="Time in deep, REM, core and awake stages last night"
                    >
                      {STAGES.map((stage) => {
                        const minutes = lastNightStages[stage.key] ?? 0;
                        return minutes > 0 ? (
                          <span
                            key={stage.key}
                            style={{
                              width: `${(minutes / stageTotal) * 100}%`,
                              background: stage.color,
                              borderRadius: "1px",
                            }}
                          />
                        ) : null;
                      })}
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                      {STAGES.map((stage) => (
                        <li key={stage.key} className="t-caption flex items-center gap-1.5">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2"
                            style={{ background: stage.color, borderRadius: "1px" }}
                          />
                          {stage.label}{" "}
                          <span className="t-num">{Math.round(lastNightStages[stage.key] ?? 0)} m</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <p className="t-small mt-6" style={{ color: "var(--c-ink-soft)" }}>
                  {lastNight.morningLightWithinMinutes !== undefined
                    ? `Outdoor light ${lastNight.morningLightWithinMinutes} minutes after waking.`
                    : "No morning light logged."}{" "}
                  {lastNight.morningExercise ? "Trained inside the first half hour." : ""}
                </p>
              </div>
            </Section>

            <Section
              title="How steady the schedule is"
              note="Social jetlag is the gap between your weekday and weekend sleep midpoints — the closer to zero, the less Monday morning costs."
            >
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <div className="row flex-1" style={{ ["--domain" as string]: DOMAINS.sleep.color }}>
                  <Reading
                    value={jetlag !== null ? `${Math.round(jetlag)}` : null}
                    unit="min"
                    label="social jetlag"
                    color={DOMAINS.sleep.color}
                  />
                  <p className="t-small mt-2" style={{ color: "var(--c-ink-soft)" }}>
                    {jetlag === null
                      ? "Needs at least one weekday and one weekend night."
                      : jetlag < 30
                        ? "Under half an hour. The weekend is not undoing the week."
                        : jetlag < 60
                          ? "Close to an hour of drift. Worth pulling back."
                          : "Over an hour. Monday will feel like a time-zone change."}
                  </p>
                </div>
                <div className="row flex-1" style={{ ["--domain" as string]: DOMAINS.sleep.color }}>
                  <Reading
                    value={averageHours !== null ? durationHours(averageHours) : null}
                    label="average night, twelve weeks"
                    color={DOMAINS.sleep.color}
                  />
                  <p className="t-small mt-2" style={{ color: "var(--c-ink-soft)" }}>
                    Across <span className="t-num">{sessions.length}</span> nights on the record.
                  </p>
                </div>
              </div>
            </Section>

            <Section
              title="Wake time"
              note="Each point is the morning you actually got up. A flat line here is worth more than any single long night."
            >
              <div className="panel">
                <Chart
                  points={wakePoints}
                  color={DOMAINS.sleep.color}
                  label="Wake time over the last twelve weeks"
                  formatValue={(v) => clockFromMinutes(v)}
                />
              </div>
            </Section>

            {/* A line, not bars: every night lands between six and nine hours,
                so a zero-based bar chart would spend most of its height on a
                range no night ever reaches. */}
            <Section title="Hours slept" note="Against eight hours. Breaks in the line are nights with no record.">
              <div className="panel">
                <Chart
                  points={durationPoints}
                  color={DOMAINS.sleep.color}
                  unit=" h"
                  label="Hours slept per night over the last twelve weeks"
                  reference={{ value: 8, label: "8 h" }}
                  formatValue={(v) => v.toFixed(1)}
                />
              </div>
            </Section>

            <Section title="Recent nights">
              <DataTable
                columns={[
                  { key: "date", label: "Night" },
                  { key: "bed", label: "In bed", numeric: true },
                  { key: "wake", label: "Awake", numeric: true },
                  { key: "hours", label: "Slept", numeric: true },
                  { key: "light", label: "Light after waking", numeric: true },
                ]}
                rows={sessions
                  .slice(-10)
                  .reverse()
                  .map((s) => ({
                    date: mediumDate(s.date),
                    bed: istClock(s.bedTime),
                    wake: istClock(s.wakeTime),
                    hours: durationHours(hoursOf(s)),
                    light:
                      s.morningLightWithinMinutes !== undefined ? `${s.morningLightWithinMinutes} min` : "—",
                  }))}
              />
            </Section>
          </>
        )}
      </main>
    </>
  );
}
