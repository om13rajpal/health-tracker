import UIKit
import HealthKit

/// Owns construction of the app's shared HealthKit/sync objects and performs the
/// side-effecting HealthKit wiring (observer queries, background delivery) in
/// `didFinishLaunchingWithOptions`, per Apple's guidance that observer queries must be
/// (re-)created at launch so a background-delivery relaunch — where no SwiftUI view ever
/// appears — actually re-arms them. `HealthBridgeApp` reads these shared instances from
/// `appDelegate` rather than constructing its own separate copies.
final class AppDelegate: NSObject, UIApplicationDelegate {
    static let workoutUploadSessionIdentifier = "com.healthtracker.iosbridge.background-upload-workouts"
    static let categoryUploadSessionIdentifier = "com.healthtracker.iosbridge.background-upload-categories"
    static let moodUploadSessionIdentifier = "com.healthtracker.iosbridge.background-upload-mood"

    let authManager = HealthKitAuthManager()
    let eventSyncErrors = EventSyncErrorStore()
    let uploadSession = BackgroundUploadSession()
    let workoutUploadSession = BackgroundUploadSession(identifier: AppDelegate.workoutUploadSessionIdentifier)
    let categoryUploadSession = BackgroundUploadSession(identifier: AppDelegate.categoryUploadSessionIdentifier)
    let anchorStore = SyncAnchorStore()
    let lastSyncStore = LastSyncStore()
    lazy var coordinator: HealthObserverCoordinator = HealthObserverCoordinator(
        healthStore: HKHealthStore(),
        anchorStore: anchorStore,
        uploadSession: uploadSession,
        authManager: authManager,
        lastSyncStore: lastSyncStore,
        endpoint: AppConfig.healthEventsEndpoint,
        bearerToken: AppConfig.bearerToken
    )
    lazy var workoutCoordinator: WorkoutSyncCoordinator = WorkoutSyncCoordinator(
        healthStore: HKHealthStore(),
        anchorStore: anchorStore,
        uploadSession: workoutUploadSession,
        lastSyncStore: lastSyncStore,
        endpoint: AppConfig.workoutsEndpoint,
        bearerToken: AppConfig.bearerToken
    )
    lazy var categoryCoordinator: CategorySyncCoordinator = CategorySyncCoordinator(
        healthStore: HKHealthStore(),
        anchorStore: anchorStore,
        uploadSession: categoryUploadSession,
        lastSyncStore: lastSyncStore,
        endpoint: AppConfig.categorySamplesEndpoint,
        bearerToken: AppConfig.bearerToken
    )
    // Mood (HKStateOfMind) requires iOS 18+ — see MoodSyncCoordinator's own
    // doc comment. Swift disallows `@available` directly on a stored/lazy
    // property (confirmed by a real compiler error, not assumed), so this
    // is boxed in an untyped Any? slot — always present regardless of OS
    // version — with a computed, #available-guarded accessor that lazily
    // creates and caches the real coordinator on first access.
    private var _moodUploadSessionBox: Any?
    private var _moodCoordinatorBox: Any?

    @available(iOS 18.0, *)
    var moodUploadSession: BackgroundUploadSession {
        if let existing = _moodUploadSessionBox as? BackgroundUploadSession { return existing }
        let session = BackgroundUploadSession(identifier: AppDelegate.moodUploadSessionIdentifier)
        _moodUploadSessionBox = session
        return session
    }

    @available(iOS 18.0, *)
    var moodCoordinator: MoodSyncCoordinator {
        if let existing = _moodCoordinatorBox as? MoodSyncCoordinator { return existing }
        let coordinator = MoodSyncCoordinator(
            healthStore: HKHealthStore(),
            anchorStore: anchorStore,
            uploadSession: moodUploadSession,
            lastSyncStore: lastSyncStore,
            endpoint: AppConfig.moodEndpoint,
            bearerToken: AppConfig.bearerToken
        )
        _moodCoordinatorBox = coordinator
        return coordinator
    }

    override init() {
        super.init()
        // Wired here, once, rather than in the status UI's onAppear the way
        // the quantity-metric coordinator's is — these three had nowhere to
        // report an error to at all before EventSyncErrorStore existed, and
        // wiring at construction means an error is captured even if the
        // status screen is never opened.
        //
        // HealthKit invokes onDeliveryError from completion-handler/callback
        // contexts with no main-thread guarantee (confirmed the hard way: an
        // un-hopped call here crashed with a Dictionary corruption under the
        // full test suite, where startObserving() runs for real and several
        // coordinators' background queues raced on the same `errors` store).
        // EventSyncErrorStore is an @Observable class StatusView reads on
        // the main thread, so every write into it must hop there explicitly.
        workoutCoordinator.onDeliveryError = { [weak eventSyncErrors] message in
            DispatchQueue.main.async {
                eventSyncErrors?.record(message, for: "workouts")
            }
        }
        categoryCoordinator.onDeliveryError = { [weak eventSyncErrors] category, message in
            DispatchQueue.main.async {
                eventSyncErrors?.record(message, for: category.rawValue)
            }
        }
        if #available(iOS 18.0, *) {
            moodCoordinator.onDeliveryError = { [weak eventSyncErrors] message in
                DispatchQueue.main.async {
                    eventSyncErrors?.record(message, for: "mood")
                }
            }
        }
    }

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        syncAllNow()

        // `requestAuthorizationIfNeeded()` is async and @MainActor-isolated, but
        // `didFinishLaunchingWithOptions` is synchronous — fire-and-forget rather than
        // block launch on it. The UI already reflects `authorizationError` reactively
        // once this resolves. On a fresh install, the `startObserving()` calls above run
        // before authorization is determined, so `enableBackgroundDelivery` fails silently
        // for every metric; re-calling them here once authorization has resolved re-arms
        // observation within this same process lifetime instead of relying on a relaunch.
        Task { @MainActor in
            await self.authManager.requestAuthorizationIfNeeded()
            self.syncAllNow()
        }

        return true
    }

    /// Re-arms every coordinator's `HKObserverQuery`, which fires an
    /// immediate trigger on `execute()` per Apple's documented behavior —
    /// so this is also how a fresh sync attempt gets kicked off, whether at
    /// launch, on the app coming to the foreground (no tight background
    /// execution budget to worry about there), or from the status screen's
    /// manual "Sync now" action. `setObserverQuery`/the coordinators' own
    /// `observerQuery` slots stop any previous query before installing the
    /// new one, so calling this repeatedly is safe rather than piling up
    /// duplicate observers.
    func syncAllNow() {
        coordinator.startObserving()
        workoutCoordinator.startObserving()
        categoryCoordinator.startObserving()
        if #available(iOS 18.0, *) {
            moodCoordinator.startObserving()
        }
    }

    func application(
        _ application: UIApplication,
        handleEventsForBackgroundURLSession identifier: String,
        completionHandler: @escaping () -> Void
    ) {
        if #available(iOS 18.0, *), identifier == Self.moodUploadSessionIdentifier {
            moodUploadSession.backgroundCompletionHandler = completionHandler
            return
        }
        switch identifier {
        case BackgroundUploadSession.identifier:
            uploadSession.backgroundCompletionHandler = completionHandler
        case Self.workoutUploadSessionIdentifier:
            workoutUploadSession.backgroundCompletionHandler = completionHandler
        case Self.categoryUploadSessionIdentifier:
            categoryUploadSession.backgroundCompletionHandler = completionHandler
        default:
            completionHandler()
        }
    }
}
