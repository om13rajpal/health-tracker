"use client";

import Link from "next/link";
import { Chart } from "../../components/Chart";
import { DayStrip } from "../../components/DayStrip";
import { IconPlus } from "../../components/icons";
import { Meter } from "../../components/Meter";
import { EmptyState, ErrorState, Loading, PageHeader, Reading, Section } from "../../components/ui";
import { getTodayLocal } from "../../lib/date";
import { DOMAINS } from "../../lib/domains";
import { count, humanizeSlug, longDate, sentenceList } from "../../lib/format";
import {
  buildLedgerDays,
  PROTEIN_TARGET_G,
  useNutritionEntries,
  useNutritionSummary,
  useRollups,
  useSleepSessions,
  type FoodEntry,
} from "../../lib/useLedger";
import { useRecipeSuggestions } from "../../lib/useRecipeSuggestions";

const MEAL_ORDER: FoodEntry["mealSlot"][] = ["breakfast", "lunch", "snack", "dinner"];
const MEAL_LABEL: Record<FoodEntry["mealSlot"], string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snack: "Snacks",
  dinner: "Dinner",
};

/** A fallback only for the very first days, before there is enough history to
 *  say what a usual day costs. There is no calorie target in the backend, so
 *  the page never invents one — it compares today against your own average. */
const FALLBACK_USUAL_DAY_KCAL = 2200;

/** Calories from each macro, which is what the composition bar divides. Three
 *  steps of the one hue: protein is the reading that matters and carries full
 *  strength, the other two are context. Each is directly labelled below, so
 *  identity never rests on the colour alone. */
function calorieSplit(summary: { proteinG: number; carbsG: number; fatG: number }) {
  const protein = summary.proteinG * 4;
  const carbs = summary.carbsG * 4;
  const fat = summary.fatG * 9;
  const total = protein + carbs + fat || 1;
  return [
    { key: "protein", label: "Protein", grams: summary.proteinG, share: protein / total, color: DOMAINS.eat.color },
    {
      key: "carbs",
      label: "Carbs",
      grams: summary.carbsG,
      share: carbs / total,
      color: "color-mix(in oklab, var(--c-marigold) 62%, var(--c-field))",
    },
    {
      key: "fat",
      label: "Fat",
      grams: summary.fatG,
      share: fat / total,
      color: "color-mix(in oklab, var(--c-marigold) 46%, var(--c-field))",
    },
  ];
}

