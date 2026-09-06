import Foundation
@preconcurrency import HealthKit

protocol BackgroundDeliveryToggling: AnyObject {
    func startObserving(metric: HealthMetric)
    func stopObserving(metric: HealthMetric)
}

/// Tracks which metrics currently have an anchored-query batch in flight, so a second
/// `HKObserverQuery` trigger for the same metric — which can legitimately fire again
/// before the prior trigger's batch has resolved (anchor advanced or failed) — doesn't
/// start a second, overlapping batch against the same not-yet-advanced anchor. This is
/// pure bookkeeping with no HealthKit dependency, so it's unit-testable on its own.
final class InFlightMetricGuard {
    private var metricsInFlight: Set<HealthMetric> = []
    private let lock = NSLock()

    /// Returns `true` if this call claimed the in-flight slot for `metric` (no batch
    /// was already running for it). Returns `false` if a batch is already in flight —
    /// the caller should skip processing this trigger; the anchor is unchanged, so the
    /// next trigger after the in-flight batch resolves will pick up any further changes.
    func beginBatch(for metric: HealthMetric) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !metricsInFlight.contains(metric) else { return false }
        metricsInFlight.insert(metric)
        return true
    }

    func endBatch(for metric: HealthMetric) {
        lock.lock()
        defer { lock.unlock() }
        metricsInFlight.remove(metric)
    }
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
    private let inFlightGuard = InFlightMetricGuard()

    /// Tracks the running `HKObserverQuery` per metric so `stopObserving(metric:)` can
    /// actually stop it — `startObserving`/`stopObserving` are driven by the main-thread
    /// UI toggle in practice, but this is guarded with a lock defensively, matching the
    /// style of `batchLock`/`inFlightGuard` above.
    private var observerQueries: [HealthMetric: HKObserverQuery] = [:]
    private let observerQueriesLock = NSLock()

    private func setObserverQuery(_ query: HKObserverQuery, for metric: HealthMetric) {
        observerQueriesLock.lock()
        defer { observerQueriesLock.unlock() }
        if let existing = observerQueries[metric] {
            healthStore.stop(existing)
        }
        observerQueries[metric] = query
    }

    private func removeObserverQuery(for metric: HealthMetric) -> HKObserverQuery? {
        observerQueriesLock.lock()
        defer { observerQueriesLock.unlock() }
        return observerQueries.removeValue(forKey: metric)
    }

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
        // Defense in depth: if the observer somehow still fires for a metric the user has
        // disabled (e.g. a trigger already in flight when `stopObserving` ran), don't run
        // the anchored query at all — just acknowledge the trigger and bail.
        guard authManager.isEnabled(metric) else {
            observerCompletion()
            return
        }

        // If a batch for this metric is already in flight, skip this trigger rather than
        // racing a second HKAnchoredObjectQuery against the same not-yet-advanced anchor
        // (which would risk duplicate uploads). Nothing is lost: the anchor hasn't moved,
        // so the next trigger after the in-flight batch resolves will pick up any changes.
        guard inFlightGuard.beginBatch(for: metric) else {
            observerCompletion()
            return
        }

        let anchor = anchorStore.anchor(for: metric)
        // Exclude samples written by this app's own HKSource: HealthKitSampleWriter
        // (Task 5) writes backend-originated pending writes back into HealthKit, and
        // without this exclusion this anchored query would immediately pick those
        // writes back up and re-POST them to the ingestion endpoint — a pointless
        // echo. `HKQuery.predicateForObjects(from:)` and `HKSource.default()` are both
        // real HealthKit APIs (HKSource.default() returns the running app's HKSource;
        // predicateForObjects(from:) accepts an HKSource and matches samples whose
        // HKSource equals it).
        let ownSourcePredicate = HKQuery.predicateForObjects(from: HKSource.default())
        let excludeOwnSourcePredicate = NSCompoundPredicate(notPredicateWithSubpredicate: ownSourcePredicate)
        let anchoredQuery = HKAnchoredObjectQuery(
            type: metric.sampleType,
            predicate: excludeOwnSourcePredicate,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self else {
                observerCompletion()
                return
            }
            guard error == nil, let newAnchor, let samples = samples as? [HKQuantitySample], !samples.isEmpty else {
                self.inFlightGuard.endBatch(for: metric)
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

        inFlightGuard.endBatch(for: batch.metric)

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

        setObserverQuery(query, for: metric)
        healthStore.execute(query)
    }

    func stopObserving(metric: HealthMetric) {
        healthStore.disableBackgroundDelivery(for: metric.sampleType) { _, _ in }
        if let query = removeObserverQuery(for: metric) {
            healthStore.stop(query)
        }
    }
}

extension HealthObserverCoordinator: BackgroundUploadSessionDelegateHandler {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool) {
        guard let batchID = identifier.split(separator: "#").first.map(String.init) else { return }
        markTaskComplete(taskIdentifier: identifier, batchID: batchID, success: success)
    }
}

