import Foundation

/// Where the bridge sends Health data, and what it authenticates with.
///
/// Both values are read from the app's Info.plist first, so a real deployment
/// can supply them through an xcconfig that is never committed (see
/// `Secrets.xcconfig.example`). The compiled constants below are only the
/// fallback for a checkout that has not been configured yet.
enum AppConfig {
    /// The API's origin, with no trailing slash — e.g. `https://health-tracker-api.onrender.com`.
    /// Every endpoint below is derived from this, so there is exactly one place
    /// to change and no way to update four of five hosts and miss one.
    static let baseURL: URL = {
        if let configured = infoPlistValue("API_BASE_URL"), let url = URL(string: configured) {
            return url
        }
        return URL(string: "https://your-backend.example.com")!
    }()

    /// Must match the API's MCP_ACCESS_TOKEN exactly. Supply it through the
    /// Info.plist/xcconfig rather than editing this file, so the real secret
    /// never reaches source control.
    static let bearerToken: String = infoPlistValue("MCP_ACCESS_TOKEN") ?? "REPLACE_WITH_SHARED_SECRET"

    static var healthEventsEndpoint: URL { baseURL.appendingPathComponent("api/health-events") }
    static var workoutsEndpoint: URL { baseURL.appendingPathComponent("api/health-events/workouts") }
    static var categorySamplesEndpoint: URL { baseURL.appendingPathComponent("api/health-events/category-samples") }
    static var moodEndpoint: URL { baseURL.appendingPathComponent("api/health-events/mood") }
    static var pendingWritesEndpoint: URL { baseURL.appendingPathComponent("api/health-events/pending-writes") }

    /// True while the placeholders are still in place, so the UI can say so
    /// rather than silently failing every upload against example.com.
    static var isConfigured: Bool {
        baseURL.host?.hasSuffix("example.com") == false && bearerToken != "REPLACE_WITH_SHARED_SECRET"
    }

    private static func infoPlistValue(_ key: String) -> String? {
        guard let raw = Bundle.main.object(forInfoDictionaryKey: key) as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        // An unsubstituted xcconfig variable comes through as the literal
        // "$(NAME)", which is worse than absent because it looks configured.
        guard !trimmed.isEmpty, !trimmed.hasPrefix("$(") else { return nil }
        return trimmed
    }
}
