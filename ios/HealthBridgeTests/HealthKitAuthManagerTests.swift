import XCTest
import HealthKit
@testable import HealthBridge

private struct AuthFailureError: Error, LocalizedError {
    var errorDescription: String? { "HealthKit is not available on this device" }
}

@MainActor
final class HealthKitAuthManagerTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "HealthKitAuthManagerTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testDefaultsToAllMetricsEnabledWhenNoStoredValue() {
        let manager = HealthKitAuthManager(defaults: defaults)
        XCTAssertEqual(manager.enabledMetrics, Set(HealthMetric.allCases))
    }

    func testDisablingAMetricPersistsAcrossInstances() {
        let manager = HealthKitAuthManager(defaults: defaults)
        manager.setEnabled(false, for: .weight)

        let reloaded = HealthKitAuthManager(defaults: defaults)
        XCTAssertFalse(reloaded.isEnabled(.weight))
        XCTAssertTrue(reloaded.isEnabled(.steps))
    }

    func testReadTypesCoverEveryMetricPlusWorkoutsCategoriesAndMood() {
        // +1 for workouts, +N for category types (sleep/stand/mindful/event
        // types) — none of these are HealthMetric cases, but all share this
        // one authorization request since they're all read-only.
        var expectedCount = HealthMetric.allCases.count + 1 + HealthCategoryMetric.allCases.count
        if #available(iOS 18.0, *) {
            expectedCount += 1
            XCTAssertTrue(HealthKitAuthManager.readTypes.contains(HKObjectType.stateOfMindType()))
        }
        XCTAssertEqual(HealthKitAuthManager.readTypes.count, expectedCount)
        XCTAssertTrue(HealthKitAuthManager.readTypes.contains(HKObjectType.workoutType()))
        for category in HealthCategoryMetric.allCases {
            XCTAssertTrue(HealthKitAuthManager.readTypes.contains(category.categoryType), "\(category) missing from readTypes")
        }
    }

    func testRequestAuthorizationSurfacesAFailureInsteadOfSwallowingIt() async {
        // A real device with HealthKit unavailable (e.g. some iPad models) or
        // any other authorization-request failure must be visible somewhere,
        // not silently discarded by a bare `try?` at the call site.
        let manager = HealthKitAuthManager(
            defaults: defaults,
            requestAuthorization: { throw AuthFailureError() }
        )
        await manager.requestAuthorizationIfNeeded()
        XCTAssertEqual(manager.authorizationError, "HealthKit is not available on this device")
    }

    func testRequestAuthorizationClearsAnyPriorErrorOnSuccess() async {
        let manager = HealthKitAuthManager(
            defaults: defaults,
            requestAuthorization: { throw AuthFailureError() }
        )
        await manager.requestAuthorizationIfNeeded()
        XCTAssertNotNil(manager.authorizationError)

        let succeeding = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        await succeeding.requestAuthorizationIfNeeded()
        XCTAssertNil(succeeding.authorizationError)
    }
}