export default function NutritionPage() {
  const today = getTodayLocal();
  const summary = useNutritionSummary(today);
  const entries = useNutritionEntries(today);
  const rollups = useRollups();
  const sleep = useSleepSessions();

  const eaten = summary.data?.calories ?? 0;
  // "Usual day" is your own 28-day average, not a target the app made up —
  // the backend has a protein target and nothing else.
  const recentCalorieDays = (rollups.data ?? []).slice(-28).filter((r) => (r.totalCalories ?? 0) > 0);
  const usualDay = recentCalorieDays.length
    ? Math.round(recentCalorieDays.reduce((sum, r) => sum + (r.totalCalories ?? 0), 0) / recentCalorieDays.length)
    : FALLBACK_USUAL_DAY_KCAL;
  const remainingCalories = Math.max(0, Math.round(usualDay - eaten));
  const remainingProtein = Math.max(0, Math.round((summary.data?.proteinTargetG ?? PROTEIN_TARGET_G) - (summary.data?.proteinG ?? 0)));
  const suggestions = useRecipeSuggestions("dinner", remainingProtein, remainingCalories);

  const ateToday = (summary.data?.calories ?? 0) > 0 || (summary.data?.proteinG ?? 0) > 0;
  const days = buildLedgerDays(rollups.data, sleep.data, undefined, {
    proteinG: ateToday ? summary.data?.proteinG : undefined,
  });
  const proteinPoints = days.map((d) => ({
    x: d.date,
    y: d.detail.eat === "no record" ? null : Number(d.detail.eat.replace(" g protein", "")),
  }));

  const byMeal = MEAL_ORDER.map((slot) => ({
    slot,
    items: (entries.data ?? []).filter((e) => e.mealSlot === slot),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <PageHeader
        title="Eat"
        domain="eat"
        blurb={`${longDate(today)}. Protein is the number that matters; everything else is context.`}
        stat={
          summary.isError
            ? undefined
            : {
                value: `${Math.round(summary.data?.proteinG ?? 0)}`,
                unit: "g",
                caption: `protein today, against a ${Math.round(summary.data?.proteinTargetG ?? PROTEIN_TARGET_G)} g target`,
              }
        }
      >
        {rollups.data && <DayStrip days={days} onBand only="eat" />}
      </PageHeader>

      <main className="measure py-8">
        <Section
          title="Today"
          action={
            <Link href="/nutrition/log" className="btn btn-primary" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
              <IconPlus size={18} />
              Log food
            </Link>
          }
        >
          {summary.isError ? (
            <ErrorState what="Today's macros didn't load." onRetry={() => void summary.refetch()} />
          ) : summary.isLoading ? (
            <Loading rows={2} label="Loading today's macros" />
          ) : (
            <div className="panel">
              <Meter
                value={summary.data?.proteinG ?? 0}
                target={summary.data?.proteinTargetG ?? PROTEIN_TARGET_G}
                color={DOMAINS.eat.color}
                unit="g protein"
                label="Protein today against target"
              />

              <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
                <Reading value={`${count(Math.round(eaten))}`} unit="kcal" label="eaten today" />
                <Reading
                  value={`${count(remainingCalories)}`}
                  unit="kcal"
                  label={`left of your usual ${count(usualDay)}`}
                />
                <Reading value={`${remainingProtein}`} unit="g" label="protein still to get" />
              </div>

              {summary.data && eaten > 0 && (
                <div className="mt-6">
                  <p className="t-caption mb-1.5">Where today&rsquo;s calories came from</p>
                  <div className="flex h-2.5 w-full gap-[2px]" role="img" aria-label="Share of calories from protein, carbohydrate and fat">
                    {calorieSplit(summary.data).map((part) => (
                      <span
                        key={part.key}
                        style={{
                          width: `${part.share * 100}%`,
                          background: part.color,
                          borderRadius: "1px",
                        }}
                      />
                    ))}
                  </div>
                  <ul className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                    {calorieSplit(summary.data).map((part) => (
                      <li key={part.key} className="t-caption flex items-center gap-1.5">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2"
                          style={{ background: part.color, borderRadius: "1px" }}
                        />
                        {part.label} <span className="t-num">{Math.round(part.grams)} g</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title="Today’s meals">
          {entries.isError ? (
            <ErrorState what="Today's meals didn't load." onRetry={() => void entries.refetch()} />
          ) : entries.isLoading ? (
            <Loading rows={3} label="Loading today's meals" />
          ) : byMeal.length === 0 ? (
            <EmptyState
              headline="Nothing logged today"
              body="Type what you ate in plain language — “2 roti aur dal chawal” — and it gets broken into macros for you."
              action={{ href: "/nutrition/log", label: "Log food" }}
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {byMeal.map(({ slot, items }) => {
                const slotProtein = items.reduce((sum, e) => sum + e.macros.proteinG, 0);
                const slotCalories = items.reduce(
                  (sum, e) => sum + e.macros.calories + (e.addedFatGrams ?? 0) * 9,
                  0
                );
                return (
                  <div key={slot} className="row" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <h3 className="t-h3" style={{ fontSize: "var(--t-lead)" }}>
                        {MEAL_LABEL[slot]}
                      </h3>
                      <p className="t-num t-small" style={{ color: "var(--c-ink-soft)" }}>
                        {Math.round(slotProtein)} g protein, {Math.round(slotCalories)} kcal
                      </p>
                    </div>
                    <ul className="ruled mt-2">
                      {items.map((item, i) => (
                        <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-6 py-2">
                          <span className="t-small">
                            {item.refId ? humanizeSlug(item.refId) : "Estimated item"}
                            {item.addedFatGrams ? (
                              <span className="t-caption"> plus {item.addedFatGrams} g oil</span>
                            ) : null}
                          </span>
                          <span className="t-num t-small" style={{ color: "var(--c-ink-soft)" }}>
                            {Math.round(item.macros.proteinG)} g protein, {Math.round(item.macros.calories)} kcal
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        <Section
          title="Protein, twelve weeks"
          note={`The dashed line is the ${Math.round(summary.data?.proteinTargetG ?? PROTEIN_TARGET_G)} g target. Empty columns are days with nothing logged.`}
        >
          {rollups.isError ? (
            <ErrorState what="Your protein history didn't load." onRetry={() => void rollups.refetch()} />
          ) : rollups.isLoading ? (
            <Loading rows={2} label="Loading protein history" />
          ) : (
            <div className="panel">
              <Chart
                points={proteinPoints}
                kind="bar"
                color={DOMAINS.eat.color}
                unit=" g"
                label="Protein per day over the last twelve weeks"
                reference={{
                  value: summary.data?.proteinTargetG ?? PROTEIN_TARGET_G,
                  label: "target",
                }}
                formatValue={(v) => `${Math.round(v)}`}
              />
            </div>
          )}
        </Section>

        <Section
          title="What to cook with what’s left"
          note={`Ranked by protein per calorie, inside the ${count(remainingCalories)} kcal still on today's budget.`}
        >
          {remainingCalories === 0 ? (
            <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
              Today&rsquo;s calorie budget is spent. Suggestions come back tomorrow.
            </p>
          ) : suggestions.isError ? (
            <ErrorState what="Recipe suggestions didn't load." onRetry={() => void suggestions.refetch()} />
          ) : suggestions.isLoading ? (
            <Loading rows={2} label="Loading recipe suggestions" />
          ) : suggestions.data?.length ? (
            <div className="flex flex-col gap-2.5">
              {suggestions.data.slice(0, 4).map((recipe) => (
                <div key={recipe.slug} className="row" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
                    <div>
                      <h3 className="t-h3" style={{ fontSize: "var(--t-lead)" }}>
                        {recipe.name}
                      </h3>
                      <p className="t-caption mt-1">
                        {recipe.prepMinutes} minutes, {sentenceList(recipe.equipment.map(humanizeSlug)).toLowerCase()}
                      </p>
                    </div>
                    <div className="flex gap-7">
                      <Reading size="sm" value={`${Math.round(recipe.macros.proteinG)}`} unit="g" label="protein" />
                      <Reading size="sm" value={`${Math.round(recipe.macros.calories)}`} unit="kcal" label="cost" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="t-small" style={{ color: "var(--c-ink-soft)" }}>
              Nothing in the recipe book fits inside what&rsquo;s left today.
            </p>
          )}
        </Section>
      </main>
    </>
  );
}
