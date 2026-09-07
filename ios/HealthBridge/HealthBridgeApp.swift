import SwiftUI

@main
struct HealthBridgeApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            StatusView(lastSyncStore: appDelegate.lastSyncStore)
                .environment(appDelegate.authManager)
                .environment(\.healthObserverCoordinator, appDelegate.coordinator)
        }
    }
}
