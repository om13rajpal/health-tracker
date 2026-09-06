import Foundation
import HealthKit

final class SyncAnchorStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func storageKey(for key: String) -> String {
        "SyncAnchorStore.anchor.\(key)"
    }

    func anchor(forKey key: String) -> HKQueryAnchor? {
        guard let data = defaults.data(forKey: storageKey(for: key)) else { return nil }
        return try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: data)
    }

    func save(_ anchor: HKQueryAnchor, forKey key: String) {
        guard let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) else { return }
        defaults.set(data, forKey: storageKey(for: key))
    }

    func clear(forKey key: String) {
        defaults.removeObject(forKey: storageKey(for: key))
    }

    // HealthMetric-keyed convenience overloads used by HealthObserverCoordinator.
    func anchor(for metric: HealthMetric) -> HKQueryAnchor? {
        anchor(forKey: metric.rawValue)
    }

    func save(_ anchor: HKQueryAnchor, for metric: HealthMetric) {
        save(anchor, forKey: metric.rawValue)
    }

    func clear(for metric: HealthMetric) {
        clear(forKey: metric.rawValue)
    }
}
