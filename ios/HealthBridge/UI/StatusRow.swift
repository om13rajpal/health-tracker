import Foundation

struct StatusRow: Identifiable, Equatable {
    let id: HealthMetric
    let displayName: String
    let isEnabled: Bool
    let lastSyncDescription: String
    /// The raw timestamp behind `lastSyncDescription`. The description is for
    /// reading; this is for sorting and for the header's "last sample" line,
    /// which would otherwise have to parse its own prose back out.
    let lastSync: Date?
    /// Non-nil when this metric's background delivery hit an error (auth
    /// denied, HealthKit rejected the request, an upload batch failed) —
    /// rendered distinctly from the normal "Last synced ..." caption so a
    /// broken metric never looks identical to one that just hasn't synced yet.
    let errorMessage: String?

    /// Matches a typed query against the metric's name, its group and the
    /// aliases people actually type ("hrv", "spo2").
    func matches(_ query: String) -> Bool {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        if needle.isEmpty { return true }
        if displayName.lowercased().contains(needle) { return true }
        if id.group.title.lowercased().contains(needle) { return true }
        return id.searchAliases.contains { $0.contains(needle) }
    }
}

/// Workouts, category samples (sleep, stand hours, event markers) and mood
/// aren't `HealthMetric` cases and have no per-item on/off switch — they sync
/// as a whole whenever HealthKit authorization allows it, the same immediate
/// background-delivery mechanism every toggleable metric uses. This is the
/// read-only counterpart to `StatusRow` for that data, so its sync state is
/// still visible even though there's nothing to toggle.
struct EventSyncRow: Identifiable, Equatable {
    let id: String
    let displayName: String
    let lastSyncDescription: String
    let lastSync: Date?
}
