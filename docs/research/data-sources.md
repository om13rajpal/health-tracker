# Data Sources Research: Food/Nutrition & Exercise/Training

Research date: 2026-09-06. Compiled from live API checks, official docs/ToS pages, GitHub repos, and published studies. Every claim below is sourced; items that could not be independently confirmed are explicitly flagged **UNVERIFIED**.

---

# PART A — FOOD & MACRO DATA

## A.0 Headline recommendation

**Use USDA FoodData Central (free, CC0) + Open Food Facts (free, ODbL, barcode scanning) + a hand-curated Indian dish collection seeded from the Indian Nutrient Databank (INDB, CC BY) as your primary stack.** Skip Nutritionix (free tier killed in 2026) and Spoonacular (50 pts/day is unusable) entirely. Consider Edamam ($14/mo) only if you specifically want its NLP parser, and FatSecret Basic (free, 5,000 calls/day) only for supplemental US/generic coverage — its India-specific dataset is paywalled behind Premier.

No mainstream commercial API has strong native Indian-dish coverage. This is the single most important finding: **every comparable open-source Indian tracker project converged on the same pattern** — generic Western APIs for backbone coverage, Open Food Facts for barcodes, and a hand-built/curated Indian dish table as the highest-priority lookup.

## A.1 USDA FoodData Central

- **Free tier:** 1,000 req/hour/IP with a free `api.data.gov` key (no cost, no paid tier exists — pure government service). `DEMO_KEY` gives ~30/hr, 50/day.
- **Pricing:** None — entirely free, no commercial tier.
- **Auth:** `api_key` query parameter.
- **Coverage — general:** Foundation Foods, SR Legacy, FNDDS (Survey foods), Branded Foods (~300K–2M items, heavy US retail skew).
- **Coverage — Indian foods (live-tested 2026-09-06):** dal (1 hit), biryani (3 hits: veg/chicken/meat), idli (1), dosa (2), chapati/roti (2, tagged "Indian bread, NFS"), samosa (1). **naan and sabzi returned zero hits.** Paneer as a dish: 0 hits; as a branded US cheese product: 46 hits. Coverage exists (FNDDS is built from NHANES surveys which include immigrant diets) but is one-entry-deep with no regional variants — not sufficient as a sole Indian source.
- **Barcode/UPC:** Branded Foods has a `gtinUpc` field but no dedicated barcode-lookup endpoint — requires fuzzy full-text search. Weak in practice.
- **Commercial/personal use:** Both fully allowed. Public domain, **CC0 1.0**. Attribution requested, not required.
- **Response shape (live example):**
```json
{ "totalHits": 29,
  "foods": [{
    "fdcId": 2707713,
    "description": "Bread, chappatti or roti",
    "dataType": "Survey (FNDDS)",
    "foodNutrients": [
      {"nutrientName":"Protein","unitName":"G","value":7.85},
      {"nutrientName":"Energy","unitName":"KCAL","value":299}]}]}
```
- **Endpoints:** `https://api.nal.usda.gov/fdc/v1/` → `/foods/search`, `/food/{fdcId}`, `/foods`, `/foods/list`

## A.2 Open Food Facts

