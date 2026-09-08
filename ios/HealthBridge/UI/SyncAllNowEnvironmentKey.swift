import SwiftUI

private struct SyncAllNowKey: EnvironmentKey {
    nonisolated(unsafe) static let defaultValue: (() -> Void)? = nil
}

extension EnvironmentValues {
    /// Re-arms every sync coordinator's observer query — see
    /// `AppDelegate.syncAllNow()`. Exposed to the status screen's manual
    /// "Sync now" action and to the app coming to the foreground, where
    /// there's no tight background-execution budget to worry about.
    var syncAllNow: (() -> Void)? {
        get { self[SyncAllNowKey.self] }
        set { self[SyncAllNowKey.self] = newValue }
    }
}
