import XCTest
import HealthKit
@testable import HealthBridge

final class SyncAnchorStoreTests: XCTestCase {
    private var defaults: UserDefaults!
    private let suiteName = "SyncAnchorStoreTests"

    override func setUp() {
        super.setUp()
        defaults = UserDefaults(suiteName: suiteName)
        defaults.removePersistentDomain(forName: suiteName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testReturnsNilWhenNoAnchorSaved() {
        let store = SyncAnchorStore(defaults: defaults)
        XCTAssertNil(store.anchor(for: .steps))
    }

    func testRoundTripsAnAnchor() {
        let store = SyncAnchorStore(defaults: defaults)
        let anchor = HKQueryAnchor(fromValue: 42)

        store.save(anchor, for: .steps)

        XCTAssertNotNil(store.anchor(for: .steps))
    }

    func testAnchorsAreKeyedPerMetric() {
        let store = SyncAnchorStore(defaults: defaults)
        store.save(HKQueryAnchor(fromValue: 1), for: .steps)

        XCTAssertNil(store.anchor(for: .weight))
    }
}
