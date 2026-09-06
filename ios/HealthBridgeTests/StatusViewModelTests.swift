import XCTest
@testable import HealthBridge

final class StatusViewModelTests: XCTestCase {
    func testNeverSyncedDescription() {
        let description = StatusViewModel.relativeDescription(for: nil, now: Date())
        XCTAssertEqual(description, "Never synced")
    }

    func testJustNowDescription() {
        let now = Date(timeIntervalSince1970: 1_757_000_000)
        let description = StatusViewModel.relativeDescription(for: now.addingTimeInterval(-10), now: now)
        XCTAssertEqual(description, "Last synced just now")
    }

    func testHoursAgoDescriptionMentionsHours() {
        let now = Date(timeIntervalSince1970: 1_757_000_000)
        let twoHoursAgo = now.addingTimeInterval(-2 * 60 * 60)
        let description = StatusViewModel.relativeDescription(for: twoHoursAgo, now: now)
        XCTAssertTrue(description.hasPrefix("Last synced"))
        XCTAssertTrue(description.contains("hour"))
    }

    func testRefreshBuildsRowForEveryMetric() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)

        XCTAssertEqual(viewModel.rows.count, HealthMetric.allCases.count)
        XCTAssertTrue(viewModel.rows.allSatisfy { $0.errorMessage == nil })
    }

    func testDeliveryErrorForOneMetricAppearsOnlyOnThatRow() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests2")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests2")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)
        viewModel.recordDeliveryError("Background delivery not authorized", for: .steps)

        let stepsRow = viewModel.rows.first { $0.id == .steps }
        let heartRateRow = viewModel.rows.first { $0.id == .heartRate }
        XCTAssertEqual(stepsRow?.errorMessage, "Background delivery not authorized")
        XCTAssertNil(heartRateRow?.errorMessage)
    }

    func testTogglingAMetricOffClearsItsErrorMessage() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests3")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests3")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)
        viewModel.recordDeliveryError("Background delivery not authorized", for: .steps)
        viewModel.setEnabled(false, for: .steps)

        let stepsRow = viewModel.rows.first { $0.id == .steps }
        XCTAssertNil(stepsRow?.errorMessage) // a disabled metric isn't "broken", it's off
    }

    func testRecordDeliveryErrorForAnAlreadyDisabledMetricIsIgnored() {
        let defaults = UserDefaults(suiteName: "StatusViewModelTests4")!
        defaults.removePersistentDomain(forName: "StatusViewModelTests4")
        let authManager = HealthKitAuthManager(defaults: defaults, requestAuthorization: {})
        let lastSyncStore = LastSyncStore(defaults: defaults)

        let viewModel = StatusViewModel(authManager: authManager, lastSyncStore: lastSyncStore, deliveryToggle: nil)
        viewModel.setEnabled(false, for: .steps)
        viewModel.recordDeliveryError("Background delivery not authorized", for: .steps)

        let stepsRow = viewModel.rows.first { $0.id == .steps }
        XCTAssertNil(stepsRow?.errorMessage) // a stale/late error for a disabled metric must not resurface it as broken
    }
}
