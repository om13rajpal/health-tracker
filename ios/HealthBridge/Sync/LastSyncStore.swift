import Foundation

final class LastSyncStore {
    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    private func storageKey(for key: String) -> String {
        "LastSyncStore.lastSync.\(key)"
    }

    func recordSync(forKey key: String, at date: Date) {
        defaults.set(date.timeIntervalSince1970, forKey: storageKey(for: key))
    }

    func lastSync(forKey key: String) -> Date? {
        let value = defaults.double(forKey: storageKey(for: key))
        return value == 0 ? nil : Date(timeIntervalSince1970: value)
    }

    // HealthMetric-keyed convenience overloads used by HealthObserverCoordinator.
    func recordSync(for metric: HealthMetric, at date: Date) {
        recordSync(forKey: metric.rawValue, at: date)
    }

    func lastSync(for metric: HealthMetric) -> Date? {
        lastSync(forKey: metric.rawValue)
    }
}
