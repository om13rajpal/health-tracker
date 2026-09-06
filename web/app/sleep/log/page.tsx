"use client";

import { useState } from "react";
import { IconCheck } from "../../../components/icons";
import { PageHeader, Section } from "../../../components/ui";
import { getTodayLocal } from "../../../lib/date";
import { DOMAINS } from "../../../lib/domains";
import { mediumDate } from "../../../lib/format";
import { queueForSync } from "../../../lib/outbox";

export default function LogSleepPage() {
  const [bedTime, setBedTime] = useState("");
  const [wakeTime, setWakeTime] = useState("");
  const [morningLightWithinMinutes, setMorningLightWithinMinutes] = useState<number>();
  const [morningExercise, setMorningExercise] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  function toIsoOrEmpty(value: string): string {
    const date = new Date(value);
    return isNaN(date.getTime()) ? "" : date.toISOString();
  }

  async function handleSubmit() {
    if (!bedTime || !wakeTime) {
      setSaved(false);
      setSaveError("Bed time and wake time are both required.");
      return;
    }
    setSaveError(null);
    setSaved(false);
    setIsSaving(true);
    try {
      await queueForSync("sleep", {
        date: getTodayLocal(),
        bedTime,
        wakeTime,
        morningLightWithinMinutes,
        morningExercise,
      });
      setSaved(true);
    } catch {
      setSaveError("Couldn't save on this device. Try again, or check your browser's storage settings.");
    } finally {
      setIsSaving(false);
    }
  }

  const hours =
    bedTime && wakeTime
      ? (new Date(wakeTime).getTime() - new Date(bedTime).getTime()) / 3_600_000
      : null;

  return (
    <>
      <PageHeader
        title="Log a night"
        domain="sleep"
        backTo={{ href: "/sleep", label: "Sleep" }}
        blurb={`Recorded against ${mediumDate(getTodayLocal())}. Apple Health fills most nights in on its own — this is for the ones it misses.`}
      />

      {/* A form reads better in a narrower column than a dashboard, but the
          column stays flush with the header band rather than re-centring. */}
      <main className="measure py-8" style={{ ["--domain" as string]: DOMAINS.sleep.color }}>
        <div className="max-w-3xl">
        <Section title="The night">
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="bed-time" className="label">
                Bed time
              </label>
              <input
                id="bed-time"
                type="datetime-local"
                onChange={(e) => setBedTime(toIsoOrEmpty(e.target.value))}
                className="field"
              />
            </div>
            <div>
              <label htmlFor="wake-time" className="label">
                Wake time
              </label>
              <input
                id="wake-time"
                type="datetime-local"
                onChange={(e) => setWakeTime(toIsoOrEmpty(e.target.value))}
                className="field"
              />
            </div>
          </div>

          {hours !== null && (
            <p className="t-small mt-3" style={{ color: hours <= 0 ? "var(--c-bad)" : "var(--c-ink-soft)" }}>
              {hours <= 0
                ? "Wake time is before bed time — check the dates."
                : `That is ${hours.toFixed(1)} hours in bed.`}
            </p>
          )}
        </Section>

        <Section
          title="The morning after"
          note="Both of these move your body clock more than anything you do at night, which is why they are logged here at all."
        >
          <div className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="light" className="label">
                Minutes to outdoor light
              </label>
              <input
                id="light"
                type="number"
                min={0}
                inputMode="numeric"
                placeholder="20"
                onChange={(e) =>
                  setMorningLightWithinMinutes(e.target.value === "" ? undefined : Number(e.target.value))
                }
                className="field field-num text-left"
              />
            </div>

            <label
              htmlFor="morning-exercise"
              className="row flex cursor-pointer items-center gap-3 self-end"
              style={{ ["--domain" as string]: DOMAINS.sleep.color }}
            >
              <input
                id="morning-exercise"
                type="checkbox"
                checked={morningExercise}
                onChange={(e) => setMorningExercise(e.target.checked)}
                className="h-4 w-4 flex-none"
                style={{ accentColor: "var(--c-indigo)" }}
              />
              <span className="t-small">Exercised within 30 minutes of waking</span>
            </label>
          </div>
        </Section>

        <div className="mt-8 border-t pt-6">
          <button onClick={handleSubmit} disabled={isSaving} className="btn btn-primary">
            {isSaving ? "Saving…" : "Save"}
          </button>
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
            Saved.
          </p>
        )}
        </div>
      </main>
    </>
  );
}
