import Foundation

/// The one question this app exists to answer: is data actually reaching the
/// server? The summary answers it in a sentence before any of the sixty-four
/// toggles are shown.
struct StatusSummary: Equatable {
    let enabled: Int
    let total: Int
    let failing: Int
    let neverSynced: Int
    let lastSync: Date?

    enum State: Equatable {
        case broken(Int)
        case idle
        case waiting
        case streaming
    }

    var state: State {
        if failing > 0 { return .broken(failing) }
        if enabled == 0 { return .idle }
        if lastSync == nil { return .waiting }
        return .streaming
    }

    /// Written as a statement of fact, not a status word — "Streaming" alone
    /// tells you nothing you can act on.
    func detail(now: Date = Date()) -> String {
        switch state {
        case .broken(let count):
            return count == 1
                ? "One metric is failing to deliver. Its row says why."
                : "\(count) metrics are failing to deliver. Their rows say why."
        case .idle:
            return "Every metric is switched off, so nothing is being sent."
        case .waiting:
            return "Switched on, but nothing has come through yet. iOS decides when background delivery runs."
        case .streaming:
            return "Last sample reached the server \(StatusViewModel.relativeDescription(for: lastSync, now: now).replacingOccurrences(of: "Last synced ", with: ""))."
        }
    }
}

/// Which metrics the list is showing. Defaults to the ones switched on,
/// because that is the working set — the full catalogue is a reference.
enum MetricFilter: String, CaseIterable, Identifiable {
    case on
    case all
    case problems

    var id: String { rawValue }

    var label: String {
        switch self {
        case .on: return "On"
        case .all: return "All"
        case .problems: return "Problems"
        }
    }
}

/// One group of metric rows, ready to render as a section.
struct MetricSection: Identifiable, Equatable {
    let group: HealthMetricGroup
    let rows: [StatusRow]

    var id: String { group.id }
    var enabledCount: Int { rows.filter(\.isEnabled).count }
}
