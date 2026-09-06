"use client";

import { useState } from "react";
import { IconCheck, IconPlus } from "../../../components/icons";
import { PageHeader, Reading, Section } from "../../../components/ui";
import { apiFetch } from "../../../lib/apiFetch";
import { getTodayLocal } from "../../../lib/date";
import { DOMAINS } from "../../../lib/domains";
import { queueForSync } from "../../../lib/outbox";
import { useFoodSearch } from "../../../lib/useFoodSearch";

type MealSlot = "breakfast" | "lunch" | "snack" | "dinner";
const MEAL_SLOTS: { value: MealSlot; label: string }[] = [
  { value: "breakfast", label: "Breakfast" },
  { value: "lunch", label: "Lunch" },
  { value: "snack", label: "Snack" },
  { value: "dinner", label: "Dinner" },
];

/** Guesses the meal from the clock so the common case needs no tap. Logging a
 *  9 pm dinner as lunch is the kind of quiet error that only shows up weeks
 *  later in the meal-timing breakdown. */
function currentMealSlot(now: Date = new Date()): MealSlot {
  const istHour = new Date(now.getTime() + (5 * 60 + 30) * 60_000).getUTCHours();
  if (istHour < 11) return "breakfast";
  if (istHour < 16) return "lunch";
  if (istHour < 19) return "snack";
  return "dinner";
}

type ParsedFoodItem = {
  source: "indian_dish" | "packaged_food" | "llm_estimate";
  refId?: string;
  name: string;
  macros: { calories: number; proteinG: number; carbsG: number; fatG: number };
};
type ParsedFoodDraft = { items: ParsedFoodItem[]; needsAddedFatPrompt: boolean };
// Tracks per-item outcome of the local outbox write so a partial failure
// (item 2 of 3 fails to queue) is visible and recoverable, instead of the
// whole draft silently vanishing regardless of what actually got queued.
// "queued" means written to the local outbox, not yet round-tripped to the
// server — syncOutbox owns the network retry from there.
type ItemSaveStatus = "pending" | "queuing" | "queued" | "failed";

