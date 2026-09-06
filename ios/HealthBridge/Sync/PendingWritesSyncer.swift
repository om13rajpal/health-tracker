import Foundation

// The stored `networking`/`writer` existentials and the two `ISO8601DateFormatter`
// instances aren't themselves `Sendable`, but every property here is a `let` set
// once at init and never mutated afterward, and `syncOnce()` only reads them — so
// this type is safe to send across isolation boundaries (e.g. into the `Task {}`
// created by the scene-foreground trigger and the `BGAppRefreshTask` handler).
final class PendingWritesSyncer: @unchecked Sendable {
    private let networking: PendingWritesNetworking
    private let writer: HealthSampleWriting
    private let dateFormatter: ISO8601DateFormatter
    private let fallbackDateFormatter: ISO8601DateFormatter

    init(networking: PendingWritesNetworking, writer: HealthSampleWriting) {
        self.networking = networking
        self.writer = writer
        dateFormatter = ISO8601DateFormatter()
        dateFormatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        fallbackDateFormatter = ISO8601DateFormatter()
    }

    @discardableResult
    func syncOnce() async -> Int {
        let pending: [PendingWriteDTO]
        do {
            pending = try await networking.fetchPendingWrites()
        } catch {
            return 0
        }

        var appliedCount = 0
        for item in pending {
            guard let metric = HealthMetric(rawValue: item.metric) else { continue }
            guard let timestamp = parseTimestamp(item.timestamp) else { continue }

            do {
                try await writer.save(metric: metric, value: item.value, timestamp: timestamp)
                try await networking.acknowledge(id: item.id)
                appliedCount += 1
            } catch {
                // Covers both a save failure (nothing was written — safe to
                // retry next poll) and an ack failure after a successful
                // save (the write DID happen; the backend will re-deliver
                // and this will write a duplicate sample next time, which is
                // the safer failure direction for a personal health app
                // than silently losing data).
                continue
            }
        }
        return appliedCount
    }

    private func parseTimestamp(_ raw: String) -> Date? {
        dateFormatter.date(from: raw) ?? fallbackDateFormatter.date(from: raw)
    }
}
