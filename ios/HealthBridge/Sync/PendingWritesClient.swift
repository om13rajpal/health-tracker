import Foundation

struct PendingWriteDTO: Codable, Equatable {
    let id: String
    let metric: String
    let value: Double
    let unit: String?
    let timestamp: String
}

protocol PendingWritesNetworking {
    func fetchPendingWrites() async throws -> [PendingWriteDTO]
    func acknowledge(id: String) async throws
}

final class PendingWritesClient: PendingWritesNetworking {
    private let session: URLSession
    private let pendingWritesURL: URL
    private let bearerToken: String

    init(session: URLSession = .shared, pendingWritesURL: URL, bearerToken: String) {
        self.session = session
        self.pendingWritesURL = pendingWritesURL
        self.bearerToken = bearerToken
    }

    func fetchPendingWrites() async throws -> [PendingWriteDTO] {
        var request = URLRequest(url: pendingWritesURL)
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        try Self.validate(response)
        return try JSONDecoder().decode([PendingWriteDTO].self, from: data)
    }

    func acknowledge(id: String) async throws {
        let ackURL = pendingWritesURL.appendingPathComponent("\(id)/ack")
        var request = URLRequest(url: ackURL)
        request.httpMethod = "POST"
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let (_, response) = try await session.data(for: request)
        try Self.validate(response)
    }

    private static func validate(_ response: URLResponse) throws {
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
    }
}