export default function LogFoodPage() {
  const [mealSlot, setMealSlot] = useState<MealSlot>(currentMealSlot());
  const [query, setQuery] = useState("");
  const { data: results, isError: searchFailed } = useFoodSearch(query);
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<ParsedFoodDraft | null>(null);
  const [addedFatGrams, setAddedFatGrams] = useState<number | undefined>();
  const [isParsing, setIsParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [itemStatuses, setItemStatuses] = useState<ItemSaveStatus[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [dishSaved, setDishSaved] = useState<string | null>(null);
  const [dishError, setDishError] = useState<string | null>(null);

  async function parseText() {
    if (!text.trim()) return;
    setParseError(null);
    // Clear the previous cycle up front, not only on the success path — a
    // failed re-parse must not leave the last meal's draft on screen with a
    // live "Confirm and save" button, which would re-log the wrong meal.
    setDraft(null);
    setItemStatuses([]);
    setAddedFatGrams(undefined);
    setIsParsing(true);
    try {
      // The Gemini call behind this route can fail (timeout, rate limit,
      // malformed response the backend couldn't validate) — /api/nutrition/parse
      // returns 502 in that case, and a bare `.json()` call on a non-ok
      // response would either throw on non-JSON or silently set the draft to
      // whatever error body came back, corrupting the UI state either way.
      const res = await apiFetch("/api/nutrition/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, mealSlot }),
      });
      if (!res.ok) {
        setParseError("Couldn't understand that — try rephrasing, or search for the dish below.");
        return;
      }
      const parsedDraft = (await res.json()) as ParsedFoodDraft;
      setDraft(parsedDraft);
      setItemStatuses(parsedDraft.items.map(() => "pending"));
    } catch {
      setParseError("Can't reach the server. Check your connection and try again.");
    } finally {
      setIsParsing(false);
    }
  }

  async function confirmDraft() {
    if (!draft) return;
    setIsSaving(true);
    // Queue items independently and track each outcome — do NOT abort the
    // whole loop on the first failure (that would silently drop the
    // remaining, perfectly good items) and do NOT clear the draft until
    // every item has actually been queued. queueForSync only fails on a
    // local IndexedDB error (quota, private mode), never on network
    // conditions, so this near-always succeeds even offline.
    const nextStatuses = [...itemStatuses];
    for (let i = 0; i < draft.items.length; i++) {
      if (nextStatuses[i] === "queued") continue; // already queued on a previous, partially-failed attempt
      const item = draft.items[i];
      nextStatuses[i] = "queuing";
      setItemStatuses([...nextStatuses]);
      try {
        await queueForSync("nutrition", {
          date: getTodayLocal(),
          mealSlot,
          source: item.source,
          refId: item.refId,
          macros: item.macros,
          // The added-fat prompt is meal-level, but entries are per-item, so
          // it rides on the first item only. Attaching it to every item would
          // count the same ghee once per dish.
          addedFatGrams: draft.needsAddedFatPrompt && i === 0 ? addedFatGrams : undefined,
        });
        nextStatuses[i] = "queued";
      } catch {
        nextStatuses[i] = "failed";
      }
      setItemStatuses([...nextStatuses]);
    }
    setIsSaving(false);
    // Only clear the draft once everything was queued — a mix of
    // queued/failed items stays visible so the user can retry just the
    // failed ones.
    if (nextStatuses.every((status) => status === "queued")) {
      setDraft(null);
      setItemStatuses([]);
    }
  }

  /** Logging straight from a catalogue hit, for the dishes eaten every week
   *  where a sentence of natural language is slower than two taps. */
  async function logDish(dish: { slug: string; name: string; macrosPerServing: ParsedFoodItem["macros"] }) {
    setDishError(null);
    setDishSaved(null);
    try {
      await queueForSync("nutrition", {
        date: getTodayLocal(),
        mealSlot,
        source: "indian_dish",
        refId: dish.slug,
        macros: dish.macrosPerServing,
      });
      setDishSaved(dish.name);
    } catch {
      setDishError("Couldn't save that on this device. Try again, or check your browser's storage settings.");
    }
  }

  return (
    <>
      <PageHeader
        title="Log food"
        domain="eat"
        backTo={{ href: "/nutrition", label: "Eat" }}
        blurb="Say it the way you would say it out loud. It gets broken into macros for you to check before anything is saved."
      />

      {/* A form reads better in a narrower column than a dashboard, but the
          column stays flush with the header band rather than re-centring. */}
      <main className="measure py-8" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
        <div className="max-w-3xl">
        <Section title="Which meal">
          <div className="flex flex-wrap gap-1.5">
            {MEAL_SLOTS.map((slot) => (
              <button
                key={slot.value}
                type="button"
                onClick={() => setMealSlot(slot.value)}
                aria-pressed={mealSlot === slot.value}
                className="btn btn-secondary min-h-10"
                style={
                  mealSlot === slot.value
                    ? { borderColor: DOMAINS.eat.color, color: DOMAINS.eat.color, fontWeight: 700 }
                    : undefined
                }
              >
                {slot.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Say what you ate">
          <label htmlFor="food-text" className="label">
            In your own words
          </label>
          <textarea
            id="food-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="2 roti aur dal chawal"
            rows={3}
            className="field max-w-2xl"
            style={{ minHeight: "5.5rem", resize: "vertical" }}
          />
          <div className="mt-3">
            <button onClick={parseText} disabled={isParsing || !text.trim()} className="btn btn-primary">
              {isParsing ? "Parsing…" : "Parse"}
            </button>
          </div>
          {parseError && (
            <p className="notice notice-bad mt-4 max-w-2xl" role="alert">
              {parseError}
            </p>
          )}

          {draft && (
            <div className="panel mt-5 max-w-2xl">
              <h3 className="t-h3" style={{ fontSize: "var(--t-lead)" }}>
                Review before saving
              </h3>
              <p className="t-caption mt-1">Nothing is saved until you confirm.</p>

              <ul className="ruled mt-4 border-t">
                {draft.items.map((item, i) => (
                  <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                    <span className="t-small" style={{ fontWeight: 600 }}>
                      {item.name}
                      {itemStatuses[i] === "queued" && (
                        <span className="t-caption" style={{ color: "var(--c-good)" }}>
                          {" "}
                          — queued for sync
                        </span>
                      )}
                      {itemStatuses[i] === "failed" && (
                        <span className="t-caption" style={{ color: "var(--c-bad)" }}>
                          {" — couldn't save on this device, try again"}
                        </span>
                      )}
                    </span>
                    <span className="t-num t-small" style={{ color: "var(--c-ink-soft)" }}>
                      {Math.round(item.macros.proteinG)} g protein, {Math.round(item.macros.calories)} kcal
                    </span>
                  </li>
                ))}
              </ul>

              {draft.needsAddedFatPrompt && (
                <div className="mt-4 max-w-xs">
                  <label htmlFor="added-fat" className="label">
                    Added oil/ghee (grams)
                  </label>
                  <input
                    id="added-fat"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    onChange={(e) => setAddedFatGrams(e.target.value === "" ? undefined : Number(e.target.value))}
                    className="field field-num text-left"
                  />
                  <p className="t-caption mt-1.5">
                    A restaurant dal and a home dal differ mostly by this, so it is counted separately.
                  </p>
                </div>
              )}

              <button onClick={confirmDraft} disabled={isSaving} className="btn btn-primary mt-5">
                {isSaving
                  ? "Saving…"
                  : itemStatuses.some((s) => s === "failed")
                    ? "Retry failed items"
                    : "Confirm and save"}
              </button>
            </div>
          )}
        </Section>

        <Section
          title="Or find a dish"
          note="The catalogue holds per-serving macros for the dishes that come up every week. One tap logs a serving."
        >
          <label htmlFor="dish-search" className="label">
            Search the dish catalogue
          </label>
          <input
            id="dish-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search dishes…"
            className="field max-w-md"
          />

          {searchFailed && (
            <p className="notice notice-bad mt-4 max-w-2xl" role="alert">
              Search is unavailable right now. The natural-language box above still works.
            </p>
          )}

          {results && results.length > 0 && (
            <ul className="mt-4 flex max-w-2xl flex-col gap-2.5">
              {results.map((dish) => (
                <li key={dish.slug} className="row" style={{ ["--domain" as string]: DOMAINS.eat.color }}>
                  <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                    <div>
                      <p className="t-small" style={{ fontWeight: 600 }}>
                        {dish.name}
                      </p>
                      <p className="t-caption mt-0.5">
                        Per <span className="t-num">{dish.servingGrams} g</span> serving
                      </p>
                    </div>
                    <div className="flex items-center gap-7">
                      <Reading
                        size="sm"
                        value={`${Math.round(dish.macrosPerServing.proteinG)}`}
                        unit="g"
                        label="protein"
                      />
                      <Reading
                        size="sm"
                        value={`${Math.round(dish.macrosPerServing.calories)}`}
                        unit="kcal"
                        label="energy"
                      />
                      <button type="button" className="btn btn-secondary" onClick={() => void logDish(dish)}>
                        <IconPlus size={18} />
                        Log
                      </button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {query.length > 0 && results && results.length === 0 && (
            <p className="t-small mt-4" style={{ color: "var(--c-ink-soft)" }}>
              Nothing in the catalogue matches “{query}”. Describe it in the box above instead.
            </p>
          )}

          {dishError && (
            <p className="notice notice-bad mt-4 max-w-2xl" role="alert">
              {dishError}
            </p>
          )}
          {dishSaved && (
            <p className="notice notice-good mt-4 max-w-2xl" role="status">
              <span className="mt-px flex-none" style={{ color: "var(--c-good)" }}>
                <IconCheck size={18} />
              </span>
              {dishSaved} added to {mealSlot}. It will sync on its own.
            </p>
          )}
        </Section>
        </div>
      </main>
    </>
  );
}
