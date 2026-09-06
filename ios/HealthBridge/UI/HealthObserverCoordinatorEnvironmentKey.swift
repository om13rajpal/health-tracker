import SwiftUI

private struct HealthObserverCoordinatorKey: EnvironmentKey {
    // `BackgroundDeliveryToggling` isn't `Sendable` (it abstracts a class with
    // mutable HealthKit query state), so the compiler can't verify a static
    // stored property of this type is safe to share across isolation domains.
    // `nil` has no shared mutable state at all, so this is safe in practice.
    nonisolated(unsafe) static let defaultValue: BackgroundDeliveryToggling? = nil
}

extension EnvironmentValues {
    var healthObserverCoordinator: BackgroundDeliveryToggling? {
        get { self[HealthObserverCoordinatorKey.self] }
        set { self[HealthObserverCoordinatorKey.self] = newValue }
    }
}
