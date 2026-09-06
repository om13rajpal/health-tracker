# Health Tracker iOS Bridge App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ios/`, a minimal Swift/SwiftUI app whose entire job is bridging Apple HealthKit to the already-built backend: watch 5 quantity types (heart rate, steps, active energy, weight, VO2 max) for new samples via background delivery and POST them to `/api/health-events`, and separately poll for pending write-back requests and call `HKHealthStore.save()` for them. Almost no UI — one status screen.

**Architecture:** `HKObserverQuery` (fires on change) paired with `HKAnchoredObjectQuery` (fetches exactly the new samples since a persisted checkpoint) drives ingestion; a background `URLSession` upload task (not a plain data task — required for reliability when the app is suspended) delivers each sample; the anchor only advances after every sample in a batch confirms uploaded, so a failure retries the same samples next time rather than losing them. `BGAppRefreshTask` plus a scene-foreground trigger drive the write-back poll. One small backend addition (a `PendingWrite` model + two routes on the existing health-events router) is a prerequisite.

**Tech Stack:** Swift 6.3, SwiftUI with the `@Observable` macro (not `ObservableObject`), iOS 17 minimum deployment target, Xcode 26.6, no third-party dependencies — everything is built on first-party HealthKit/Foundation/SwiftUI APIs.

**Spec:** `docs/superpowers/specs/2026-09-06-health-tracker-design.md` — this plan implements build-sequence step 4 (§9) and the write-back half of the data flow in §4.2.

## Global Constraints

