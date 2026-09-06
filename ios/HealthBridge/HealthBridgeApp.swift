import SwiftUI

@main
struct HealthBridgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            StatusView(lastSyncStore: appDelegate.lastSyncStore)
                .environment(appDelegate.authManager)
                .environment(\.healthObserverCoordinator, appDelegate.coordinator)
        }
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                Task { await appDelegate.pendingWritesSyncer.syncOnce() }
            }
        }
    }
}