- **Free tier:** No key/quota system. Fair-use limits: 15 req/min/IP (product reads), 10 req/min/IP (search). Requires a descriptive `User-Agent` header.
- **Pricing:** None — nonprofit, fully open, no paid tier.
- **Auth:** None for reads; account needed for writes.
- **Coverage — general:** 4M+ crowdsourced barcoded products across 150 countries, strongest in EU.
- **Coverage — India:** **22,855 products** on `in.openfoodfacts.org` (live-checked 2026-09-06), up from a [10,000-product milestone in Sept 2024](https://blog.openfoodfacts.org/en/news/open-food-facts-india-database-reaches-10k-product-milestone). This is packaged/branded goods only (MTR, Haldiram's, packaged paneer, snacks) — **home-cooked dal/sabzi/roti will never appear here.** Complements, doesn't replace, a dish-level Indian data source.
- **Barcode/UPC:** Core feature of the product. India coverage moderate and growing.
- **Commercial/personal use:** Both allowed. Database under **ODbL**, content under DbCL, images CC BY-SA — includes explicit commercial-use permission, conditioned on attribution + share-alike.
  - ⚠️ **ODbL share-alike caveat:** merging OFF data into your own DB can force the merged DB to also be ODbL-licensed. Irrelevant for a private single-user app, but keep OFF data in a separate collection if you ever go commercial/closed-source.
- **Response shape (live example):**
```json
{ "code": "3017620422003",
  "product": {
    "product_name": "Nutella t.400",
    "nutriments": {"energy": 2252, "fat": 30.9, "proteins": 6.3},
    "ingredients_text": "Sugar, palm oil, hazelnuts..."}}
```
- **Endpoints:** `https://world.openfoodfacts.org` (India-scoped: `https://in.openfoodfacts.org`) → `/api/v2/product/{barcode}.json`, `/api/v2/search`

## A.3 Nutritionix — ⚠️ free tier removed in 2026

- **Free tier: NONE.** Their own developer homepage states: *"we are no longer able to maintain a public free-access tier"* due to abuse — this reverses what most tutorials/blog posts still say. The `/pricing` page 404s; `/business/api` redirects to the homepage.
- **Pricing:** No published self-serve tier in 2026. Third-party cost comparisons cite **Enterprise from ~$1,850/month** — **UNVERIFIED**, contact-sales only.
- **Auth:** `x-app-id` + `x-app-key` headers.
- **Coverage:** ~1.9M items, best-in-class for US branded/restaurant-chain foods. Its differentiator is the natural-language endpoint (`POST /v2/natural/nutrients`), which parses "2 eggs and toast" well for US/Western phrasing.
- **Indian coverage:** Real developers building Indian trackers explicitly route around it — one project forces its LLM to first normalize to Indian units (katori/chapati/handful) before calling Nutritionix; another hardcodes a local Indian-dish table as a higher-priority fallback than Nutritionix, Edamam, and USDA combined ([source](https://github.com/hemantsibal/fitness-tracker/blob/main/server/src/services/indianFoodDefaults.ts)).
- **Barcode/UPC:** Yes, `GET /v2/search/item?upc={upc}`, US-centric.
- **Commercial/personal use:** Effectively enterprise-only now — no hobbyist path.
- **Verdict: skip.** No accessible free tier makes this a non-starter for a personal project.

## A.4 FatSecret Platform API

- **Free tier ("Basic"):** **5,000 API calls/day, free self-signup, commercial use explicitly permitted** — but the **free tier is US-dataset-only**.
- **Pricing:** Premier tiers have no public $ figure (contact sales). "Premier Free" (startups &lt;$1M revenue/raised, non-profits, students) is still US-only. **"Premier Paid" unlocks 58+ country datasets including India** — this is where real Indian food data lives, and it's gated behind a paid, custom-priced plan. Exact $ **UNVERIFIED**.
- **Auth:** OAuth 2.0 client-credentials for general access; OAuth 1.0 (HMAC-SHA1, 3-legged) for user-scoped data like food diaries — more integration work than a simple API key.
- **Coverage:** ~1.9M items, including real restaurant/menu data, among the most internationally complete platforms overall.
- **Indian coverage:** India (`IN`) is a listed supported region in FatSecret's Premier localization, and `fatsecret.co.in` is a live India-localized site — genuine India data exists, but **not on the free tier**.
- **Barcode/UPC:** Supported; Indian EAN depth **UNVERIFIED**.
- **Commercial/personal use:** Both allowed on Basic (with attribution); no attribution needed on paid Premier.
- **Response shape:**
```json
{ "foods": { "food": [{
    "food_id": "35718", "food_name": "Apple", "food_type": "Generic",
    "food_description": "Per 100g - Calories: 52kcal | Fat: 0.17g | Carbs: 13.81g | Protein: 0.26g"}]}}
```
  Note: macros come back as a flat string on search results — a second `food.get` call is needed for structured detail.
- **Endpoints:** `https://platform.fatsecret.com/rest/` → `/foods/search/v1`, `/food/v4`, `/food-entries/v2`
- **Verdict:** worth adding as a free supplemental US/generic source (5,000 calls/day, no cost) if useful, but don't expect its Indian data without paying.

## A.5 Edamam Food Database API — free tier is vestigial/unclear in 2026

- **Free tier:** **Conflicting evidence.** The live pricing page shows no $0 tier (cheapest listed is Enterprise Basic at $14/mo with a 30-day trial requiring a card). Edamam's own FAQ still references a free "Minimum Service" plan with unpublished, "very limited" quota. The commonly-quoted "$0/mo, 1,000 req/day" figure found in older blog posts is **stale — do not plan around it.** Your suspicion that they changed pricing is correct.
- **Pricing (live, confirmed):**
  | Plan | Price | Quota |
  |---|---|---|
  | Enterprise Basic | $14/mo | 100,000 calls/mo + 500 Vision calls |
  | Enterprise Core | $69/mo | 750,000 calls/mo |
  | Enterprise Plus | $299/mo | 5,000,000 calls/mo |
  | Enterprise Unlimited | Custom | Unlimited |
  Food Database, Nutrition Analysis, and Recipe Search are billed as **separate products**.
- **Auth:** `app_id` + `app_key` query params.
- **Coverage:** ~900,000 foods, ~130,000 branded/restaurant items, NLP parsing + barcode (700,000+ UPC/ITN/EAN codes).
- **Indian coverage:** Rated "Weak" in an independent 2026 side-by-side evaluation ([Pathyam dossier](https://github.com/musicofthings/pathyam/blob/main/PATHYAM_RESEARCH_DOSSIER.md)) of commercial APIs. No corroborating evidence of good dal/paneer/biryani coverage was found. **Partly UNVERIFIED** — test `/parser?ingr=paneer` on a trial key before committing.
- **Commercial/personal use:** Free tier is explicitly restricted to **personal or not-for-profit use** — fine for this project. Paid plans require attribution; scraping/bulk collection is banned; there are caching restrictions (returned data mostly shown only to the requesting end user).
- **Verdict:** only worth it at $14/mo if you specifically want the NLP parser; otherwise skip — weak Indian coverage and unclear free access.

## A.6 Spoonacular

- **Free tier:** **$0/mo, 50 points/day** (not the commonly-quoted 150/day — that figure is outdated), 1 req/sec, 2 concurrent, mandatory backlink, HTTP 402 when exhausted. Points ≠ requests — nutrition-enriched searches cost more than 1 point, making 50/day very tight in practice.
- **Pricing:** Cook $29/mo (1,500 pts/day) · Culinarian $79/mo (4,500 pts/day) · Chef $149/mo (10,000 pts/day) · Enterprise from $300/mo.
- **Auth:** `apiKey` query parameter.
- **Coverage:** Recipe-first API — 5,000+ recipes, 2,600+ ingredients, 600,000+ grocery products, 115,000+ menu items from 800+ **American** restaurant chains.
- **Indian coverage:** `complexSearch` supports `cuisine=indian` as a filter, so Indian recipes are tagged and retrievable, but dish-level nutrition accuracy is **UNVERIFIED**; independently rated "Weak" for Indian regional coverage by the Pathyam dossier. Its restaurant/menu and barcode databases are explicitly US-only — assume zero Indian barcode coverage.
- **Commercial/personal use:** Allowed at any paid tier; free tier requires attribution/backlink. Notable restriction: **max 1-hour cache** on most data (recipe IDs/titles/images can be cached indefinitely) — a real constraint if you want to store logged meals long-term without re-fetching.
- **Verdict: skip.** 50 pts/day is impractical for daily logging, and Indian coverage is weak.

## A.7 Indian-specific food composition data

**IFCT 2017 (Indian Food Composition Tables, ICMR/NIN):**
- No official API. Only a static PDF: `https://www.nin.res.in/ebooks/IFCT2017.pdf`.
- Coverage: sources conflict — official ICMR press release says "586 varieties," while the academic/derived-tool consensus (used by `nodef/ifct2017`, PMC papers) says **528 key foods** (~150 nutrient components each: macros, vitamins, minerals, amino acids, fatty acids, phytochemicals). Raw/semi-processed ingredients only — **no cooked dishes**.
- **Licensing is NOT public domain** — ICMR/NIN copyright explicitly restricts electronic reproduction "for creating a product" without written permission. This matters if you embed the data in an app.
- Digitized version: **[nodef/ifct2017](https://github.com/nodef/ifct2017)** — TS/JS package with CSV/SQL/query API, 56 stars, last pushed 2025-06-24 (actively maintained). Code is AGPL-3.0 (relicensed from MIT in April 2025), but the underlying IFCT data still carries NIN's copyright restriction — redistribution legality is murky.

**Indian Nutrient Databank (INDB) — the recommended primary Indian source:**
- **[lindsayjaacks/Indian-Nutrient-Databank-INDB-](https://github.com/lindsayjaacks/Indian-Nutrient-Databank-INDB-)** (mirrored at [Anuvaad](https://www.anuvaad.org.in/indian-nutrient-databank/)), from a peer-reviewed methodology paper (Vijayakumar, Dubasi, Awasthi, Jaacks, *Current Developments in Nutrition*, June 2024, [PMC11277795](https://pmc.ncbi.nlm.nih.gov/articles/PMC11277795/)).
- **1,095 individual food items + 1,014 recipes** (dal makhani, biryani, sabzi, etc. as actually prepared, using retention-factor-adjusted cooking losses) with 40+ nutrients, values per 100g and per serving.
- **Explicit CC BY license** — genuinely open, unlike raw IFCT or the AGPL-wrapped `nodef/ifct2017`.
- Built on IFCT 2017 as its backbone, gap-filled with UK/USDA data for ~150 items IFCT doesn't cover.
- Actively maintained (commits/updates as recent as 2025–2026).
- **Recommendation: use INDB as your primary Indian-dish seed data**, supplemented by `nodef/ifct2017`'s CSV for raw single ingredients (specific dals, flours, spices) INDB doesn't itemize.

**Kaggle datasets (secondary/convenience only — weaker provenance):**
| Dataset | Items | Notes |
|---|---|---|
| [Indian Food Nutritional Values (2025)](https://www.kaggle.com/datasets/batthulavinay/indian-food-nutrition) | 250+ | Explicitly sourced from INDB, cleaned |
| [Indian Food Nutrition (syedkhalid076)](https://www.kaggle.com/datasets/syedkhalid076/indian-food-nutrition) | unspecified | Dec 2022 |
| [Indian Recipes: Nutrition & Cooking method (2026)](https://www.kaggle.com/datasets/kashyap077/indian-recipes-ingredients-nutrition-and-cooking) | 725 | Creator flags "research/educational use only" |
| [ifct2017 (gijoe707)](https://www.kaggle.com/datasets/gijoe707/ifct2017) | ~528 | Re-upload of IFCT2017, unclear license |

Engagement metrics (votes/downloads) could not be independently verified for any of these — treat as convenience mirrors, not sources of truth.

**data.gov.in:** no usable food-composition dataset found (portal returned 403 to automated access) — likely nothing there, unconfirmed.

## A.8 What existing trackers do for Indian food

- **MacroFactor:** Licensed data — USDA FDC + manufacturer labels + NCC Food and Nutrient Database + human-vetted user submissions (~1.15–1.36M entries). Their own help center lists regions with "excellent" coverage (US, Canada, UK, Australia, Ireland, NZ, Japan, France, Spain) — **India is not mentioned at all**, implying weak coverage; no API.
- **Cronometer:** Curated — USDA SR + NCCDB + Canadian Nutrient File + moderated community submissions (~1.1M foods, deliberately smaller than MyFitnessPal for accuracy). Documented gap: a Cronometer forum thread shows a user flagging missing Amul paneer, staff confirming only partial coverage and directing to manual submission — gaps filled reactively/slowly. No public API.
- **HealthifyMe:** The only one with genuinely proprietary Indian-first data — officially ~4,000+ Indian foods (older figure), third-party reviews cite 10,000+ (**unverified against a current official source**). Their AI photo-logging model ("Snap") was trained on 150,000 Indian food items/dishes specifically for thali-style mixed plates, launched at 60–70% accuracy per their CEO (TechCrunch, Sept 2023). Recurring user complaints about portion-size estimation. **No public API** — entirely walled off, B2B wellness offering only.

**Takeaway:** none of the three exposes a usable API. HealthifyMe has by far the deepest Indian dataset and it's completely inaccessible. This reinforces that building your own curated Indian dish table (seeded from INDB) is the only real path.

## A.9 LLM-based food logging (Claude API): text parsing + photo logging

### Cost (verified, Anthropic official pricing, 2026-09-06)

| Model | Input | Output |
|---|---|---|
| Claude Haiku 4.5 | $1.00/MTok | $5.00/MTok |
| Claude Sonnet 5 | $2.00/MTok | $10.00/MTok (made permanent; the planned Sep 2026 hike to $3/$15 was cancelled) |
| Claude Opus 5 | $5.00/MTok | $25.00/MTok |

Image tokens: `tokens = ⌈width/28⌉ × ⌈height/28⌉`, capped at 1568 tokens (standard tier, most models) or 4784 tokens (high-res tier). A 1MP photo ≈ 1,296 tokens.

**Estimated cost per log:**
- Text parsing ("2 eggs and toast"): Sonnet 5 ≈ **$0.0036/log**, Haiku 4.5 ≈ **$0.002/log**
- Photo logging (1 plate photo, resized to ~1–2MP): Sonnet 5 ≈ **$0.007/log**, Haiku 4.5 ≈ **$0.003/log**

**At 4 text logs + 1 photo/day: ~$0.02/day (~$0.60/month) on Sonnet 5, or ~$0.33/month on Haiku 4.5.** Cost is a non-issue at personal-project scale even with the most expensive model.

### Accuracy — text-based parsing

- **NutriBench** (ICLR 2025 workshop, [arXiv:2407.12843](https://www.arxiv.org/abs/2407.12843v4)) — first public benchmark for LLM nutrition estimation from natural-language descriptions (11,857 descriptions, 24 countries). Best result: **66.8% accuracy with chain-of-thought prompting** (GPT-4o); ~80% of remaining errors traced to bad carb estimates, not misidentified foods.
- A comparative study ([arxiv.org/pdf/2312.08592](https://arxiv.org/pdf/2312.08592)) found LLM estimates "comparable but significantly faster" than expert dietitian manual assessment — in the right ballpark, not more accurate than a trained professional.

### Accuracy — photo-based logging

- **Peer-reviewed head-to-head study, 2025** ([PMC12513282](https://pmc.ncbi.nlm.nih.gov/articles/PMC12513282/) / [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2475299125030185)), n=52 photos, ground truth via calibrated-scale weights + USDA nutrition data:

  | | ChatGPT-4o | Claude 3.5 Sonnet | Gemini 1.5 Pro |
  |---|---|---|---|
  | Weight MAPE | 36.3% | 37.3% | 65.0% |
  | Energy MAPE | 35.8% | 35.8% | 64.2% |
  | Protein MAPE | 60.7% | 61.7% | 109.9% |

  All three models **systematically underestimated portions, worse as portions got larger.** Authors' conclusion: "general-purpose LLMs are not yet suitable for precise dietary assessment in clinical or athletic populations," though accuracy is "comparable with traditional self-reported dietary assessment methods."
- Foundational academic references: Google's **Nutrition5k** (2021, ~5,000 US cafeteria dishes with scale-measured ground truth — no Indian dishes) and the original **Im2Calories** (2015) paper, which established portion/volume estimation from a single 2D photo as the core unsolved bottleneck.
- **Commercial app claims (anecdotal/unverified):** SnapCalorie claims ~15–20% error using depth-sensor 3D capture + human QA (not pure photo-LLM); Foodvisor claims 87% accuracy (one independent test found ~16.2% MAPE, with accuracy reportedly dropping sharply for non-European cuisines); Cal AI has no published validation and Reddit/review consensus pegs it at "10–30% error depending on the dish," worse on mixed dishes and hidden oils.
- **General consensus across all sources:** photo-based estimation runs **~25–40% MAPE for general-purpose LLMs (GPT-4o/Claude-tier), 15–20% for specialized apps with depth sensors + human review, 40–110%+ for weaker models or hard cases** (mixed dishes, hidden fats). Food *identification* is reliably good (~90%+); *portion/volume* estimation is the dominant error source.

### The Indian-food-specific problem: hidden oil/ghee

1 tsp ghee ≈ 45 kcal, 1 tbsp oil ≈ 120 kcal; a home-cooked sabzi/curry can easily use 3–4 tbsp oil across servings — **completely invisible in a photo**, and cited as causing 30–50% real-world calorie variance for the same-looking dish. No model can infer this from pixels alone.

**Practical recommendations (synthesized, not from one single source):**
1. Always ask a follow-up question for wet dishes: "how much oil/ghee, or was this a restaurant meal (usually more oil)?" — addresses the single largest hidden-error source.
2. Use reference-object-for-scale (a standard katori/bowl, a coin, "small vs. large plate") since 2D photos have no depth cue — several Indian calorie tools already build UI around katori/plate-size selectors.
3. Treat photo logging as a **secondary/convenience path**, with text logging (cheaper, comparably accurate per NutriBench) as primary — always surface an editable structured breakdown rather than silently trusting the number.
4. Given the documented systematic underestimation of large portions, consider a light "does this look bigger than average?" nudge for large-portion photos.

**Recommendation: build both features.** Cost is negligible (well under $1/month at your usage level). Use Claude Sonnet 5 as the default model for both (it performed best of the three tested in the peer-reviewed comparison). Expect ~30–40% MAPE on photo logs of home-cooked Indian meals — good enough for trend-tracking, not clinical precision — and mitigate with the oil/ghee follow-up question and always-editable output.

---

# PART B — EXERCISE / TRAINING DATA

## B.0 Headline recommendation

**Seed your MongoDB `exercises` collection once from [yuhonas/free-exercise-db](https://github.com/yuhonas/free-exercise-db)** (876 exercises, public domain, actively maintained, real photos included) rather than depending on any live API. For programming logic, implement **GZCLP or the r/Fitness Basic Beginner Routine** first — both have AMRAP sets and clean, well-documented progression rules that map directly to code — and design your Set schema to support `type: warmup|normal|dropset|failure|amrap` plus both RPE and RIR fields, mirroring Hevy's data model (the only app in this category with a real public API/OpenAPI spec).

## B.1 Open-source exercise databases

### free-exercise-db (yuhonas/free-exercise-db) — recommended

- **876 exercises** (verified by downloading and parsing the actual JSON), the actively-maintained successor to the older `wrkout/exercises.json`.
- **Images:** real JPEGs (1–2 per exercise, ~38KB each) hosted in the repo. **No GIFs/video.**
- **Metadata:** name, force (push/pull/static), difficulty level, mechanic (isolation/compound), equipment (13 types), primary + secondary muscles (17 types), step-by-step instructions, category (7 types: strength, cardio, stretching, powerlifting, olympic weightlifting, strongman, plyometrics).
- **License: The Unlicense (public domain)** — zero attribution burden.
- **Maintenance:** last commit **2026-08-30**, 1,842 stars, 480 forks — actively maintained.
- **Example entry:**
```json
{ "id": "3_4_Sit-Up", "name": "3/4 Sit-Up", "force": "pull", "level": "beginner",
  "mechanic": "compound", "equipment": "body only",
  "primaryMuscles": ["abdominals"], "secondaryMuscles": [],
  "category": "strength", "images": ["3_4_Sit-Up/0.jpg", "3_4_Sit-Up/1.jpg"] }
```
- **Cost:** free (static JSON, no ongoing API dependency).

### wger — solid live alternative, more infrastructure

- Self-hostable Django app. Public API: `https://wger.de/api/v2/`, **871 exercises** (live-verified), reads work **without auth**.
- Rich nested data: muscles (with SVG diagrams), equipment, images (multiple sizes, `is_ai_generated` flag), multi-language translations, videos array. Image coverage is inconsistent across exercises (many empty).
- **License:** wger codebase AGPL-3.0; exercise *content* is per-item licensed (CC-BY-SA 3.0/4.0, CC-BY 4.0, CC0, or ODbL) — attribution requirements vary exercise-by-exercise if redistributed.
- Actively maintained (repo pushed 2026-09-05, 6,849 stars).
- Trade-off vs. free-exercise-db: no vendor risk since it's free/no-auth, but introduces a live-API dependency and per-item license tracking that a personal project doesn't need.

### ExerciseDB (RapidAPI)

- ~1,300 exercises with GIFs (third-party-reported, RapidAPI's own pricing page is JS-rendered and couldn't be fetched directly — **partly unverified**).
- Free tier heavily rate-limited (conflicting reports: 10 req/min vs. 10 req/day). Paid tiers roughly $10–15/mo (3,000 req) up to $50+/mo (35,000 req), pricing reportedly unstable over time.
- Requires ongoing RapidAPI subscription — reintroduces exactly the vendor/cost/rate-limit risk a personal project should avoid.
- Note: a separate, unrelated **open-source** self-hostable project also called ExerciseDB exists ([exercisedb/exercisedb-api](https://github.com/exercisedb/exercisedb-api), AGPL-3.0, 11,000+ exercises claimed, pushed 2025-11-25) — more infrastructure than needed here, but worth knowing it's distinct from the paid RapidAPI product.

### Everkinetic — confirmed dead/abandoned

- Original site (`everkinetic.com`, `db.everkinetic.com`) is unreachable as of 2026-09-06.
- Data survives on GitHub: [everkinetic/data](https://github.com/everkinetic/data), 293 exercises, last commit **2022-02-20** (4.5+ years stale). CC BY-SA 4.0.
- A maintained fork exists — [bryllim/workout-guide](https://github.com/bryllim/workout-guide), 302 exercises, MIT-licensed wrapper (underlying art still CC BY-SA, attribution required), actively maintained (pushed 2026-08-26). Smaller/less mature than free-exercise-db — not recommended as primary.

### Verdict

Use **free-exercise-db**: no API key, no rate limits, no vendor risk, genuinely public domain, actively maintained, includes real photos you can bulk-download once and self-host.

## B.2 Data modeling for strength-training apps

Of the four apps researched, only **Hevy** has a real public API with a documented OpenAPI spec — treat its schema as the reference model.

- **Hevy** (Pro-gated API, [docs](https://api.hevyapp.com/docs/), [OpenAPI spec mirror](https://github.com/chrisdoc/hevy-mcp/blob/main/openapi-spec.json)): `Routine`/`Workout` → `Exercise` (with `supersets_id`, `rest_seconds`) → `Set` (`type`: normal/warmup/dropset/failure, `weight_kg`, `reps`, `rpe`, plus distance/duration for cardio).
- **Strong**: no API, CSV export only (`Date, Workout Name, Duration, Exercise Name, Set Order, Weight, Reps, Distance, Seconds, RPE`) — notably has **no set-type or superset column**, and no explicit unit column (a footgun to avoid in your own schema).
- **Boostcamp**: no public API/docs; a community-reverse-engineered MCP server confirms a private API exists but no field-level schema was recoverable. Product pages confirm a Program → Week → Day → Exercise → Set hierarchy, and it's the only app treating **RIR as first-class alongside RPE**.
- **Jefit**: no API; reverse-engineered from SQLite backups, which pack all sets into one denormalized string per exercise (e.g. `"100x10,110x8,120x6"`) — a clear example of what *not* to do.

### Recommended MongoDB schema (synthesized from the above)

```jsonc
// exercises (reference/lookup)
{ _id, name, aliases: [String], category, equipment, primaryMuscles: [String],
  secondaryMuscles: [String], isBodyweight, bodyweightPercentage,
  trackingFields: ["weight","reps"], isCustom, notes }

// programs (template)
{ _id, name, durationWeeks, daysPerWeek, isActive,
  weeks: [{ weekIndex, days: [{ dayIndex, name,
    exercises: [{ exerciseIndex, exerciseId, supersetGroup, restSeconds,
      targetSets: [{ setIndex, type: "warmup|normal|dropset|failure|amrap",
        targetRepRange: {min,max}, targetWeightKg, targetPercentOf1RM,
        targetRpe, targetRir }] }] }] }] }

// loggedWorkouts (sets embedded, not a separate collection)
{ _id, title, programId, programDayRef: {weekIndex, dayIndex},
  startTime, endTime, bodyweightKg,
  exercises: [{ exerciseIndex, exerciseId, exerciseTitleSnapshot, supersetGroup,
    sets: [{ setIndex, type, weightKg, reps, distanceMeters, durationSeconds,
      rpe, rir, isPersonalRecord, completedAt }] }] }
```

Key decisions: store canonical SI units (kg/meters/seconds) — Strong's export is unitless and ambiguous, avoid that; use Hevy's `type` enum plus `amrap` (needed — 4 of 5 beginner programs below use AMRAP sets); keep both `rpe` and `rir` as separate optional fields; embed sets inside `loggedWorkouts` rather than a separate collection unless per-set cross-workout analytics become a real bottleneck (unlikely at personal-project scale); denormalize `exerciseTitleSnapshot` so history survives exercise renames.

## B.3 Beginner strength programs — progression rules precise enough to code

⚠️ Notation traps exist across sources — Starting Strength writes reps×sets, GZCLP's original post writes weight×reps×sets, others write sets×reps. Verify before transcribing.

### StrongLifts 5×5 ([source](https://stronglifts.com/stronglifts-5x5/))
- **A:** Squat 5×5, Bench 5×5, Row 5×5. **B:** Squat 5×5, OHP 5×5, **Deadlift 1×5**. Alternate A/B, 3×/week non-consecutive.
- Start at empty bar (Squat/Bench/OHP); Deadlift/Row start heavier.
- Progression: **+5 lb/session** on Squat/Bench/OHP/Row, **+10 lb** on Deadlift (drop to +5 when it gets hard) — evaluated **per exercise independently**.
- Failure: repeat same weight next session. After **3 consecutive failures** (exact threshold has minor ambiguity in the source — implement as a constant, default 3): **−10%** deload, work back up. Deloads are per-lift.

### Starting Strength ([source](https://startingstrength.com/get-started/programs))
- Three phases, not a static A/B. Phase 1: Squat 3×5, Press/Bench (alternating **across sessions**) 3×5, Deadlift 1×5. Phase 2 adds Power Clean 5×3 on day B. Phase 3 adds Chin-ups. **No barbell row; deadlift never 3×5.**
- **Increment is a decaying ladder, not a constant:** Squat +10 lb for first 2–3 sessions then +5 lb; Deadlift +15–20 lb then +10 lb then +5 lb; Press/Bench mostly +5 lb, later microloading to 2.5 lb. (The popular "+5 lower/+2.5 upper flat rule" is NOT Starting Strength — that's the r/Fitness BBR rule below; don't conflate them.)
- Failure: miss → repeat weight; miss again (**2 consecutive**, fewer than StrongLifts' 3) → deload 8–10%; after 2–3 deloads and another stall, linear progression is exhausted for that lift → move to Texas Method (weekly progression: Monday volume 5×5 @ ~90% of Friday's new 5RM, Wednesday light 2×5 @ 80% of Monday, Friday new 5RM single).

### GZCLP ([source](https://www.reddit.com/r/Fitness/comments/44hnbc/), [wiki mirror](https://thefitness.wiki/routines/gzclp/))
- 4-day rotation run 3×/week. T1 (main lift) / T2 (secondary lift) / T3 (accessory) per day.
- **T1 stages:** 5×3+ (base 15 reps) → 6×2+ (base 12) → 10×1+ (base 10). "+" = AMRAP at 1–2 RIR, capped at 10 reps even if more are possible. Add weight every session base volume is met (+5 lb Bench/OHP, +10 lb Squat/Deadlift); fail base volume → advance to next stage **at the same failed weight** (carried forward, per the original post). After failing Stage 3 → rest, test new 5RM, restart Stage 1 at 85% of new 5RM.
- **T2 stages:** 3×10 (30) → 3×8 (24) → 3×6 (18), no AMRAP. Add weight every session; fail → next stage. After failing 3×6, restart 3×10 heavier than the previous 3×10 weight (+15–20 lb, capped at +20 lb/+9 kg — sources give slightly different framing but agree on the number).
- **T3:** 3×15+, single stage, no ladder. Add weight when the AMRAP set reaches 25 reps.

### 5/3/1 for Beginners ([source](https://www.jimwendler.com/blogs/jimwendler-com/5-3-1-for-beginners), corroborated by [thefitness.wiki](https://thefitness.wiki/routines/5-3-1-for-beginners/))
- Training Max (TM) = **90% of estimated 1RM** (Wendler's own article is vague on the exact %; every fully-specified implementation uses 90% — treat as a configurable default).
- **3-week cycle, no deload week** (differs from standard 5/3/1's 4-week cycle):
  - Week 1: 5@65%, 5@75%, **5+@85%**, then 5×5 @65% (FSL)
  - Week 2: 3@70%, 3@80%, **3+@90%**, then 5×5 @70% (FSL)
  - Week 3: 5@75%, 3@85%, **1+@95%**, then 5×5 @75% (FSL)
  - ⚠️ FSL ("first set last") is **5×5**, not 5×10 — confirmed by three independent sources.
- 3 days/week, two main lifts/day, each lift cycling its own week 1→2→3 by how many times it's been trained.
- TM progression after each 3-week cycle: **+5 lb Bench/Press, +10 lb Squat/Deadlift** — fixed regardless of AMRAP rep count. Stall rule (wiki addition): missed reps for a full cycle → cut TM by 3 cycles' worth (**−15 lb upper / −30 lb lower**).

### r/Fitness Basic Beginner Routine ([source](https://thefitness.wiki/routines/r-fitness-basic-beginner-routine/))
- A/B alternating, 3×/week. **A:** Row 3×5+, Bench 3×5+, Squat 3×5+. **B:** Chin-ups 3×5+, OHP 3×5+, **Deadlift 3×5+** (unlike SS/StrongLifts' 1×5 — intentional per source).
- 3rd set of every exercise is AMRAP at 1–2 RIR.
- Progression: **+2.5 lb/session upper** (Bench/OHP/Row/Chin-up), **+5 lb/session lower** (Squat/Deadlift). If AMRAP exceeds 10 reps, jump the next tier (+5 upper/+10 lower) instead.
- Deload: if total reps across the 3 sets fall **below 15**, deload that lift −10% next session (5+5+4=14 triggers; 5+5+5=15 doesn't).
- Exit criteria: run max 3 months, then move to GZCLP or 5/3/1 for Beginners.

### Cross-cutting implementation notes
- Failure thresholds genuinely differ per program (StrongLifts 3 fails, Starting Strength 2 fails, GZCLP advances stage on 1 fail with no cut until the ladder is exhausted, BBR triggers on total-rep count, 5/3/1 triggers on a full missed cycle) — don't build one shared rule.
- Deloads are always per-lift, never program-wide.
- Increment models split into fixed constants (StrongLifts, GZCLP, BBR, 5/3/1 TM) vs. a decaying ladder keyed on session count (Starting Strength only) — your progression engine needs to support both patterns.
- `type: "amrap"` with a reps-achieved value must be first-class in your Set schema — it drives progression logic in GZCLP T1/T3, 5/3/1, and BBR.
- **Recommendation: implement GZCLP or BBR first** — both have the cleanest, most unambiguous, best-documented progression rules of the five, and both are explicitly designed as "second programs" after an initial linear-progression phase, which suits a tracker aiming to grow with the user.

## B.4 Evidence-based training consensus for beginners (2024–2026)

| Variable | Beginner default | Confidence |
|---|---|---|
| Weekly sets/muscle | **~6–10** (not the 10–20 range popularly cited for intermediates/advanced) | High — RP's own Volume Landmarks framework argues MEV sits close to maintenance volume for novices; corroborated by Pelland et al. 2025/2026 dose-response meta-regression (*Sports Medicine*, 67 studies, 2,058 subjects) showing diminishing returns are steep even at low set counts |
| Frequency | **Full-body, 3×/week** | High — frequency itself doesn't change outcomes once volume is equated (Evangelista et al. 2021 novice-specific RCT, n=67; 2024 split-vs-full-body meta-analysis); full-body is the practical vehicle for low novice volume + more technique practice |
| RPE/RIR | Usable but not a sole autoregulation tool for true beginners; use concrete rep-in-reserve targets + periodic true-failure calibration | **Contested/evolving** — classic Zourdos et al. 2016 view says novices misjudge proximity to failure by ~4-5 reps; a Nov 2025 study (PMC13215226) found no significant novice-vs-experienced difference when objectively measured, suggesting "never trained near failure" (not novice status per se) is the real driver |
| Progression | **Session-based linear progression per lift**, with automatic detection of 2+ consecutive failures to trigger a slower model | High — well-established "novice effect"; duration is lift-specific and variable (roughly 3 months to 7-9 months depending on lift, upper body stalls sooner than lower body) |
| Rep range | **~5–12 reps** | High — hypertrophy is largely rep-range-agnostic when taken close to failure across a wide range; heavier loads (≤~7RM) retain a specificity edge for pure 1RM strength |
| Deload | Reactive/flexible rather than a rigid 4–8 week calendar for true beginners | Moderate/emerging — competitive-athlete surveys show ~5.6±2.3 week self-implemented cadence, but beginners accumulate fatigue more slowly and may not need it on the same schedule |

Key sources: RP Strength's Volume Landmarks article (rpstrength.com, foundational, still current reference); Pelland/Remmert/Robinson/Hinson/Zourdos dose-response meta-regression, *Sports Medicine* 2025/2026 (PubMed 41343037); Evangelista et al., *Einstein (São Paulo)* 2021 (PMC8372753); Zourdos et al. RIR-RPE validation, *JSCR* 2016 (PMC4961270); "Objective Accuracy in Estimating RIR in the Back Squat," Nov 2025 (PMC13215226); Bell et al. on deload practices, 2024–2025 preprints.

**App implication:** default new users to a full-body 3×/week template at ~6–10 sets/muscle/week and 5–12 reps, use linear per-lift progression with automatic stall detection, and treat RPE/RIR entries as low-confidence data until the user has logged a few true-failure reference points.

---

# Summary of flagged UNVERIFIED items

- Edamam's free "Minimum Service" tier: referenced in their FAQ but absent from the live pricing page — contradiction unresolved.
- Edamam and Spoonacular's actual dish-level accuracy for paneer/biryani/dal — needs live trial-key testing.
- Nutritionix enterprise pricing (~$1,850/mo) — third-party sourced only.
- FatSecret Premier $ pricing and Indian barcode (EAN) coverage depth.
- HealthifyMe's current official Indian food item count (4,000 official-but-old vs. 10,000+ third-party).
- ExerciseDB (RapidAPI) exact free-tier limits (10/min vs. 10/day — sources conflict) and current pricing (page is JS-rendered, couldn't be fetched directly).
- Boostcamp's field-level data schema (private API confirmed to exist via a community MCP server, but no schema recoverable).
- StrongLifts' exact numeric starting weights for Deadlift/Row (only published in an email-gated spreadsheet, not the public site).
- 5/3/1 for Beginners' exact TM percentage (Wendler's free article says "80-85%" vaguely; every full implementation found uses 90% — treat as configurable, not fixed fact).
