import XCTest
@testable import HealthBridge

final class LastSyncStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "LastSyncStoreTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testReturnsNilWhenNeverSynced() {
        let store = LastSyncStore(defaults: defaults)
        XCTAssertNil(store.lastSync(for: .heartRate))
    }

    func testRecordsAndReturnsLastSyncTime() {
        let store = LastSyncStore(defaults: defaults)
        let date = Date(timeIntervalSince1970: 1_757_000_000)
        store.recordSync(for: .heartRate, at: date)

        XCTAssertEqual(store.lastSync(for: .heartRate), date)
    }
}
