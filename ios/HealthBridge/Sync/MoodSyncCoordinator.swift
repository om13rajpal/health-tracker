import Foundation
import HealthKit

/// Syncs HKStateOfMind ("State of Mind" mood logging — momentary emotions
/// and daily moods the user logs themselves in the Health/Mindfulness app).
/// Requires iOS 18.0+ (HKObjectType.stateOfMindType() doesn't exist before
/// that — confirmed by a real compiler error against this app's iOS 17.0
/// deployment target, not assumed) — gated with @available rather than
/// raising the deployment target, so mood sync activates automatically once
/// a device updates to iOS 18+ without dropping support for iOS 17 devices
/// in the meantime. AppDelegate only constructs/starts this on iOS 18+.
@available(iOS 18.0, *)
final class MoodSyncCoordinator {
    private static let anchorKey = "mood"
    // See HealthObserverCoordinator's matching constant/comment — same
    // unbounded-batch-can-outrun-the-background-window problem, same fix.
    private static let chunkLimit = 200

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
        let chunkWasFull: Bool
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
        let stateOfMindType = HKObjectType.stateOfMindType()

        healthStore.enableBackgroundDelivery(for: stateOfMindType, frequency: .immediate) { [weak self] success, error in
            if !success {
                let message = error?.localizedDescription ?? "Background delivery could not be enabled"
                self?.onDeliveryError?(message)
            }
        }

        let query = HKObserverQuery(sampleType: stateOfMindType, predicate: nil) { [weak self] _, completionHandler, error in
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

        drainChunk(observerCompletion: observerCompletion)
    }

    private func drainChunk(observerCompletion: @escaping HKObserverQueryCompletionHandler) {
        let anchor = anchorStore.anchor(forKey: Self.anchorKey)
        let anchoredQuery = HKAnchoredObjectQuery(
            type: .stateOfMindType(),
            predicate: nil,
            anchor: anchor,
            limit: Self.chunkLimit
        ) { [weak self] _, samples, _, newAnchor, error in
            guard let self else {
                observerCompletion()
                return
            }
            guard error == nil, let newAnchor, let moods = samples as? [HKStateOfMind], !moods.isEmpty else {
                self.endBatch()
                observerCompletion()
                return
            }
            self.uploadBatch(moods: moods, newAnchor: newAnchor, observerCompletion: observerCompletion)
        }

        healthStore.execute(anchoredQuery)
    }

    private func uploadBatch(
        moods: [HKStateOfMind],
        newAnchor: HKQueryAnchor,
        observerCompletion: @escaping HKObserverQueryCompletionHandler
    ) {
        let batchID = UUID().uuidString
        var taskIdentifiers: Set<String> = []
        for mood in moods {
            taskIdentifiers.insert("\(batchID)#\(mood.uuid.uuidString)")
        }

        batchLock.lock()
        pendingBatches[batchID] = PendingBatch(
            newAnchor: newAnchor,
            observerCompletion: observerCompletion,
            remainingTaskIdentifiers: taskIdentifiers,
            allSucceeded: true,
            chunkWasFull: moods.count == Self.chunkLimit
        )
        batchLock.unlock()

        for mood in moods {
            let taskIdentifier = "\(batchID)#\(mood.uuid.uuidString)"
            let payload = MoodNormalizer.payload(for: mood)
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

        guard batch.allSucceeded else {
            endBatch()
            onDeliveryError?("Some mood entries failed to upload — will retry on the next sync.")
            batch.observerCompletion()
            return
        }

        anchorStore.save(batch.newAnchor, forKey: Self.anchorKey)
        lastSyncStore.recordSync(forKey: Self.anchorKey, at: Date())

        if batch.chunkWasFull {
            drainChunk(observerCompletion: batch.observerCompletion)
            return
        }

        endBatch()
        batch.observerCompletion()
    }
}

@available(iOS 18.0, *)
extension MoodSyncCoordinator: BackgroundUploadSessionDelegateHandler {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool) {
        guard let batchID = identifier.split(separator: "#").first.map(String.init) else { return }
        markTaskComplete(taskIdentifier: identifier, batchID: batchID, success: success)
    }
}
