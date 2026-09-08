import SwiftUI

@main
struct HealthBridgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            StatusView(lastSyncStore: appDelegate.lastSyncStore, eventSyncErrors: appDelegate.eventSyncErrors)
                .environment(appDelegate.authManager)
                .environment(\.healthObserverCoordinator, appDelegate.coordinator)
                .environment(\.syncAllNow, appDelegate.syncAllNow)
        }
        // The background-execution budget an HKObserverQuery's background-
        // delivery wake gets is tight enough that a large historical backlog
        // can outrun it even chunked (see HealthObserverCoordinator's
        // chunking comment) — the app being open has no such limit, so
        // coming to the foreground is a reliable moment to make real
        // progress on anything still catching up.
        .onChange(of: scenePhase) { _, newPhase in
            if newPhase == .active {
                appDelegate.syncAllNow()
            }
        }
    }
}
