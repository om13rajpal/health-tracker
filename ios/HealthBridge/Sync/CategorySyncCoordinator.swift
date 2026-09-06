import Foundation
import HealthKit

/// Syncs HKCategorySample types (sleep stages, stand hours, mindful
/// sessions, heart/hygiene event markers) — mirrors
/// HealthObserverCoordinator's proven anchor/in-flight/batch pattern,
/// generalized over HealthCategoryMetric instead of HealthMetric since the
/// underlying HKSample subtype and value shape differ. Read-only: this app
/// has no feature that creates HKCategorySample data.
final class CategorySyncCoordinator {
    private let healthStore: HKHealthStore
    private let anchorStore: SyncAnchorStore
    private let uploadSession: BackgroundUploadSession
    private let lastSyncStore: LastSyncStore
    private let endpoint: URL
    private let bearerToken: String

    var onDeliveryError: ((HealthCategoryMetric, String) -> Void)?

    private struct PendingBatch {
        let category: HealthCategoryMetric
        let newAnchor: HKQueryAnchor
        let observerCompletion: HKObserverQueryCompletionHandler
        var remainingTaskIdentifiers: Set<String>
        var allSucceeded: Bool
    }

    private var pendingBatches: [String: PendingBatch] = [:]
    private let batchLock = NSLock()
    private var categoriesInFlight: Set<HealthCategoryMetric> = []
    private let inFlightLock = NSLock()
    private var observerQueries: [HealthCategoryMetric: HKObserverQuery] = [:]
    private let observerQueriesLock = NSLock()

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

    private func beginBatch(for category: HealthCategoryMetric) -> Bool {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        guard !categoriesInFlight.contains(category) else { return false }
        categoriesInFlight.insert(category)
        return true
    }

    private func endBatch(for category: HealthCategoryMetric) {
        inFlightLock.lock()
        defer { inFlightLock.unlock() }
        categoriesInFlight.remove(category)
    }

    private func setObserverQuery(_ query: HKObserverQuery, for category: HealthCategoryMetric) {
        observerQueriesLock.lock()
        defer { observerQueriesLock.unlock() }
        if let existing = observerQueries[category] {
            healthStore.stop(existing)
        }
        observerQueries[category] = query
    }

    func startObserving() {
        for category in HealthCategoryMetric.allCases {
            startObserving(category: category)
        }
    }

    private func startObserving(category: HealthCategoryMetric) {
        let categoryType = category.categoryType

        healthStore.enableBackgroundDelivery(for: categoryType, frequency: .immediate) { [weak self] success, error in
            if !success {
                let message = error?.localizedDescription ?? "Background delivery could not be enabled"
                self?.onDeliveryError?(category, message)
            }
        }

        let query = HKObserverQuery(sampleType: categoryType, predicate: nil) { [weak self] _, completionHandler, error in
            guard let self else {
                completionHandler()
                return
            }
            if let error {
                self.onDeliveryError?(category, error.localizedDescription)
                completionHandler()
                return
            }
            self.handleObserverTrigger(category: category, observerCompletion: completionHandler)
        }

        setObserverQuery(query, for: category)
        healthStore.execute(query)
    }

    private func handleObserverTrigger(category: HealthCategoryMetric, observerCompletion: @escaping HKObserverQueryCompletionHandler) {
        guard beginBatch(for: category) else {
            observerCompletion()
            return
        }

        let anchor = anchorStore.anchor(forKey: category.rawValue)
        let anchoredQuery = HKAnchoredObjectQuery(
            type: category.categoryType,
            predicate: nil,
            anchor: anchor,
            limit: HKObjectQueryNoLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self else {
                observerCompletion()
                return
            }
            guard error == nil, let newAnchor, let categorySamples = samples as? [HKCategorySample], !categorySamples.isEmpty else {
                self.endBatch(for: category)
                observerCompletion()
                return
            }
            self.uploadBatch(samples: categorySamples, category: category, newAnchor: newAnchor, observerCompletion: observerCompletion)
        }

        healthStore.execute(anchoredQuery)
    }

    private func uploadBatch(
        samples: [HKCategorySample],
        category: HealthCategoryMetric,
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
            category: category,
            newAnchor: newAnchor,
            observerCompletion: observerCompletion,
            remainingTaskIdentifiers: taskIdentifiers,
            allSucceeded: true
        )
        batchLock.unlock()

        for sample in samples {
            let taskIdentifier = "\(batchID)#\(sample.uuid.uuidString)"
            let payload = CategorySampleNormalizer.payload(for: sample, category: category)
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

        endBatch(for: batch.category)

        if batch.allSucceeded {
            anchorStore.save(batch.newAnchor, forKey: batch.category.rawValue)
            lastSyncStore.recordSync(forKey: batch.category.rawValue, at: Date())
        } else {
            onDeliveryError?(batch.category, "Some samples failed to upload — will retry on the next sync.")
        }
        batch.observerCompletion()
    }
}

extension CategorySyncCoordinator: BackgroundUploadSessionDelegateHandler {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool) {
        guard let batchID = identifier.split(separator: "#").first.map(String.init) else { return }
        markTaskComplete(taskIdentifier: identifier, batchID: batchID, success: success)
    }
}
