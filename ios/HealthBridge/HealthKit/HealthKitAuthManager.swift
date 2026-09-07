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

    // Workouts, category samples (sleep/stand/mindful/event types), and mood
    // are all read-only (see WorkoutSyncCoordinator/CategorySyncCoordinator/
    // MoodSyncCoordinator) — included in readTypes so the single
    // authorization request covers them too. Mood (HKObjectType.stateOfMindType())
    // only exists on iOS 18+ — confirmed by a real compiler error against
    // this app's iOS 17.0 deployment target — so it's added at runtime via
    // #available rather than unconditionally, which would fail to compile
    // at all.
    //
    // This app never shares/writes anything to HealthKit — it only ever
    // reads. Health data belongs to the Health app; a bridge that also wrote
    // to it would make Health an unreliable source of truth for anything
    // this app or another app derived from it.
    static let readTypes: Set<HKSampleType> = {
        var types = Set(HealthMetric.allCases.map(\.sampleType))
            .union([HKObjectType.workoutType()])
            .union(HealthCategoryMetric.allCases.map(\.categoryType))
        if #available(iOS 18.0, *) {
            types.insert(HKObjectType.stateOfMindType())
        }
        return types
    }()

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
            try await healthStore.requestAuthorization(
                toShare: [],
                read: Set(Self.readTypes.map { $0 as HKObjectType })
            )
        }
        if let stored = defaults.array(forKey: Self.enabledMetricsKey) as? [String] {
            self.enabledMetrics = Set(stored.compactMap(HealthMetric.init(rawValue:)))
        } else {
            self.enabledMetrics = Set(HealthMetric.allCases)
        }
    }

    @MainActor
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
