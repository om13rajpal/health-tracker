import XCTest
import HealthKit
@testable import HealthBridge

private final class MockPendingWritesNetworking: PendingWritesNetworking {
    var pendingWrites: [PendingWriteDTO] = []
    var fetchError: Error?
    var acknowledgedIDs: [String] = []
    var acknowledgeError: Error?

    func fetchPendingWrites() async throws -> [PendingWriteDTO] {
        if let fetchError { throw fetchError }
        return pendingWrites
    }

    func acknowledge(id: String) async throws {
        if let acknowledgeError { throw acknowledgeError }
        acknowledgedIDs.append(id)
    }
}

private final class MockHealthSampleWriter: HealthSampleWriting {
    var savedSamples: [(metric: HealthMetric, value: Double, timestamp: Date)] = []
    var saveError: Error?

    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
        if let saveError { throw saveError }
        savedSamples.append((metric, value, timestamp))
    }
}

final class PendingWritesSyncerTests: XCTestCase {
    func testAppliesAndAcknowledgesEachPendingWrite() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: "count", timestamp: "2026-09-01T10:00:00Z"),
            PendingWriteDTO(id: "2", metric: "weight", value: 70.2, unit: "kg", timestamp: "2026-09-01T11:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 2)
        XCTAssertEqual(writer.savedSamples.count, 2)
        XCTAssertEqual(networking.acknowledgedIDs, ["1", "2"])
    }

    func testSkipsAcknowledgeWhenSaveFails() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        writer.saveError = URLError(.unknown)
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        // Not acknowledging on save failure is deliberate: the item stays
        // "pending" on the backend and is retried on the next poll, rather
        // than being marked delivered when it was never actually written to
        // Health.
        XCTAssertEqual(applied, 0)
        XCTAssertTrue(networking.acknowledgedIDs.isEmpty)
    }

    func testAppliesRemainingItemsWhenOneFailsMidBatch() async {
        // A failure on one item must not abort the whole batch — items are
        // independent (different metrics/timestamps), so one failing to
        // save must not block the others from being applied and acked.
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
            PendingWriteDTO(id: "2", metric: "weight", value: 70.2, unit: "kg", timestamp: "2026-09-01T11:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        // Simulate the first save failing, second succeeding, via a writer subclass-free approach:
        // reuse MockHealthSampleWriter's saveError only for the first call by wrapping it.
        final class SequencedWriter: HealthSampleWriting {
            var results: [Result<Void, Error>]
            var savedSamples: [(metric: HealthMetric, value: Double, timestamp: Date)] = []
            init(results: [Result<Void, Error>]) { self.results = results }
            func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
                let result = results.removeFirst()
                switch result {
                case .success:
                    savedSamples.append((metric, value, timestamp))
                case .failure(let error):
                    throw error
                }
            }
        }
        let sequencedWriter = SequencedWriter(results: [.failure(URLError(.unknown)), .success(())])
        let syncer = PendingWritesSyncer(networking: networking, writer: sequencedWriter)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 1)
        XCTAssertEqual(networking.acknowledgedIDs, ["2"])
    }

    func testSkipsUnparseableTimestamp() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "not-a-date"),
        ]
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0)
        XCTAssertTrue(writer.savedSamples.isEmpty)
        XCTAssertTrue(networking.acknowledgedIDs.isEmpty)
    }

    func testSkipsUnknownMetric() async {
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "unknown_metric", value: 1, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0)
        XCTAssertTrue(networking.acknowledgedIDs.isEmpty)
    }

    func testReturnsZeroWhenFetchFails() async {
        let networking = MockPendingWritesNetworking()
        networking.fetchError = URLError(.notConnectedToInternet)
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0)
    }

    func testDoesNotCrashWhenAcknowledgeFailsAfterASuccessfulSave() async {
        // If the save succeeds but the ack POST fails (network drop between
        // the two calls), the sample IS now in Health — that's correct and
        // not undone — but the backend still thinks it's pending, so it will
        // be re-delivered and re-saved next poll. This duplicates a manual
        // health entry rather than losing one, which is the safer failure
        // direction for a personal health app; note this as an accepted,
        // documented tradeoff rather than an unhandled crash.
        let networking = MockPendingWritesNetworking()
        networking.pendingWrites = [
            PendingWriteDTO(id: "1", metric: "steps", value: 500, unit: nil, timestamp: "2026-09-01T10:00:00Z"),
        ]
        networking.acknowledgeError = URLError(.networkConnectionLost)
        let writer = MockHealthSampleWriter()
        let syncer = PendingWritesSyncer(networking: networking, writer: writer)

        let applied = await syncer.syncOnce()

        XCTAssertEqual(applied, 0) // not counted as cleanly applied since the ack didn't complete
        XCTAssertEqual(writer.savedSamples.count, 1) // but the Health write did happen
    }
}