/// Syncs HKWorkout data (runs, rides, swims, etc.) — a fundamentally
/// different sample shape than HealthMetric's quantity samples, so this
/// mirrors HealthObserverCoordinator's proven anchor/in-flight/batch pattern
/// rather than being generalized into it. Read-only: this app has no feature
/// that creates HKWorkout data, so there is no write-back path, no per-item
/// HealthMetric to key off, and no enable/disable toggle in the status UI —
/// workout sync is simply on whenever HealthKit authorization succeeds.
final class WorkoutSyncCoordinator {
    private static let anchorKey = "workouts"

    private let healthStore: HKHealthStore
    private let anchorStore: SyncAnchorStore
    private let uploadSession: BackgroundUploadSession
    private let lastSyncStore: LastSyncStore
    private let endpoint: URL
    private let bearerToken: String

    var onDeliveryError: ((String) -> Void)?

    private struct PendingBatch {
        let newAnchor: HKQueryAnchor
        let observerCompletion: HKObserverQueryCompletionHandler
        var remainingTaskIdentifiers: Set<String>
        var allSucceeded: Bool
    }

    private var pendingBatches: [String: PendingBatch] = [:]
    private let batchLock = NSLock()
    private var batchInFlight = false
    private let inFlightLock = NSLock()
    private var observerQuery: HKObserverQuery?

    init(
        healthStore: HKHealthStore,
        anchorStore: SyncAnchorStore,
        uploadSession: BackgroundUploadSession,
        lastSyncStore: LastSyncStore,
        endpoint: URL,
        bearerToken: String
    ) {
        self.healthStore = healthStore
        self.anchorStore = anchorStore
        self.uploadSession = uploadSession
        self.lastSyncStore = lastSyncStore
        self.endpoint = endpoint
        self.bearerToken = bearerToken
        uploadSession.delegateHandler = self
    }

    private func beginBatch() -> Bool {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        guard !batchInFlight else { return false }
        batchInFlight = true
        return true
    }

    private func endBatch() {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        batchInFlight = false
    }

    func startObserving() {
        let workoutType = HKObjectType.workoutType()

        healthStore.enableBackgroundDelivery(for: workoutType, frequency: .immediate) { [weak self] success, error in
            if !success {
                let message = error?.localizedDescription ?? "Background delivery could not be enabled"
                self?.onDeliveryError?(message)
            }
        }

        let query = HKObserverQuery(sampleType: workoutType, predicate: nil) { [weak self] _, completionHandler, error in
            guard let self else {
                completionHandler()
                return
            }
            if let error {
                self.onDeliveryError?(error.localizedDescription)
                completionHandler()
                return
            }
            self.handleObserverTrigger(observerCompletion: completionHandler)
        }

        if let existing = observerQuery {
            healthStore.stop(existing)
        }
        observerQuery = query
        healthStore.execute(query)
    }

    private func handleObserverTrigger(observerCompletion: @escaping HKObserverQueryCompletionHandler) {
        guard beginBatch() else {
            observerCompletion()
            return
        }

        let anchor = anchorStore.anchor(forKey: Self.anchorKey)
        let anchoredQuery = HKAnchoredObjectQuery(
            type: .workoutType(),
            predicate: nil,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self else {
                observerCompletion()
                return
            }
            guard error == nil, let newAnchor, let workouts = samples as? [HKWorkout], !workouts.isEmpty else {
                self.endBatch()
                observerCompletion()
                return
            }
            self.uploadBatch(workouts: workouts, newAnchor: newAnchor, observerCompletion: observerCompletion)
        }

        healthStore.execute(anchoredQuery)
    }

    private func uploadBatch(
        workouts: [HKWorkout],
        newAnchor: HKQueryAnchor,
        observerCompletion: @escaping HKObserverQueryCompletionHandler
    ) {
        let batchID = UUID().uuidString
        var taskIdentifiers: Set<String> = []
        for workout in workouts {
            taskIdentifiers.insert("\(batchID)#\(workout.uuid.uuidString)")
        }

        batchLock.lock()
        pendingBatches[batchID] = PendingBatch(
            newAnchor: newAnchor,
            observerCompletion: observerCompletion,
            remainingTaskIdentifiers: taskIdentifiers,
            allSucceeded: true
        )
        batchLock.unlock()

        for workout in workouts {
            let taskIdentifier = "\(batchID)#\(workout.uuid.uuidString)"
            let payload = WorkoutNormalizer.payload(for: workout)
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

        endBatch()

        if batch.allSucceeded {
            anchorStore.save(batch.newAnchor, forKey: Self.anchorKey)
            lastSyncStore.recordSync(forKey: Self.anchorKey, at: Date())
        } else {
            onDeliveryError?("Some workouts failed to upload — will retry on the next sync.")
        }
        batch.observerCompletion()
    }
}

extension WorkoutSyncCoordinator: BackgroundUploadSessionDelegateHandler {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool) {
        guard let batchID = identifier.split(separator: "#").first.map(String.init) else { return }
        markTaskComplete(taskIdentifier: identifier, batchID: batchID, success: success)
    }
}