- Swift 6.3 / Xcode 26.6 / iOS 17+ deployment target throughout. `@Observable` (Observation framework), not `ObservableObject`/`@Published`, for every view model.
- The backend prerequisite (Task 1) reuses the EXISTING `api/src/modules/health-events/health-events.routes.ts` file and its already-correct patterns exactly — it does NOT rewrite the existing `POST /` handler, does NOT introduce a new env var (`MCP_ACCESS_TOKEN` is the existing shared secret for this router, already wired via the per-request bearer-token wrapper `(req,res,next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req,res,next)` — backend-core's Task 7 found and fixed the exact bug of evaluating this once at router-registration time instead of per-request; the two new routes must use the identical wrapper, never a bare `requireBearerToken(TOKEN_CONSTANT)`), and does NOT invent a model name that doesn't exist (`HealthSample` is the existing ingested-sample model; `PendingWrite`, added by this task, is a distinct new model for the write-back queue, not a rename of anything existing). Every test in this task uses `createApp()` fresh per test (a factory function, matching every other test in `api/`) — there is no module-level `app` singleton to import.
- HealthKit background delivery cannot be exercised in CI or the simulator. Only pure, I/O-free logic (sample normalization, anchor/last-sync persistence, upload-outcome determination, the write-back polling/ack orchestration against a mocked network+HealthKit layer) is unit-tested with XCTest. The real `HKObserverQuery`/`HKAnchoredObjectQuery`/background-`URLSession`/`HKHealthStore` calls are verified only by the manual procedure in the final task, on a physical device with a paid Apple Developer Program team.
- A background `URLSessionConfiguration.background` session only supports upload/download tasks, never plain data tasks — the health-event POST is implemented as `uploadTask(with:fromFile:)` (payload serialized to a temp file first), not `dataTask`, specifically because it can be triggered while the app is suspended.
- Per Apple's guidance, `HKObserverQuery`'s completion handler is always called — even on upload failure — to avoid HealthKit throttling future background deliveries. The persisted sync anchor is the only thing gated on success: it advances only once every sample in a batch is confirmed uploaded, so a failure re-delivers the identical sample set next time instead of silently losing it.
- Every sync failure that has a plausible root cause a user could act on (background delivery not authorized, HealthKit unavailable on this device) is surfaced in the status UI, not just logged to the console — a status screen that always says "Never synced" with no explanation whether that's "hasn't happened yet" or "fundamentally broken" defeats the point of having a status screen.
- Real secrets (the shared bearer token) are never committed to source control — `AppConfig.swift`'s placeholder values are filled in locally per the manual-verification task's prerequisites, not checked in with real values.

---

### Task 1: Backend prerequisite — pending-writes routes on the existing health-events router

**Files:**
- Create: `api/src/models/PendingWrite.ts`
- Modify: `api/src/modules/health-events/health-events.routes.ts` (existing router — ADD two new routes; do not touch the existing `POST /` handler)
- Modify: `api/src/modules/health-events/health-events.routes.test.ts` (existing test file — append new test suites)

**Interfaces:**
- Consumes: `requireBearerToken` from `api/src/lib/bearerAuth.ts` (existing), used via the SAME per-request wrapper pattern the existing `POST /` handler already uses — `(req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next)`. Consumes `createApp` from `api/src/app.ts` (existing, unchanged) for tests.
- Produces: `PendingWrite` Mongoose model (`{ metric: HealthMetric enum, value: Number, unit?: String, timestamp: Date, delivered: Boolean, deliveredAt?: Date }`) and two new endpoints on the existing `healthEventsRouter`: `GET /api/health-events/pending-writes` → `{id, metric, value, unit?, timestamp}[]` (undelivered only, oldest first) and `POST /api/health-events/pending-writes/:id/ack` → `{acked: true}`. The iOS app (Task 5) is coded exactly against this response shape.

- [ ] **Step 1: Write the failing tests for both new endpoints**

Append to `api/src/modules/health-events/health-events.routes.test.ts` (add `PendingWrite` to this file's existing imports):
```typescript
import { PendingWrite } from "../../models/PendingWrite.js";

describe("GET /api/health-events/pending-writes", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(createApp()).get("/api/health-events/pending-writes");
    expect(res.status).toBe(401);
  });

  it("returns only undelivered pending writes, oldest first", async () => {
    const undelivered = await PendingWrite.create({
      metric: "steps",
      value: 1200,
      timestamp: new Date("2026-09-01T10:00:00Z"),
      delivered: false,
    });
    await PendingWrite.create({
      metric: "weight",
      value: 70.2,
      unit: "kg",
      timestamp: new Date("2026-09-01T09:00:00Z"),
      delivered: true,
      deliveredAt: new Date(),
    });

    const res = await request(createApp())
      .get("/api/health-events/pending-writes")
      .set("Authorization", "Bearer test-ingestion-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: undelivered._id.toString(),
        metric: "steps",
        value: 1200,
        timestamp: "2026-09-01T10:00:00.000Z",
      },
    ]);
  });
});

describe("POST /api/health-events/pending-writes/:id/ack", () => {
  it("returns 401 without a bearer token", async () => {
    const res = await request(createApp()).post(
      "/api/health-events/pending-writes/000000000000000000000000/ack"
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(createApp())
      .post("/api/health-events/pending-writes/000000000000000000000000/ack")
      .set("Authorization", "Bearer test-ingestion-token");
    expect(res.status).toBe(404);
  });

  it("returns 400 for a malformed id", async () => {
    const res = await request(createApp())
      .post("/api/health-events/pending-writes/not-a-valid-id/ack")
      .set("Authorization", "Bearer test-ingestion-token");
    expect(res.status).toBe(400);
  });

  it("marks a pending write delivered", async () => {
    const doc = await PendingWrite.create({
      metric: "heart_rate",
      value: 62,
      unit: "count/min",
      timestamp: new Date("2026-09-01T10:00:00Z"),
      delivered: false,
    });

    const res = await request(createApp())
      .post(`/api/health-events/pending-writes/${doc._id.toString()}/ack`)
      .set("Authorization", "Bearer test-ingestion-token");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ acked: true });

    const updated = await PendingWrite.findById(doc._id);
    expect(updated?.delivered).toBe(true);
    expect(updated?.deliveredAt).toBeInstanceOf(Date);
  });
});
```
(This file's existing `beforeAll` already sets `process.env.MCP_ACCESS_TOKEN = "test-ingestion-token"` and connects to `mongodb-memory-server` — reuse it; add `PendingWrite.deleteMany({})` to the existing `afterEach`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && pnpm test`
Expected: FAIL — `PendingWrite` model doesn't exist, routes don't exist.

- [ ] **Step 3: Implement the `PendingWrite` model**

`api/src/models/PendingWrite.ts`:
```typescript
import { Schema, model } from "mongoose";

const pendingWriteSchema = new Schema({
  metric: {
    type: String,
    required: true,
    enum: ["heart_rate", "steps", "active_energy", "weight", "vo2max"],
  },
  value: { type: Number, required: true },
  unit: { type: String },
  timestamp: { type: Date, required: true },
  delivered: { type: Boolean, required: true, default: false },
  deliveredAt: { type: Date },
});

export const PendingWrite = model("PendingWrite", pendingWriteSchema);
```

- [ ] **Step 4: Add the two new routes to the existing router**

Modify `api/src/modules/health-events/health-events.routes.ts` — ADD the following below the existing `POST /` handler; do not modify that handler or its imports beyond adding what's needed here:
```typescript
import { z } from "zod";
import { PendingWrite } from "../../models/PendingWrite.js";

// ...(existing healthEventsRouter.post("/", ...) stays exactly as-is)...

healthEventsRouter.get(
  "/pending-writes",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (_req, res) => {
    const pending = await PendingWrite.find({ delivered: false }).sort({ timestamp: 1 });
    res.json(
      pending.map((doc) => ({
        id: doc._id.toString(),
        metric: doc.metric,
        value: doc.value,
        unit: doc.unit,
        timestamp: doc.timestamp.toISOString(),
      }))
    );
  }
);

const AckParamsSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{24}$/i, "id must be a valid Mongo ObjectId"),
});

healthEventsRouter.post(
  "/pending-writes/:id/ack",
  (req, res, next) => requireBearerToken(process.env.MCP_ACCESS_TOKEN ?? "")(req, res, next),
  async (req, res) => {
    const parsedParams = AckParamsSchema.safeParse(req.params);
    if (!parsedParams.success) {
      res.status(400).json({ error: parsedParams.error.flatten() });
      return;
    }

    const updated = await PendingWrite.findOneAndUpdate(
      { _id: parsedParams.data.id, delivered: false },
      { delivered: true, deliveredAt: new Date() },
      { returnDocument: "after" }
    );

    if (!updated) {
      res.status(404).json({ error: "Pending write not found" });
      return;
    }

    res.json({ acked: true });
  }
);
```
Note: `requireBearerToken` and `process.env.MCP_ACCESS_TOKEN` are already imported/used by the existing `POST /` handler in this file — do not add a duplicate import. `/pending-writes` and `/pending-writes/:id/ack` are distinct literal paths on the same router mounted at `/api/health-events`, so they cannot collide with the existing `POST /` regardless of declaration order.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd api && pnpm test && pnpm run build`
Expected: PASS, clean build. Confirm the full existing health-events test suite (the original `POST /` tests) still passes unchanged — this task must be purely additive.

- [ ] **Step 6: Commit**
```bash
git add api/src/models/PendingWrite.ts api/src/modules/health-events/health-events.routes.ts api/src/modules/health-events/health-events.routes.test.ts
git commit -m "feat: add pending-writes polling and ack endpoints for iOS write-back sync"
```

---

### Task 2: Xcode project scaffold

**Files:**
- Create: `ios/HealthBridge.xcodeproj` (generated by Xcode's New Project wizard, not hand-authored)
- Create: `ios/HealthBridge/HealthBridgeApp.swift`
- Create: `ios/HealthBridge/Info.plist`
- Create: `ios/HealthBridge/HealthBridge.entitlements`
- Create: `ios/HealthBridge/Assets.xcassets/` (default Xcode template contents)
- Create: `ios/HealthBridgeTests/` (empty target folder, populated starting Task 3)

**Interfaces:**
- Produces: bundle identifier `com.healthtracker.iosbridge`, deployment target iOS 17.0, the `HealthBridgeApp: App` entry point, `Info.plist` keys `NSHealthShareUsageDescription`/`NSHealthUpdateUsageDescription`, and entitlement keys `com.apple.developer.healthkit`/`com.apple.developer.healthkit.background-delivery` — all consumed starting Task 3.

- [ ] **Step 1: Create the Xcode project**

In Xcode 26.6: File → New → Project → iOS → App.
- Product Name: `HealthBridge`
- Team: your paid Apple Developer Program team
- Organization Identifier: `com.healthtracker` (bundle ID resolves to `com.healthtracker.iosbridge`)
- Interface: SwiftUI
- Language: Swift
- Include Tests: checked (creates `HealthBridgeTests`)
- Save into the `ios/` directory of this repo so the project root is `ios/HealthBridge.xcodeproj`.

In the target's Signing & Capabilities tab: set Minimum Deployments → iOS 17.0.

- [ ] **Step 2: Add the HealthKit capability and background-delivery entitlement**

In Signing & Capabilities, click "+ Capability" → "HealthKit". This auto-adds `com.apple.developer.healthkit` to `ios/HealthBridge/HealthBridge.entitlements` and enables the "Background Delivery" checkbox under the HealthKit capability — check it, which adds the second entitlement:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>com.apple.developer.healthkit</key>
    <true/>
    <key>com.apple.developer.healthkit.background-delivery</key>
    <true/>
</dict>
</plist>
```

Also add "Background Modes" capability → check "Background fetch" and "Background processing" (needed for Task 5's `BGAppRefreshTask`).

- [ ] **Step 3: Write specific HealthKit purpose strings into Info.plist**

`ios/HealthBridge/Info.plist` (add these two keys):
```xml
<key>NSHealthShareUsageDescription</key>
<string>HealthBridge reads your heart rate, step count, active energy, body weight, and VO2 max samples from Health so it can securely sync them to your personal backend server for long-term tracking.</string>
<key>NSHealthUpdateUsageDescription</key>
<string>HealthBridge writes heart rate, step count, active energy, body weight, and VO2 max entries into Health when you record or import them through your personal backend server.</string>
```

- [ ] **Step 4: Minimal app entry point**

`ios/HealthBridge/HealthBridgeApp.swift`:
```swift
import SwiftUI

@main
struct HealthBridgeApp: App {
    var body: some Scene {
        WindowGroup {
            Text("HealthBridge")
        }
    }
}
```
(Replaced in Tasks 4-6 as the HealthKit/networking/UI pieces are wired in.)

- [ ] **Step 5: Verify the empty project builds**

```bash
xcodebuild -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16' build
```
Confirm `BUILD SUCCEEDED`.

- [ ] **Step 6: Commit**
```bash
git add ios/
git commit -m "chore: scaffold HealthBridge iOS app with HealthKit capability and entitlements"
```

---

### Task 3: HealthKit authorization

**Files:**
- Create: `ios/HealthBridge/HealthKit/HealthMetric.swift`
- Create: `ios/HealthBridge/HealthKit/HealthKitAuthManager.swift`
- Modify: `ios/HealthBridge/HealthBridgeApp.swift`
- Create (test target): `ios/HealthBridgeTests/HealthKitAuthManagerTests.swift`

**Interfaces:**
- Produces: `enum HealthMetric: String, CaseIterable` (`heartRate="heart_rate"`, `steps="steps"`, `activeEnergy="active_energy"`, `weight="weight"`, `vo2Max="vo2max"`) with `var sampleType: HKSampleType` and `var displayName: String`.
- Produces: `final class HealthKitAuthManager` (`@Observable`) with `static let readTypes/writeTypes: Set<HKSampleType>`, `func requestAuthorizationIfNeeded() async`, `private(set) var authorizationError: String?` (surfaces a request failure to the UI instead of silently swallowing it), `func isEnabled(_ metric: HealthMetric) -> Bool`, `func setEnabled(_ enabled: Bool, for metric: HealthMetric)`. Task 4 uses `HealthMetric`/`.sampleType`/`isEnabled`; Task 6 uses `isEnabled`/`setEnabled`/`authorizationError` for the UI.

- [ ] **Step 1: Define `HealthMetric`**

`ios/HealthBridge/HealthKit/HealthMetric.swift`:
```swift
import HealthKit

enum HealthMetric: String, CaseIterable, Codable {
    case heartRate = "heart_rate"
    case steps = "steps"
    case activeEnergy = "active_energy"
    case weight = "weight"
    case vo2Max = "vo2max"

    var sampleType: HKSampleType {
        switch self {
        case .heartRate:
            return HKObjectType.quantityType(forIdentifier: .heartRate)!
        case .steps:
            return HKObjectType.quantityType(forIdentifier: .stepCount)!
        case .activeEnergy:
            return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        case .weight:
            return HKObjectType.quantityType(forIdentifier: .bodyMass)!
        case .vo2Max:
            return HKObjectType.quantityType(forIdentifier: .vo2Max)!
        }
    }

    var displayName: String {
        switch self {
        case .heartRate: return "Heart Rate"
        case .steps: return "Steps"
        case .activeEnergy: return "Active Energy"
        case .weight: return "Weight"
        case .vo2Max: return "VO2 Max"
        }
    }
}
```

- [ ] **Step 2: Write failing tests for the auth manager's persisted toggle logic and error surfacing**

Only the toggle-persistence logic and error-surfacing are testable without a device (the manager never calls the real `HKHealthStore.requestAuthorization` in tests — a fake store is injected). `ios/HealthBridgeTests/HealthKitAuthManagerTests.swift`:
```swift
import XCTest
import HealthKit
@testable import HealthBridge

private struct AuthFailureError: Error, LocalizedError {
    var errorDescription: String? { "HealthKit is not available on this device" }
}

final class HealthKitAuthManagerTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "HealthKitAuthManagerTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testDefaultsToAllMetricsEnabledWhenNoStoredValue() {
        let manager = HealthKitAuthManager(defaults: defaults)
        XCTAssertEqual(manager.enabledMetrics, Set(HealthMetric.allCases))
    }

    func testDisablingAMetricPersistsAcrossInstances() {
        let manager = HealthKitAuthManager(defaults: defaults)
        manager.setEnabled(false, for: .weight)

        let reloaded = HealthKitAuthManager(defaults: defaults)
        XCTAssertFalse(reloaded.isEnabled(.weight))
        XCTAssertTrue(reloaded.isEnabled(.steps))
    }

    func testReadAndWriteTypeSetsCoverAllFiveMetrics() {
        XCTAssertEqual(HealthKitAuthManager.readTypes.count, 5)
        XCTAssertEqual(HealthKitAuthManager.writeTypes.count, 5)
    }

    func testRequestAuthorizationSurfacesAFailureInsteadOfSwallowingIt() async {
        // A real device with HealthKit unavailable (e.g. some iPad models) or
        // any other authorization-request failure must be visible somewhere,
        // not silently discarded by a bare `try?` at the call site.
        let manager = HealthKitAuthManager(
            defaults: defaults,
            requestAuthorization: { throw AuthFailureError() }
        )
        await manager.requestAuthorizationIfNeeded()
        XCTAssertEqual(manager.authorizationError, "HealthKit is not available on this device")
    }

    func testRequestAuthorizationClearsAnyPriorErrorOnSuccess() async {
        let manager = HealthKitAuthManager(
            defaults: defaults,
            requestAuthorization: { throw AuthFailureError() }
        )
        await manager.requestAuthorizationIfNeeded()
        XCTAssertNotNil(manager.authorizationError)

        let succeeding = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        await succeeding.requestAuthorizationIfNeeded()
        XCTAssertNil(succeeding.authorizationError)
    }
}
```

Run and confirm it fails to compile (`HealthKitAuthManager` doesn't exist yet):
```bash
xcodebuild test -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16'
```

- [ ] **Step 3: Implement `HealthKitAuthManager`**

The real `HKHealthStore.requestAuthorization` call is injected as a closure (`requestAuthorization`) so tests can simulate both success and failure without touching real HealthKit — this is the same "isolate the untestable boundary behind an interface" approach used for the Gemini client in the web-app plan.

`ios/HealthBridge/HealthKit/HealthKitAuthManager.swift`:
```swift
import Foundation
import HealthKit
import Observation

@Observable
final class HealthKitAuthManager {
    private let defaults: UserDefaults
    private let requestAuthorization: () async throws -> Void
    private static let enabledMetricsKey = "HealthKitAuthManager.enabledMetrics"

    private(set) var authorizationRequested: Bool = false
    private(set) var authorizationError: String?
    var enabledMetrics: Set<HealthMetric> {
        didSet { persistEnabledMetrics() }
    }

    static let readTypes: Set<HKSampleType> = Set(HealthMetric.allCases.map(\.sampleType))
    static let writeTypes: Set<HKSampleType> = Set(HealthMetric.allCases.map(\.sampleType))

    init(
        healthStore: HKHealthStore = .init(),
        defaults: UserDefaults = .standard,
        requestAuthorization: (() async throws -> Void)? = nil
    ) {
        self.defaults = defaults
        self.requestAuthorization = requestAuthorization ?? {
            guard HKHealthStore.isHealthDataAvailable() else {
                throw NSError(domain: "HealthKitAuthManager", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Health data is not available on this device",
                ])
            }
            try await healthStore.requestAuthorization(toShare: Self.writeTypes, read: Self.readTypes)
        }
        if let stored = defaults.array(forKey: Self.enabledMetricsKey) as? [String] {
            self.enabledMetrics = Set(stored.compactMap(HealthMetric.init(rawValue:)))
        } else {
            self.enabledMetrics = Set(HealthMetric.allCases)
        }
    }

    func requestAuthorizationIfNeeded() async {
        do {
            try await requestAuthorization()
            authorizationError = nil
            authorizationRequested = true
        } catch {
            // Visible to the status UI (Task 6) instead of a bare `try?` that
            // would silently discard this — a user on unsupported hardware,
            // or hitting any other request failure, deserves to know sync
            // will never work rather than watching "Never synced" forever
            // with no explanation.
            authorizationError = error.localizedDescription
        }
    }

    func isEnabled(_ metric: HealthMetric) -> Bool {
        enabledMetrics.contains(metric)
    }

    func setEnabled(_ enabled: Bool, for metric: HealthMetric) {
        if enabled {
            enabledMetrics.insert(metric)
        } else {
            enabledMetrics.remove(metric)
        }
    }

    private func persistEnabledMetrics() {
        defaults.set(enabledMetrics.map(\.rawValue), forKey: Self.enabledMetricsKey)
    }
}
```

- [ ] **Step 4: Run tests, verify they pass**

```bash
xcodebuild test -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16'
```

- [ ] **Step 5: Wire authorization request into the app entry point**

`ios/HealthBridge/HealthBridgeApp.swift`:
```swift
import SwiftUI

@main
struct HealthBridgeApp: App {
    @State private var authManager = HealthKitAuthManager()

    var body: some Scene {
        WindowGroup {
            Text("HealthBridge")
                .environment(authManager)
                .task {
                    await authManager.requestAuthorizationIfNeeded()
                }
        }
    }
}
```

- [ ] **Step 6: Commit**
```bash
git add ios/HealthBridge/HealthKit ios/HealthBridge/HealthBridgeApp.swift ios/HealthBridgeTests/HealthKitAuthManagerTests.swift
git commit -m "feat: add HealthKit authorization manager with persisted toggles and visible error state"
```

---

### Task 4: Background observer + background-upload networking (correctness-critical)

**Files:**
- Create: `ios/HealthBridge/Sync/HealthSampleNormalizer.swift`
- Create: `ios/HealthBridge/Sync/SyncAnchorStore.swift`
- Create: `ios/HealthBridge/Sync/LastSyncStore.swift`
- Create: `ios/HealthBridge/Sync/BackgroundUploadSession.swift`
- Create: `ios/HealthBridge/Sync/HealthObserverCoordinator.swift`
- Create: `ios/HealthBridge/AppDelegate.swift`
- Create: `ios/HealthBridge/AppConfig.swift`
- Modify: `ios/HealthBridge/HealthBridgeApp.swift`
- Create (test target): `ios/HealthBridgeTests/HealthSampleNormalizerTests.swift`
- Create (test target): `ios/HealthBridgeTests/SyncAnchorStoreTests.swift`
- Create (test target): `ios/HealthBridgeTests/LastSyncStoreTests.swift`
- Create (test target): `ios/HealthBridgeTests/BackgroundUploadSessionTests.swift`

**Interfaces:**
- Consumes: `HealthMetric`/`.sampleType`, `HealthKitAuthManager.isEnabled(_:)` (Task 3).
- Produces: `HealthEventPayload` (Codable, matches backend body); `protocol BackgroundDeliveryToggling { func startObserving(metric:); func stopObserving(metric:) }`, implemented by `HealthObserverCoordinator`, with an added `var onDeliveryError: ((HealthMetric, String) -> Void)?` callback — consumed by Task 6 to surface a per-metric sync error in the status UI, not just print it to the console; `LastSyncStore.lastSync(for:) -> Date?` — consumed by Task 6.

**What is unit-tested vs. not:** `HealthSampleNormalizer`, `SyncAnchorStore`, `LastSyncStore`, and the upload success/failure decision (`UploadOutcome`) are pure logic and are unit-tested below. `HealthObserverCoordinator` itself (real `HKObserverQuery`/`HKAnchoredObjectQuery`/`enableBackgroundDelivery` against a live HealthKit store, and the real background `URLSession` transfer lifecycle) cannot be exercised in CI or the simulator — it requires a real device with a paid-team entitlement and is covered only by the manual procedure in Task 7.

- [ ] **Step 1: Write failing test for sample normalization**

`ios/HealthBridgeTests/HealthSampleNormalizerTests.swift`:
```swift
import XCTest
import HealthKit
@testable import HealthBridge

final class HealthSampleNormalizerTests: XCTestCase {
    func testNormalizesStepCountSample() {
        let type = HKObjectType.quantityType(forIdentifier: .stepCount)!
        let quantity = HKQuantity(unit: .count(), doubleValue: 250)
        let start = Date(timeIntervalSince1970: 1_757_000_000)
        let sample = HKQuantitySample(type: type, quantity: quantity, start: start, end: start)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .steps)

        XCTAssertEqual(payload.source, "ios-bridge")
        XCTAssertEqual(payload.metric, "steps")
        XCTAssertEqual(payload.value, 250)
        XCTAssertEqual(payload.unit, "count")
        XCTAssertEqual(payload.timestamp, ISO8601DateFormatter.hb.string(from: start))
    }

    func testNormalizesWeightSampleToKilograms() {
        let type = HKObjectType.quantityType(forIdentifier: .bodyMass)!
        let quantity = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: 70.5)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .weight)

        XCTAssertEqual(payload.value, 70.5, accuracy: 0.0001)
        XCTAssertEqual(payload.unit, "kg")
    }

    func testNormalizesHeartRateSample() {
        let type = HKObjectType.quantityType(forIdentifier: .heartRate)!
        let unit = HKUnit.count().unitDivided(by: .minute())
        let quantity = HKQuantity(unit: unit, doubleValue: 61)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .heartRate)

        XCTAssertEqual(payload.value, 61)
        XCTAssertEqual(payload.unit, "count/min")
    }
}
```

Run and confirm compile failure (`HealthSampleNormalizer` doesn't exist yet).

- [ ] **Step 2: Implement `HealthEventPayload` and `HealthSampleNormalizer`**

`ios/HealthBridge/Sync/HealthSampleNormalizer.swift`:
```swift
import Foundation
import HealthKit

struct HealthEventPayload: Codable, Equatable {
    let source: String
    let metric: String
    let timestamp: String
    let value: Double
    let unit: String?
}

extension ISO8601DateFormatter {
    static let hb: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

enum HealthSampleNormalizer {
    static func payload(for sample: HKQuantitySample, metric: HealthMetric) -> HealthEventPayload {
        let (value, unit) = quantityValueAndUnit(sample.quantity, metric: metric)
        return HealthEventPayload(
            source: "ios-bridge",
            metric: metric.rawValue,
            timestamp: ISO8601DateFormatter.hb.string(from: sample.endDate),
            value: value,
            unit: unit
        )
    }

    private static func quantityValueAndUnit(_ quantity: HKQuantity, metric: HealthMetric) -> (Double, String?) {
        switch metric {
        case .heartRate:
            let unit = HKUnit.count().unitDivided(by: .minute())
            return (quantity.doubleValue(for: unit), "count/min")
        case .steps:
            return (quantity.doubleValue(for: .count()), "count")
        case .activeEnergy:
            return (quantity.doubleValue(for: .kilocalorie()), "kcal")
        case .weight:
            return (quantity.doubleValue(for: .gramUnit(with: .kilo)), "kg")
        case .vo2Max:
            let unit = HKUnit.literUnit(with: .milli)
                .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
            return (quantity.doubleValue(for: unit), "mL/(kg·min)")
        }
    }
}
```

Run tests, verify they pass.

- [ ] **Step 3: Write failing test for anchor persistence**

`ios/HealthBridgeTests/SyncAnchorStoreTests.swift`:
```swift
import XCTest
import HealthKit
@testable import HealthBridge

final class SyncAnchorStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "SyncAnchorStoreTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testReturnsNilWhenNoAnchorSaved() {
        let store = SyncAnchorStore(defaults: defaults)
        XCTAssertNil(store.anchor(for: .steps))
    }

    func testRoundTripsAnAnchor() {
        let store = SyncAnchorStore(defaults: defaults)
        let anchor = HKQueryAnchor(fromValue: 42)

        store.save(anchor, for: .steps)

        XCTAssertNotNil(store.anchor(for: .steps))
    }

    func testAnchorsAreKeyedPerMetric() {
        let store = SyncAnchorStore(defaults: defaults)
        store.save(HKQueryAnchor(fromValue: 1), for: .steps)

        XCTAssertNil(store.anchor(for: .weight))
    }
}
```

Run, confirm compile failure.

- [ ] **Step 4: Implement `SyncAnchorStore`**

`ios/HealthBridge/Sync/SyncAnchorStore.swift`:
```swift
import Foundation
import HealthKit

final class SyncAnchorStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(for metric: HealthMetric) -> String {
        "SyncAnchorStore.anchor.\(metric.rawValue)"
    }

    func anchor(for metric: HealthMetric) -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: key(for: metric)) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func save(_ anchor: HKQueryAnchor, for metric: HealthMetric) {
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else { return }
        defaults.set(data, forKey: key(for: metric))
    }

    func clear(for metric: HealthMetric) {
        defaults.removeObject(forKey: key(for: metric))
    }
}
```

Run tests, verify pass.

- [ ] **Step 5: Write failing test for last-sync persistence**

`ios/HealthBridgeTests/LastSyncStoreTests.swift`:
```swift
import XCTest
@testable import HealthBridge

final class LastSyncStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "LastSyncStoreTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testReturnsNilWhenNeverSynced() {
        let store = LastSyncStore(defaults: defaults)
        XCTAssertNil(store.lastSync(for: .heartRate))
    }

    func testRecordsAndReturnsLastSyncTime() {
        let store = LastSyncStore(defaults: defaults)
        let date = Date(timeIntervalSince1970: 1_757_000_000)
        store.recordSync(for: .heartRate, at: date)

        XCTAssertEqual(store.lastSync(for: .heartRate), date)
    }
}
```

Run, confirm compile failure.

- [ ] **Step 6: Implement `LastSyncStore`**

`ios/HealthBridge/Sync/LastSyncStore.swift`:
```swift
import Foundation

final class LastSyncStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func key(for metric: HealthMetric) -> String {
        "LastSyncStore.lastSync.\(metric.rawValue)"
    }

    func recordSync(for metric: HealthMetric, at date: Date) {
        defaults.set(date.timeIntervalSince1970, forKey: key(for: metric))
    }

    func lastSync(for metric: HealthMetric) -> Date? {
        let value = defaults.double(forKey: key(for: metric))
        return value == 0 ? nil : Date(timeIntervalSince1970: value)
    }
}
```

Run tests, verify pass.

- [ ] **Step 7: Write failing test for upload success/failure determination**

`ios/HealthBridgeTests/BackgroundUploadSessionTests.swift`:
```swift
import XCTest
@testable import HealthBridge

final class BackgroundUploadSessionTests: XCTestCase {
    func testSuccessForA201Response() {
        XCTAssertTrue(UploadOutcome.isSuccess(httpStatusCode: 201, error: nil))
    }

    func testFailureForA401Response() {
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: 401, error: nil))
    }

    func testFailureWhenTransportErrorPresent() {
        struct DummyError: Error {}
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: 201, error: DummyError()))
    }

    func testFailureWhenNoResponseReceived() {
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: nil, error: nil))
    }
}
```

Run, confirm compile failure.

- [ ] **Step 8: Implement `UploadOutcome` and `BackgroundUploadSession`**

`ios/HealthBridge/Sync/BackgroundUploadSession.swift`:
```swift
import Foundation

enum UploadOutcome {
    static func isSuccess(httpStatusCode: Int?, error: Error?) -> Bool {
        guard error == nil, let httpStatusCode else { return false }
        return (200..<300).contains(httpStatusCode)
    }
}

protocol BackgroundUploadSessionDelegateHandler: AnyObject {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool)
}

final class BackgroundUploadSession: NSObject {
    static let identifier = "com.healthtracker.iosbridge.background-upload"

    private(set) lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    weak var delegateHandler: BackgroundUploadSessionDelegateHandler?
    var backgroundCompletionHandler: (() -> Void)?

    private var taskIdentifierByTaskNumber: [Int: String] = [:]
    private let metadataLock = NSLock()

    func upload(payload: HealthEventPayload, taskIdentifier: String, endpoint: URL, bearerToken: String) throws {
        let data = try JSONEncoder().encode(payload)
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        try data.write(to: tempURL, options: .atomic)

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let task = urlSession.uploadTask(with: request, fromFile: tempURL)
        metadataLock.lock()
        taskIdentifierByTaskNumber[task.taskIdentifier] = taskIdentifier
        metadataLock.unlock()
        task.resume()
    }
}

extension BackgroundUploadSession: URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        metadataLock.lock()
        let identifier = taskIdentifierByTaskNumber.removeValue(forKey: task.taskIdentifier)
        metadataLock.unlock()

        guard let identifier else { return }

        let httpStatus = (task.response as? HTTPURLResponse)?.statusCode
        let success = UploadOutcome.isSuccess(httpStatusCode: httpStatus, error: error)

        delegateHandler?.uploadSession(self, didCompleteTaskWithIdentifier: identifier, success: success)
    }
}

extension BackgroundUploadSession: URLSessionDelegate {
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletionHandler?()
            self?.backgroundCompletionHandler = nil
        }
    }
}
```

Run the full test suite, verify pass.

- [ ] **Step 9: Implement `HealthObserverCoordinator`** (not unit-tested — real `HKObserverQuery`/`HKAnchoredObjectQuery`/background `URLSession` lifecycle; verified manually in Task 7)

`ios/HealthBridge/Sync/HealthObserverCoordinator.swift`:
```swift
import Foundation
import HealthKit

protocol BackgroundDeliveryToggling: AnyObject {
    func startObserving(metric: HealthMetric)
    func stopObserving(metric: HealthMetric)
}

final class HealthObserverCoordinator {
    private let healthStore: HKHealthStore
    private let anchorStore: SyncAnchorStore
    private let uploadSession: BackgroundUploadSession
    private let authManager: HealthKitAuthManager
    private let lastSyncStore: LastSyncStore
    private let endpoint: URL
    private let bearerToken: String

    /// Fired when `enableBackgroundDelivery` itself fails for a metric (e.g.
    /// background delivery isn't authorized, or HealthKit rejects the
    /// request) — surfaced by Task 6's status UI so a broken metric is
    /// visibly distinguishable from one that just hasn't synced yet.
    var onDeliveryError: ((HealthMetric, String) -> Void)?

    private struct PendingBatch {
        let metric: HealthMetric
        let newAnchor: HKQueryAnchor
        let observerCompletion: HKObserverQueryCompletionHandler
        var remainingTaskIdentifiers: Set<String>
        var allSucceeded: Bool
    }

    private var pendingBatches: [String: PendingBatch] = [:]
    private let batchLock = NSLock()

    init(
        healthStore: HKHealthStore,
        anchorStore: SyncAnchorStore,
        uploadSession: BackgroundUploadSession,
        authManager: HealthKitAuthManager,
        lastSyncStore: LastSyncStore,
        endpoint: URL,
        bearerToken: String
    ) {
        self.healthStore = healthStore
        self.anchorStore = anchorStore
        self.uploadSession = uploadSession
        self.authManager = authManager
        self.lastSyncStore = lastSyncStore
        self.endpoint = endpoint
        self.bearerToken = bearerToken
        uploadSession.delegateHandler = self
    }

    func startObserving() {
        for metric in HealthMetric.allCases where authManager.isEnabled(metric) {
            startObserving(metric: metric)
        }
    }

    private func handleObserverTrigger(metric: HealthMetric, observerCompletion: @escaping HKObserverQueryCompletionHandler) {
        let anchor = anchorStore.anchor(for: metric)
        let anchoredQuery = HKAnchoredObjectQuery(
            type: metric.sampleType as! HKSampleType,
            predicate: nil,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self else {
                observerCompletion()
                return
            }
            guard error == nil, let newAnchor, let samples = samples as? [HKQuantitySample], !samples.isEmpty else {
                observerCompletion()
                return
            }
            self.uploadBatch(samples: samples, metric: metric, newAnchor: newAnchor, observerCompletion: observerCompletion)
        }

        healthStore.execute(anchoredQuery)
    }

    private func uploadBatch(
        samples: [HKQuantitySample],
        metric: HealthMetric,
        newAnchor: HKQueryAnchor,
        observerCompletion: @escaping HKObserverQueryCompletionHandler
    ) {
        let batchID = UUID().uuidString
        var taskIdentifiers: Set<String> = []
        for sample in samples {
            taskIdentifiers.insert("\(batchID)#\(sample.uuid.uuidString)")
        }

        batchLock.lock()
        pendingBatches[batchID] = PendingBatch(
            metric: metric,
            newAnchor: newAnchor,
            observerCompletion: observerCompletion,
            remainingTaskIdentifiers: taskIdentifiers,
            allSucceeded: true
        )
        batchLock.unlock()

        for sample in samples {
            let taskIdentifier = "\(batchID)#\(sample.uuid.uuidString)"
            let payload = HealthSampleNormalizer.payload(for: sample, metric: metric)
            do {
                try uploadSession.upload(payload: payload, taskIdentifier: taskIdentifier, endpoint: endpoint, bearerToken: bearerToken)
            } catch {
                markTaskComplete(taskIdentifier: taskIdentifier, batchID: batchID, success: false)
            }
        }
    }

    private func markTaskComplete(taskIdentifier: String, batchID: String, success: Bool) {
        batchLock.lock()
        guard var batch = pendingBatches[batchID] else {
            batchLock.unlock()
            return
        }
        batch.remainingTaskIdentifiers.remove(taskIdentifier)
        if !success { batch.allSucceeded = false }
        let isComplete = batch.remainingTaskIdentifiers.isEmpty
        pendingBatches[batchID] = batch
        if isComplete { pendingBatches.removeValue(forKey: batchID) }
        batchLock.unlock()

        guard isComplete else { return }

        if batch.allSucceeded {
            anchorStore.save(batch.newAnchor, for: batch.metric)
            lastSyncStore.recordSync(for: batch.metric, at: Date())
        } else {
            onDeliveryError?(batch.metric, "Some samples failed to upload — will retry on the next sync.")
        }
        // Per Apple's guidance, always call the observer's completion handler even on
        // failure, to avoid HealthKit throttling future background deliveries. The
        // anchor above is intentionally NOT advanced on failure, so the next delivery
        // re-fetches and retries these same samples.
        batch.observerCompletion()
    }
}

extension HealthObserverCoordinator: BackgroundDeliveryToggling {
    func startObserving(metric: HealthMetric) {
        let sampleType = metric.sampleType

        healthStore.enableBackgroundDelivery(for: sampleType, frequency: .immediate) { [weak self] success, error in
            if !success {
                let message = error?.localizedDescription ?? "Background delivery could not be enabled"
                self?.onDeliveryError?(metric, message)
            }
        }

        let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completionHandler, error in
            guard let self else {
                completionHandler()
                return
            }
            if let error {
                self.onDeliveryError?(metric, error.localizedDescription)
                completionHandler()
                return
            }
            self.handleObserverTrigger(metric: metric, observerCompletion: completionHandler)
        }

        healthStore.execute(query)
    }

    func stopObserving(metric: HealthMetric) {
        healthStore.disableBackgroundDelivery(for: metric.sampleType) { _, _ in }
    }
}

extension HealthObserverCoordinator: BackgroundUploadSessionDelegateHandler {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool) {
        guard let batchID = identifier.split(separator: "#").first.map(String.init) else { return }
        markTaskComplete(taskIdentifier: identifier, batchID: batchID, success: success)
    }
}
```

This is the pairing referenced in the design: `HKObserverQuery`'s `updateHandler` fires whenever HealthKit detects a change to a watched sample type (foreground, background, or after being relaunched for background delivery); it does not itself carry the changed samples. On each firing, an `HKAnchoredObjectQuery` runs with the last-persisted `HKQueryAnchor` for that metric — HealthKit returns exactly the samples added since that anchor, plus a `newAnchor` token. The anchor is persisted only after every sample in the batch has confirmed-uploaded, so a crash or upload failure mid-batch causes the identical sample set to be re-delivered on the next trigger instead of being silently dropped.

- [ ] **Step 10: App-level plumbing — `AppConfig` and `AppDelegate`**

`ios/HealthBridge/AppConfig.swift`:
```swift
import Foundation

enum AppConfig {
    static let healthEventsEndpoint = URL(string: "https://your-backend.example.com/api/health-events")!
    static let pendingWritesEndpoint = URL(string: "https://your-backend.example.com/api/health-events/pending-writes")!
    // Placeholder — filled in locally with the real MCP_ACCESS_TOKEN shared
    // secret per Task 7's manual-verification prerequisites. Never commit
    // the real value to source control.
    static let bearerToken = "REPLACE_WITH_SHARED_SECRET"
}
```

`ios/HealthBridge/AppDelegate.swift`:
```swift
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    var backgroundUploadSession: BackgroundUploadSession?

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == BackgroundUploadSession.identifier else {
            completionHandler()
            return
        }
        backgroundUploadSession?.backgroundCompletionHandler = completionHandler
    }
}
```

- [ ] **Step 11: Wire it all into the app entry point**

`ios/HealthBridge/HealthBridgeApp.swift`:
```swift
import SwiftUI
import HealthKit

@main
struct HealthBridgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var authManager = HealthKitAuthManager()
    private let uploadSession = BackgroundUploadSession()
    private let anchorStore = SyncAnchorStore()
    private let lastSyncStore = LastSyncStore()
    private var coordinator: HealthObserverCoordinator!

    init() {
        coordinator = HealthObserverCoordinator(
            healthStore: HKHealthStore(),
            anchorStore: anchorStore,
            uploadSession: uploadSession,
            authManager: authManager,
            lastSyncStore: lastSyncStore,
            endpoint: AppConfig.healthEventsEndpoint,
            bearerToken: AppConfig.bearerToken
        )
    }

    var body: some Scene {
        WindowGroup {
            Text("HealthBridge")
                .environment(authManager)
                .task {
                    appDelegate.backgroundUploadSession = uploadSession
                    await authManager.requestAuthorizationIfNeeded()
                    coordinator.startObserving()
                }
        }
    }
}
```

(`appDelegate.backgroundUploadSession` is wired inside `.task`, not `init()`, since `@UIApplicationDelegateAdaptor`'s wrapped value is not guaranteed fully set up during the `App` struct's own `init()`.)

- [ ] **Step 12: Run the full test suite one more time, then commit**

```bash
xcodebuild test -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16'
git add ios/HealthBridge/Sync ios/HealthBridge/AppDelegate.swift ios/HealthBridge/AppConfig.swift ios/HealthBridge/HealthBridgeApp.swift ios/HealthBridgeTests
git commit -m "feat: add HealthKit observer/anchored-query sync pipeline with background-URLSession uploads"
```

---

### Task 5: Write-back polling consumer

**Files:**
- Create: `ios/HealthBridge/Sync/PendingWritesClient.swift`
- Create: `ios/HealthBridge/Sync/HealthKitSampleWriter.swift`
- Create: `ios/HealthBridge/Sync/PendingWritesSyncer.swift`
- Modify: `ios/HealthBridge/AppDelegate.swift`
- Modify: `ios/HealthBridge/HealthBridgeApp.swift`
- Modify: `ios/HealthBridge/Info.plist`
- Create (test target): `ios/HealthBridgeTests/PendingWritesSyncerTests.swift`

**Interfaces:**
- Consumes: `HealthMetric(rawValue:)` (Task 3), `AppConfig.pendingWritesEndpoint`/`bearerToken` (Task 4).
- Produces: `PendingWritesSyncer.syncOnce() async -> Int` (returns count successfully applied) — consumed by both the scene-foreground trigger and the `BGAppRefreshTask` handler in `AppDelegate`.

**What is unit-tested vs. not:** `PendingWritesSyncer`'s polling/apply/ack orchestration is tested against a mocked `PendingWritesNetworking` and mocked `HealthSampleWriting` — no real network or HealthKit calls. The real `URLSession.shared` network calls in `PendingWritesClient` and the real `HKHealthStore.save()` in `HealthKitSampleWriter`, plus `BGTaskScheduler` timing, are not unit-tested and are covered by Task 6's manual procedure.

- [ ] **Step 1: Add the BGAppRefreshTask identifier to Info.plist**

Add to `ios/HealthBridge/Info.plist`:
```xml
<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.healthtracker.iosbridge.pending-writes-refresh</string>
</array>
```

- [ ] **Step 2: Write failing tests for the polling/apply/ack orchestration, including partial-failure cases**

`ios/HealthBridgeTests/PendingWritesSyncerTests.swift`:
```swift
import XCTest
import HealthKit
@testable import HealthBridge

private final class MockPendingWritesNetworking: PendingWritesNetworking {
    var pendingWrites: [PendingWriteDTO] = []
    var fetchError: Error?
    var acknowledgedIDs: [String] = []
    var acknowledgeError: Error?

    func fetchPendingWrites() async throws -> [PendingWriteDTO] {
        if let fetchError { throw fetchError }
        return pendingWrites
    }

    func acknowledge(id: String) async throws {
        if let acknowledgeError { throw acknowledgeError }
        acknowledgedIDs.append(id)
    }
}

private final class MockHealthSampleWriter: HealthSampleWriting {
    var savedSamples: [(metric: HealthMetric, value: Double, timestamp: Date)] = []
    var saveError: Error?

    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
        if let saveError { throw saveError }
        savedSamples.append((metric, value, timestamp))
    }
}

final class PendingWritesSyncerTests: XCTestCase {
    func testAppliesAndAcknowledgesEachPendingWrite() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: "count", timestamp: "2026-09-01T10:00:00Z"),
            PendingWriteDTO(id: "2", metric: "weight", value: 70.2, unit: "kg", timestamp: "2026-09-01T11:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 2)
        XCTAssertEqual(writer.savedSamples.count, 2)
        XCTAssertEqual(networking.acknowledgedIDs, ["1", "2"])
    }

    func testSkipsAcknowledgeWhenSaveFails() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        writer.saveError = URLError(.unknown)
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        // Not acknowledging on save failure is deliberate: the item stays
        // "pending" on the backend and is retried on the next poll, rather
        // than being marked delivered when it was never actually written to
        // Health.
        XCTAssertEqual(applied, 0)
        XCTAssertTrue(networking.acknowledgedIDs.isEmpty)
    }

    func testAppliesRemainingItemsWhenOneFailsMidBatch() async {
        // A failure on one item must not abort the whole batch — items are
        // independent (different metrics/timestamps), so one failing to
        // save must not block the others from being applied and acked.
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
            PendingWriteDTO(id: "2", metric: "weight", value: 70.2, unit: "kg", timestamp: "2026-09-01T11:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        var callCount = 0
        // Simulate the first save failing, second succeeding, via a writer subclass-free approach:
        // reuse MockHealthSampleWriter's saveError only for the first call by wrapping it.
        final class SequencedWriter: HealthSampleWriting {
            var results: [Result<Void, Error>]
            var savedSamples: [(metric: HealthMetric, value: Double, timestamp: Date)] = []
            init(results: [Result<Void, Error>]) { self.results = results }
            func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
                let result = results.removeFirst()
                switch result {
                case .success:
                    savedSamples.append((metric, value, timestamp))
                case .failure(let error):
                    throw error
                }
            }
        }
        let sequencedWriter = SequencedWriter(results: [.failure(URLError(.unknown)), .success(())])
        let syncer = PendingWritesSyncer(networking: networking, writer: sequencedWriter)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 1)
        XCTAssertEqual(networking.acknowledgedIDs, ["2"])
        _ = callCount // silence unused-variable warning in this illustrative test
    }

    func testSkipsUnknownMetric() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "unknown_metric", value: 1, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0)
        XCTAssertTrue(networking.acknowledgedIDs.isEmpty)
    }

    func testReturnsZeroWhenFetchFails() async {
        let networking = MockPendingWritesNetworking()
        networking.fetchError = URLError(.notConnectedToInternet)
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0)
    }

    func testDoesNotCrashWhenAcknowledgeFailsAfterASuccessfulSave() async {
        // If the save succeeds but the ack POST fails (network drop between
        // the two calls), the sample IS now in Health — that's correct and
        // not undone — but the backend still thinks it's pending, so it will
        // be re-delivered and re-saved next poll. This duplicates a manual
        // health entry rather than losing one, which is the safer failure
        // direction for a personal health app; note this as an accepted,
        // documented tradeoff rather than an unhandled crash.
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        networking.acknowledgeError = URLError(.networkConnectionLost)
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0) // not counted as cleanly applied since the ack didn't complete
        XCTAssertEqual(writer.savedSamples.count, 1) // but the Health write did happen
    }
}
```

Run, confirm compile failure (types don't exist yet).

- [ ] **Step 3: Implement `PendingWriteDTO` and `PendingWritesClient`**

`ios/HealthBridge/Sync/PendingWritesClient.swift`:
```swift
import Foundation

struct PendingWriteDTO: Codable, Equatable {
    let id: String
    let metric: String
    let value: Double
    let unit: String?
    let timestamp: String
}

protocol PendingWritesNetworking {
    func fetchPendingWrites() async throws -> [PendingWriteDTO]
    func acknowledge(id: String) async throws
}

final class PendingWritesClient: PendingWritesNetworking {
    private let session: URLSession
    private let pendingWritesURL: URL
    private let bearerToken: String

    init(session: URLSession = .shared, pendingWritesURL: URL, bearerToken: String) {
        self.session = session
        self.pendingWritesURL = pendingWritesURL
        self.bearerToken = bearerToken
    }

    func fetchPendingWrites() async throws -> [PendingWriteDTO] {
        var request = URLRequest(url: pendingWritesURL)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try Self.validate(response)
        return try JSONDecoder().decode([PendingWriteDTO].self, from: data)
    }

    func acknowledge(id: String) async throws {
        let ackURL = pendingWritesURL.appendingPathComponent("\(id)/ack")
        var request = URLRequest(url: ackURL)
        request.httpMethod = "POST"
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await session.data(for: request)
        try Self.validate(response)
    }

    private static func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
```

- [ ] **Step 4: Implement `HealthUnitMapper` and `HealthKitSampleWriter`**

`ios/HealthBridge/Sync/HealthKitSampleWriter.swift`:
```swift
import Foundation
import HealthKit

protocol HealthSampleWriting {
    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws
}

enum HealthUnitMapper {
    static func unit(for metric: HealthMetric) -> HKUnit {
        switch metric {
        case .heartRate:
            return HKUnit.count().unitDivided(by: .minute())
        case .steps:
            return .count()
        case .activeEnergy:
            return .kilocalorie()
        case .weight:
            return .gramUnit(with: .kilo)
        case .vo2Max:
            return HKUnit.literUnit(with: .milli)
                .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
        }
    }
}

final class HealthKitSampleWriter: HealthSampleWriting {
    private let healthStore: HKHealthStore

    init(healthStore: HKHealthStore) {
        self.healthStore = healthStore
    }

    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
        let quantityType = metric.sampleType as! HKQuantityType
        let quantity = HKQuantity(unit: HealthUnitMapper.unit(for: metric), doubleValue: value)
        let sample = HKQuantitySample(type: quantityType, quantity: quantity, start: timestamp, end: timestamp)
        try await healthStore.save(sample)
    }
}
```

- [ ] **Step 5: Implement `PendingWritesSyncer`**

Each pending write is applied and acknowledged independently — one item's failure (unknown metric, unparseable timestamp, `HKHealthStore.save()` rejection, or a network drop on the ack call) is caught and skipped, never allowed to abort the rest of the batch.

`ios/HealthBridge/Sync/PendingWritesSyncer.swift`:
```swift
import Foundation

final class PendingWritesSyncer {
    private let networking: PendingWritesNetworking
    private let writer: HealthSampleWriting
    private let dateFormatter: ISO8601DateFormatter
    private let fallbackDateFormatter: ISO8601DateFormatter

    init(networking: PendingWritesNetworking, writer: HealthSampleWriting) {
        self.networking = networking
        self.writer = writer
        dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        fallbackDateFormatter = ISO8601DateFormatter()
    }

    @discardableResult
    func syncOnce() async -> Int {
        let pending: [PendingWriteDTO]
        do {
            pending = try await networking.fetchPendingWrites()
        } catch {
            return 0
        }

        var appliedCount = 0
        for item in pending {
            guard let metric = HealthMetric(rawValue: item.metric) else { continue }
            guard let timestamp = parseTimestamp(item.timestamp) else { continue }

            do {
                try await writer.save(metric: metric, value: item.value, timestamp: timestamp)
                try await networking.acknowledge(id: item.id)
                appliedCount += 1
            } catch {
                // Covers both a save failure (nothing was written — safe to
                // retry next poll) and an ack failure after a successful
                // save (the write DID happen; the backend will re-deliver
                // and this will write a duplicate sample next time, which is
                // the safer failure direction for a personal health app
                // than silently losing data).
                continue
            }
        }
        return appliedCount
    }

    private func parseTimestamp(_ raw: String) -> Date? {
        dateFormatter.date(from: raw) ?? fallbackDateFormatter.date(from: raw)
    }
}
```

- [ ] **Step 6: Run tests, verify pass**

```bash
xcodebuild test -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16'
```

- [ ] **Step 7: Wire `BGAppRefreshTask` scheduling into `AppDelegate`**

`ios/HealthBridge/AppDelegate.swift`:
```swift
import UIKit
import BackgroundTasks

final class AppDelegate: NSObject, UIApplicationDelegate {
    static let pendingWritesRefreshTaskIdentifier = "com.healthtracker.iosbridge.pending-writes-refresh"

    var backgroundUploadSession: BackgroundUploadSession?
    var pendingWritesSyncer: PendingWritesSyncer?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: Self.pendingWritesRefreshTaskIdentifier, using: nil) { [weak self] task in
            self?.handlePendingWritesRefresh(task: task as! BGAppRefreshTask)
        }
        return true
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        guard identifier == BackgroundUploadSession.identifier else {
            completionHandler()
            return
        }
        backgroundUploadSession?.backgroundCompletionHandler = completionHandler
    }

    func scheduleNextPendingWritesRefresh() {
        let request = BGAppRefreshTaskRequest(identifier: Self.pendingWritesRefreshTaskIdentifier)
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    private func handlePendingWritesRefresh(task: BGAppRefreshTask) {
        scheduleNextPendingWritesRefresh()

        let operation = Task {
            _ = await pendingWritesSyncer?.syncOnce()
            task.setTaskCompleted(success: true)
        }

        task.expirationHandler = {
            operation.cancel()
        }
    }
}
```

(`BGAppRefreshTask` + `BGTaskScheduler` is the current — iOS 13+, still current in iOS 26 — API for opportunistic background app refresh; it complements, but does not replace, the `HKObserverQuery` background-delivery path from Task 4, which is what actually drives sample uploads.)

- [ ] **Step 8: Wire the syncer into the app entry point, with scene-foreground trigger**

`ios/HealthBridge/HealthBridgeApp.swift`:
```swift
import SwiftUI
import HealthKit

@main
struct HealthBridgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var authManager = HealthKitAuthManager()
    private let uploadSession = BackgroundUploadSession()
    private let anchorStore = SyncAnchorStore()
    private let lastSyncStore = LastSyncStore()
    private let pendingWritesSyncer: PendingWritesSyncer
    private var coordinator: HealthObserverCoordinator!

    init() {
        let authManager = self.authManager
        coordinator = HealthObserverCoordinator(
            healthStore: HKHealthStore(),
            anchorStore: anchorStore,
            uploadSession: uploadSession,
            authManager: authManager,
            lastSyncStore: lastSyncStore,
            endpoint: AppConfig.healthEventsEndpoint,
            bearerToken: AppConfig.bearerToken
        )
        pendingWritesSyncer = PendingWritesSyncer(
            networking: PendingWritesClient(
                pendingWritesURL: AppConfig.pendingWritesEndpoint,
                bearerToken: AppConfig.bearerToken
            ),
            writer: HealthKitSampleWriter(healthStore: HKHealthStore())
        )
    }

    var body: some Scene {
        WindowGroup {
            Text("HealthBridge")
                .environment(authManager)
                .task {
                    appDelegate.backgroundUploadSession = uploadSession
                    appDelegate.pendingWritesSyncer = pendingWritesSyncer
                    await authManager.requestAuthorizationIfNeeded()
                    coordinator.startObserving()
                    appDelegate.scheduleNextPendingWritesRefresh()
                }
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await pendingWritesSyncer.syncOnce() }
            }
        }
    }
}
```

- [ ] **Step 9: Commit**
```bash
git add ios/HealthBridge/Sync/PendingWritesClient.swift ios/HealthBridge/Sync/HealthKitSampleWriter.swift ios/HealthBridge/Sync/PendingWritesSyncer.swift ios/HealthBridge/AppDelegate.swift ios/HealthBridge/HealthBridgeApp.swift ios/HealthBridge/Info.plist ios/HealthBridgeTests/PendingWritesSyncerTests.swift
git commit -m "feat: add write-back polling consumer with per-item error isolation and BGAppRefreshTask/foreground triggers"
```

---

### Task 6: Status UI

**Files:**
- Create: `ios/HealthBridge/UI/StatusRow.swift`
- Create: `ios/HealthBridge/UI/StatusViewModel.swift`
- Create: `ios/HealthBridge/UI/StatusView.swift`
- Create: `ios/HealthBridge/UI/HealthObserverCoordinatorEnvironmentKey.swift`
- Modify: `ios/HealthBridge/HealthBridgeApp.swift`
- Create (test target): `ios/HealthBridgeTests/StatusViewModelTests.swift`

**Interfaces:**
- Consumes: `HealthKitAuthManager.isEnabled(_:)`/`setEnabled(_:for:)`/`authorizationError` (Task 3), `LastSyncStore.lastSync(for:)` (Task 4), `BackgroundDeliveryToggling.startObserving(metric:)`/`stopObserving(metric:)` and `HealthObserverCoordinator.onDeliveryError` (Task 4).
- Produces: `StatusView` — the app's sole UI screen, set as the `WindowGroup` root, replacing the placeholder `Text("HealthBridge")` used in Tasks 3-5.

**What is unit-tested vs. not:** `StatusViewModel.relativeDescription(for:now:)` (pure date formatting) and `refresh()`'s row-building logic, including error-message propagation, are unit-tested with an injected `now` closure and no real HealthKit dependency. `StatusView`'s SwiftUI rendering is not unit-tested (standard for SwiftUI views); it is exercised via the manual procedure in Task 7 and can be visually checked in Xcode Previews.

- [ ] **Step 1: Define `StatusRow`**

`ios/HealthBridge/UI/StatusRow.swift`:
```swift
import Foundation

struct StatusRow: Identifiable, Equatable {
    let id: HealthMetric
    let displayName: String
    let isEnabled: Bool
    let lastSyncDescription: String
    /// Non-nil when this metric's background delivery hit an error (auth
    /// denied, HealthKit rejected the request, an upload batch failed) —
    /// rendered distinctly from the normal "Last synced ..." caption so a
    /// broken metric never looks identical to one that just hasn't synced yet.
    let errorMessage: String?
}
```

- [ ] **Step 2: Write failing tests for `StatusViewModel`, including error propagation**

`ios/HealthBridgeTests/StatusViewModelTests.swift`:
```swift
import XCTest
@testable import HealthBridge

final class StatusViewModelTests: XCTestCase {
    func testNeverSyncedDescription() {
        let description = StatusViewModel.relativeDescription(for: nil, now: Date())
        XCTAssertEqual(description, "Never synced")
    }

    func testJustNowDescription() {
        let now = Date(timeIntervalSince1970: 1_757_000_000)
        let description = StatusViewModel.relativeDescription(for: now.addingTimeInterval(-10), now: now)
        XCTAssertEqual(description, "Last synced just now")
    }

    func testHoursAgoDescriptionMentionsHours() {
        let now = Date(timeIntervalSince1970: 1_757_000_000)
        let twoHoursAgo = now.addingTimeInterval(-2 * 60 * 60)
        let description = StatusViewModel.relativeDescription(for: twoHoursAgo, now: now)
        XCTAssertTrue(description.hasPrefix("Last synced"))
        XCTAssertTrue(description.contains("hour"))
    }

    func testRefreshBuildsRowForEveryMetric() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)

        XCTAssertEqual(viewModel.rows.count, HealthMetric.allCases.count)
        XCTAssertTrue(viewModel.rows.allSatisfy { $0.errorMessage == nil })
    }

    func testDeliveryErrorForOneMetricAppearsOnlyOnThatRow() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests2")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests2")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)
        viewModel.recordDeliveryError("Background delivery not authorized", for: .steps)

        let stepsRow = viewModel.rows.first { $0.id == .steps }
        let heartRateRow = viewModel.rows.first { $0.id == .heartRate }
        XCTAssertEqual(stepsRow?.errorMessage, "Background delivery not authorized")
        XCTAssertNil(heartRateRow?.errorMessage)
    }

    func testTogglingAMetricOffClearsItsErrorMessage() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests3")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests3")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)
        viewModel.recordDeliveryError("Background delivery not authorized", for: .steps)
        viewModel.setEnabled(false, for: .steps)

        let stepsRow = viewModel.rows.first { $0.id == .steps }
        XCTAssertNil(stepsRow?.errorMessage) // a disabled metric isn't "broken", it's off
    }
}
```

Run, confirm compile failure.

- [ ] **Step 3: Implement `StatusViewModel`**

`ios/HealthBridge/UI/StatusViewModel.swift`:
```swift
import Foundation
import Observation

@Observable
final class StatusViewModel {
    private let authManager: HealthKitAuthManager
    private let lastSyncStore: LastSyncStore
    private weak var deliveryToggle: BackgroundDeliveryToggling?
    private let now: () -> Date
    private var deliveryErrors: [HealthMetric: String] = [:]

    private(set) var rows: [StatusRow] = []

    init(
        authManager: HealthKitAuthManager,
        lastSyncStore: LastSyncStore,
        deliveryToggle: BackgroundDeliveryToggling?,
        now: @escaping () -> Date = Date.init
    ) {
        self.authManager = authManager
        self.lastSyncStore = lastSyncStore
        self.deliveryToggle = deliveryToggle
        self.now = now
        refresh()
    }

    func refresh() {
        rows = HealthMetric.allCases.map { metric in
            StatusRow(
                id: metric,
                displayName: metric.displayName,
                isEnabled: authManager.isEnabled(metric),
                lastSyncDescription: Self.relativeDescription(for: lastSyncStore.lastSync(for: metric), now: now()),
                errorMessage: authManager.isEnabled(metric) ? deliveryErrors[metric] : nil
            )
        }
    }

    /// Called from the app-level wiring whenever `HealthObserverCoordinator.onDeliveryError`
    /// fires for a metric — see Task 4. Kept as a plain method (not a closure captured
    /// at init time) so it can be attached after both objects exist.
    func recordDeliveryError(_ message: String, for metric: HealthMetric) {
        deliveryErrors[metric] = message
        refresh()
    }

    func setEnabled(_ enabled: Bool, for metric: HealthMetric) {
        authManager.setEnabled(enabled, for: metric)
        if enabled {
            deliveryToggle?.startObserving(metric: metric)
        } else {
            deliveryToggle?.stopObserving(metric: metric)
            deliveryErrors[metric] = nil // an intentionally-off metric isn't "broken"
        }
        refresh()
    }

    static func relativeDescription(for date: Date?, now: Date) -> String {
        guard let date else { return "Never synced" }
        let interval = now.timeIntervalSince(date)
        if interval < 60 {
            return "Last synced just now"
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        let phrase = formatter.localizedString(for: date, relativeTo: now)
        return "Last synced \(phrase)"
    }
}
```

Run tests, verify pass.

- [ ] **Step 4: Custom environment key for injecting the coordinator into the view**

`ios/HealthBridge/UI/HealthObserverCoordinatorEnvironmentKey.swift`:
```swift
import SwiftUI

private struct HealthObserverCoordinatorKey: EnvironmentKey {
    static let defaultValue: BackgroundDeliveryToggling? = nil
}

extension EnvironmentValues {
    var healthObserverCoordinator: BackgroundDeliveryToggling? {
        get { self[HealthObserverCoordinatorKey.self] }
        set { self[HealthObserverCoordinatorKey.self] = newValue }
    }
}
```

- [ ] **Step 5: Implement `StatusView`**

`ios/HealthBridge/UI/StatusView.swift`:
```swift
import SwiftUI

struct StatusView: View {
    @Environment(HealthKitAuthManager.self) private var authManager
    @Environment(\.healthObserverCoordinator) private var deliveryToggle
    let lastSyncStore: LastSyncStore
    @State private var viewModel: StatusViewModel?

    var body: some View {
        NavigationStack {
            List {
                if let authError = authManager.authorizationError {
                    Section {
                        Text(authError)
                            .foregroundStyle(.red)
                    } header: {
                        Text("Authorization Error")
                    }
                }
                Section {
                    ForEach(viewModel?.rows ?? []) { row in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.displayName)
                                    .font(.body)
                                if let errorMessage = row.errorMessage {
                                    Text(errorMessage)
                                        .font(.caption)
                                        .foregroundStyle(.red)
                                } else {
                                    Text(row.lastSyncDescription)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer()
                            Toggle(
                                "",
                                isOn: Binding(
                                    get: { row.isEnabled },
                                    set: { newValue in viewModel?.setEnabled(newValue, for: row.id) }
                                )
                            )
                            .labelsHidden()
                        }
                    }
                } footer: {
                    Text("Sync timing is controlled by iOS in the background and is not real-time.")
                }
            }
            .navigationTitle("HealthBridge")
            .onAppear {
                if viewModel == nil {
                    viewModel = StatusViewModel(
                        authManager: authManager,
                        lastSyncStore: lastSyncStore,
                        deliveryToggle: deliveryToggle
                    )
                }
            }
        }
    }
}
```

Note: `LastSyncStore` is passed in directly as a plain property, not via `.environment(_:)`, since it's only read once per `onAppear`/`refresh()` call rather than driving live SwiftUI diffing on every write — `refresh()` is explicitly invoked on toggle and on next appear, which is sufficient here.

- [ ] **Step 6: Wire `StatusView`, the coordinator, and the delivery-error callback into the app entry point**

`ios/HealthBridge/HealthBridgeApp.swift` (replacing the `Text("HealthBridge")` placeholder — note the new `statusViewModel` and the `onDeliveryError` wiring, which is what makes Task 4's error-surfacing actually reach the UI):
```swift
@State private var statusViewModel: StatusViewModel?

var body: some Scene {
    WindowGroup {
        StatusView(lastSyncStore: lastSyncStore)
            .environment(authManager)
            .environment(\.healthObserverCoordinator, coordinator)
            .task {
                appDelegate.backgroundUploadSession = uploadSession
                appDelegate.pendingWritesSyncer = pendingWritesSyncer
                await authManager.requestAuthorizationIfNeeded()
                coordinator.startObserving()
                appDelegate.scheduleNextPendingWritesRefresh()
            }
    }
    .onChange(of: scenePhase) { _, newPhase in
        if newPhase == .active {
            Task { await pendingWritesSyncer.syncOnce() }
        }
    }
}
```
Since `StatusViewModel` is created inside `StatusView.onAppear` (Step 5) rather than at the `App` struct level, wire `coordinator.onDeliveryError` to it there instead — modify `StatusView`'s `onAppear`:
```swift
.onAppear {
    if viewModel == nil {
        let vm = StatusViewModel(
            authManager: authManager,
            lastSyncStore: lastSyncStore,
            deliveryToggle: deliveryToggle
        )
        if let coordinator = deliveryToggle as? HealthObserverCoordinator {
            coordinator.onDeliveryError = { [weak vm] metric, message in
                vm?.recordDeliveryError(message, for: metric)
            }
        }
        viewModel = vm
    }
}
```

- [ ] **Step 7: Run full test suite, verify pass; build for device**

```bash
xcodebuild test -project ios/HealthBridge.xcodeproj -scheme HealthBridge -destination 'platform=iOS Simulator,name=iPhone 16'
```

- [ ] **Step 8: Commit**
```bash
git add ios/HealthBridge/UI ios/HealthBridge/HealthBridgeApp.swift ios/HealthBridgeTests/StatusViewModelTests.swift
git commit -m "feat: add status screen with per-metric last-sync time, enable/disable toggles, and visible sync-error state"
```

---

### Task 7: Manual verification checklist (physical device required — not automatable)

**Files:** None. HealthKit background delivery cannot be exercised in CI or the simulator; this is a human-executed procedure on a real iPhone (optionally with an Apple Watch), run after Task 6 is complete and the app is installed via Xcode on a device signed with a paid Apple Developer Program team.

- [ ] **Step 1: Confirm prerequisites before starting**
  - Physical iPhone on iOS 17+, connected to Xcode, with a paid Apple Developer Program team selected in Signing & Capabilities (not a free personal team — background delivery needs to survive beyond the 7-day free-team signing window).
  - `AppConfig.healthEventsEndpoint`, `AppConfig.pendingWritesEndpoint`, and `AppConfig.bearerToken` in `ios/HealthBridge/AppConfig.swift` point at your real, reachable backend and match its `MCP_ACCESS_TOKEN` env var exactly (this is the same secret the backend's health-events router already uses — not a separate token).
  - Install via Xcode Run (Cmd+R), not TestFlight, so you can watch the Xcode Console/device log during the test.

- [ ] **Step 2: Grant HealthKit permissions, and verify a denied/unavailable case is visible**
  - Launch the app. When the system authorization sheet appears, turn ON both read and write for all five: Heart Rate, Steps, Active Energy, Weight, VO2 Max. Confirm.
  - On the StatusView, confirm all 5 rows read "Never synced" and all toggles are ON, and there is no "Authorization Error" banner.
  - (Optional, confirms Task 3's error path): if you have access to a second device where HealthKit is unavailable (some iPad models, if testing there despite the iPhone-only target), confirm the "Authorization Error" banner appears instead of a silent failure.

- [ ] **Step 3: Verify a new steps sample syncs after backgrounding**
  - Walk with the phone (or an Apple Watch) for ~30 steps so a fresh step-count sample is recorded in Health.
  - Background the app (press Home / swipe up) — do not force-quit it.
  - Lock the phone screen and wait 15-30 minutes without opening the app (HealthKit's `.immediate` frequency typically delivers within minutes, but the OS may batch/delay further; the status UI must never claim real-time delivery, only "last synced X ago").
  - Check the backend directly for the new record:
    ```bash
    mongosh "<your-connection-string>" --eval 'db.healthsamples.find({metric:"steps"}).sort({_id:-1}).limit(3)'
    ```
    Confirm a document with `source: "ios-bridge"`, `metric: "steps"`, and a `timestamp` matching the test window.
  - Reopen the app in the foreground; confirm the Steps row now reads "Last synced <N> minutes ago" instead of "Never synced", with no error message.

- [ ] **Step 4: Repeat for the remaining four metrics**
  - Heart Rate: via Apple Watch, complete a short measurement or workout so a new heart-rate sample is recorded; repeat the background/wait/verify steps above with `metric:"heart_rate"`.
  - Active Energy: complete a short Watch workout or manually log a workout in the Fitness app; verify with `metric:"active_energy"`.
  - Weight: open the Health app → Body Measurements → Weight → add a new manual entry; verify with `metric:"weight"`.
  - VO2 Max: if your device/Watch has a recent VO2 max estimate, a new one is only generated by Apple's own algorithm — if none is generated within the test window, skip live generation and instead force reprocessing of an existing historical sample by clearing the app's UserDefaults (delete and reinstall, or use the Settings app's "Reset" for this app if available) and confirm it uploads with `metric:"vo2max"`.

- [ ] **Step 5: Verify a broken metric shows a visible error, not silence**
  - In the app's Settings/toggle UI, toggle a metric OFF then back ON to trigger `startObserving(metric:)` again. If your test device's background-delivery entitlement is misconfigured (e.g. testing against a free personal team, which is the exact failure this plan warns about), confirm the corresponding StatusView row shows a red error message rather than silently staying on "Never synced" forever with no explanation.

- [ ] **Step 6: Verify the write-back consumer, including a mid-batch failure**
  - Manually insert two pending writes directly into the backend, one for a metric HealthKit will accept and one deliberately malformed (invalid metric name) to exercise the per-item error isolation from Task 5:
    ```bash
    mongosh "<your-connection-string>" --eval 'db.pendingwrites.insertMany([{metric:"weight", value:68.5, unit:"kg", timestamp:new Date(), delivered:false}, {metric:"not_a_real_metric", value:1, timestamp:new Date(), delivered:false}])'
    ```
  - Foreground the HealthBridge app (this is the reliable manual trigger — `BGAppRefreshTask` timing is entirely OS-scheduled and cannot be forced on demand).
  - Open the Health app → Body Measurements → Weight and confirm a new 68.5 kg entry attributed to HealthBridge appears — proving the malformed second item did not block the valid first one.
  - Re-query the backend and confirm the weight record now shows `delivered: true` with a `deliveredAt` timestamp, while the malformed-metric record remains `delivered: false` forever (expected — an unrecognized metric can never be applied, so it will keep being fetched and skipped on every poll; this is an accepted tradeoff for a personal app with no admin UI to purge bad records, not a bug):
    ```bash
    mongosh "<your-connection-string>" --eval 'db.pendingwrites.find({}).sort({_id:-1}).limit(2)'
    ```

- [ ] **Step 7: Verify anchor retry-on-failure behavior**
  - Temporarily point `AppConfig.healthEventsEndpoint` at an unreachable host (e.g. change the port to one nothing listens on), rebuild, and reinstall.
  - Generate one new steps sample, background the app, wait through a delivery window, then confirm via `mongosh` that no new `HealthSample` document was stored, and that the Steps row on StatusView shows an error state (per Task 4's `onDeliveryError` wiring), not a silent "Never synced".
  - Restore the correct `AppConfig.healthEventsEndpoint`, rebuild, reinstall, relaunch, and background again without generating any new sample.
  - Confirm the same steps sample from the failed attempt now appears in `db.healthsamples` — this proves the anchor was not advanced on failure and the identical sample set was retried, per the design in Task 4 Step 9.

- [ ] **Step 8: Record results**
  - Note pass/fail and observed sync latency per metric. No file needs to be created for this — report results directly to whoever is validating the release.

---

## Self-Review

**Spec coverage:** Design spec §9 build-sequence step 4 (iOS bridge app: HealthKit read authorization, `HKObserverQuery` + background delivery, POST to ingestion, write-back queue consumer, minimal status UI) → Tasks 2-6. §4.2's data-flow description (ingestion adapter is the isolated seam; write-back goes the same path in reverse via a small polling endpoint) → Task 1 (backend prerequisite) and Task 5. §4.2's honesty requirement ("the UI must never imply real-time sync") → Task 6's status UI and its explicit footer text. §11's open item (Apple Developer Program enrollment as a user action, not an engineering task) → named explicitly in this plan's Global Constraints and Task 7's prerequisites, not silently assumed.

**Placeholder scan:** No TBD/TODO markers. `AppConfig.bearerToken`'s placeholder string is an intentional, explicitly-labeled local-configuration value (never a real secret committed to source), not a plan gap.

**Type consistency (corrected during integration against the actual `api/` codebase, not the initial draft):** the backend prerequisite task originally referenced a `HealthEvent` model and an `app` singleton import that do not exist in this codebase, and a `HEALTH_EVENTS_BEARER_TOKEN` env var that duplicates the existing `MCP_ACCESS_TOKEN` secret under a new name — all three were corrected to match the real `HealthSample` model, `createApp()` factory, and `MCP_ACCESS_TOKEN` env var exactly, and the new routes reuse the existing per-request bearer-token wrapper pattern rather than reintroducing the mount-time-capture bug backend-core's Task 7 already found and fixed once. `HealthMetric`'s rawValues (`heart_rate`, `steps`, `active_energy`, `weight`, `vo2max`) match the backend's `HealthEventPayloadSchema`/`HealthSample` enum exactly on both sides of the wire. `PendingWriteDTO`'s field names (`id`, `metric`, `value`, `unit`, `timestamp`) match Task 1's route response shape exactly.

**Error-handling review (added after an explicit request to verify edge-case coverage):** every network/HealthKit boundary call in this plan is wrapped and its failure mode traced through to a concrete, testable outcome — `requestAuthorizationIfNeeded` surfaces a failure via `authorizationError` instead of a silently-swallowed `try?`; `enableBackgroundDelivery`/`HKObserverQuery` failures propagate via `onDeliveryError` to a visible per-row status message instead of only a console `print`; upload-batch failures never advance the sync anchor (guaranteeing retry, never silent data loss) and are also now surfaced via the same `onDeliveryError` path; `PendingWritesSyncer` isolates each pending write's failure so one bad item never blocks the rest of the batch, and a save-succeeds-but-ack-fails race is deliberately handled by favoring a possible duplicate Health entry over a lost one (documented as an accepted tradeoff, not an oversight) — Task 7's manual verification procedure explicitly exercises the broken-metric-shows-an-error and mid-batch-partial-failure cases, not just the happy path.
</content>
