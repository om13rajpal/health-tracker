import XCTest
@testable import HealthBridge

final class InFlightMetricGuardTests: XCTestCase {
    func testFirstTriggerForAMetricClaimsTheInFlightSlot() {
        let guardian = InFlightMetricGuard()
        XCTAssertTrue(guardian.beginBatch(for: .steps))
    }

    func testOverlappingTriggerForTheSameMetricIsRejectedWhileABatchIsInFlight() {
        // Simulates HealthKit firing HKObserverQuery's update handler a second time for
        // the same metric before the first trigger's anchored-query batch has resolved.
        // Only the first should be allowed to start a batch; the second must be skipped
        // so it doesn't race the first against the same not-yet-advanced anchor.
        let guardian = InFlightMetricGuard()

        XCTAssertTrue(guardian.beginBatch(for: .heartRate))
        XCTAssertFalse(guardian.beginBatch(for: .heartRate))
    }

    func testTriggersForDifferentMetricsDoNotBlockEachOther() {
        let guardian = InFlightMetricGuard()

        XCTAssertTrue(guardian.beginBatch(for: .steps))
        XCTAssertTrue(guardian.beginBatch(for: .weight))
    }

    func testANewTriggerIsAllowedOnceTheInFlightBatchEnds() {
        let guardian = InFlightMetricGuard()

        XCTAssertTrue(guardian.beginBatch(for: .activeEnergy))
        XCTAssertFalse(guardian.beginBatch(for: .activeEnergy))

        guardian.endBatch(for: .activeEnergy)

        XCTAssertTrue(guardian.beginBatch(for: .activeEnergy))
    }

    func testEndingABatchForAMetricWithNoneInFlightIsANoOp() {
        let guardian = InFlightMetricGuard()

        guardian.endBatch(for: .vo2Max)

        XCTAssertTrue(guardian.beginBatch(for: .vo2Max))
    }

    func testConcurrentOverlappingTriggersForTheSameMetricAdmitExactlyOne() {
        let guardian = InFlightMetricGuard()
        let admittedCount = NSLock()
        var admitted = 0
        let iterations = 200

        DispatchQueue.concurrentPerform(iterations: iterations) { _ in
            if guardian.beginBatch(for: .steps) {
                admittedCount.lock()
                admitted += 1
                admittedCount.unlock()
            }
        }

        XCTAssertEqual(admitted, 1)
    }
}
