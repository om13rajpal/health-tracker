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
            let isEnabled = authManager.isEnabled(metric)
            let lastSync = lastSyncStore.lastSync(for: metric)
            return StatusRow(
                id: metric,
                displayName: metric.displayName,
                isEnabled: isEnabled,
                lastSyncDescription: Self.relativeDescription(for: lastSync, now: now()),
                lastSync: lastSync,
                errorMessage: isEnabled ? deliveryErrors[metric] : nil
            )
        }
    }

    /// Called from the app-level wiring whenever `HealthObserverCoordinator.onDeliveryError`
    /// fires for a metric — see Task 4. Kept as a plain method (not a closure captured
    /// at init time) so it can be attached after both objects exist.
    func recordDeliveryError(_ message: String, for metric: HealthMetric) {
        guard authManager.isEnabled(metric) else { return }
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

    /// Switching a whole group at once — the alternative is thirteen taps to
    /// turn off running dynamics you never record.
    func setEnabled(_ enabled: Bool, forGroup group: HealthMetricGroup) {
        for metric in HealthMetric.allCases where metric.group == group {
            authManager.setEnabled(enabled, for: metric)
            if enabled {
                deliveryToggle?.startObserving(metric: metric)
            } else {
                deliveryToggle?.stopObserving(metric: metric)
                deliveryErrors[metric] = nil
            }
        }
        refresh()
    }

    var summary: StatusSummary {
        let enabled = rows.filter(\.isEnabled)
        return StatusSummary(
            enabled: enabled.count,
            total: rows.count,
            failing: rows.filter { $0.errorMessage != nil }.count,
            neverSynced: enabled.filter { $0.lastSync == nil }.count,
            // Only enabled metrics count toward "when did anything last arrive" —
            // a stale timestamp from a metric switched off weeks ago would
            // otherwise report the bridge as healthy while nothing flows.
            lastSync: enabled.compactMap(\.lastSync).max()
        )
    }

    /// The rows to show, grouped, after the filter and the search box.
    func sections(filter: MetricFilter, searchText: String) -> [MetricSection] {
        let matching = rows.filter { row in
            guard row.matches(searchText) else { return false }
            switch filter {
            case .all: return true
            case .on: return row.isEnabled
            case .problems: return row.errorMessage != nil
            }
        }

        return HealthMetricGroup.allCases.compactMap { group in
            let groupRows = matching.filter { $0.id.group == group }
            return groupRows.isEmpty ? nil : MetricSection(group: group, rows: groupRows)
        }
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
