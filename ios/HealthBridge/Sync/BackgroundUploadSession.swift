import Foundation

enum UploadOutcome {
    static func isSuccess(httpStatusCode: Int?, error: Error?) -> Bool {
        guard error == nil, let httpStatusCode else { return false }
        return (200..<300).contains(httpStatusCode)
    }
}

protocol BackgroundUploadSessionDelegateHandler: AnyObject {
    func uploadSession(_ session: BackgroundUploadSession, didCompleteTaskWithIdentifier identifier: String, success: Bool)
}

final class BackgroundUploadSession: NSObject {
    // The default, used for quantity-metric sync. Workout sync uses a second
    // instance with its own identifier (a background URLSession's identifier
    // must be unique per app) — that keeps its `delegateHandler`
    // (a single weak slot, not a multicast list) from silently overwriting
    // this session's handler, which would have broken quantity-metric upload
    // completions the moment a second coordinator shared this instance.
    static let identifier = "com.healthtracker.iosbridge.background-upload"

    private let sessionIdentifier: String

    init(identifier: String = BackgroundUploadSession.identifier) {
        self.sessionIdentifier = identifier
    }

    private(set) lazy var urlSession: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    weak var delegateHandler: BackgroundUploadSessionDelegateHandler?
    var backgroundCompletionHandler: (() -> Void)?

    private var taskIdentifierByTaskNumber: [Int: String] = [:]
    private var tempFileURLByTaskNumber: [Int: URL] = [:]
    private let metadataLock = NSLock()

    func upload<Payload: Encodable>(payload: Payload, taskIdentifier: String, endpoint: URL, bearerToken: String) throws {
        let data = try JSONEncoder().encode(payload)
        let tempURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("json")
        try data.write(to: tempURL, options: .atomic)

        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(bearerToken)", forHTTPHeaderField: "Authorization")

        let task = urlSession.uploadTask(with: request, fromFile: tempURL)
        metadataLock.lock()
        taskIdentifierByTaskNumber[task.taskIdentifier] = taskIdentifier
        tempFileURLByTaskNumber[task.taskIdentifier] = tempURL
        metadataLock.unlock()
        task.resume()
    }
}

extension BackgroundUploadSession: URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        metadataLock.lock()
        let identifier = taskIdentifierByTaskNumber.removeValue(forKey: task.taskIdentifier)
        let tempFileURL = tempFileURLByTaskNumber.removeValue(forKey: task.taskIdentifier)
        metadataLock.unlock()

        // The uploaded temp file's job is done once the task completes, whether it
        // succeeded or failed — remove it either way so background sync doesn't leak
        // disk space over time. Best-effort: the file may already be gone.
        if let tempFileURL {
            try? FileManager.default.removeItem(at: tempFileURL)
        }

        guard let identifier else { return }

        let httpStatus = (task.response as? HTTPURLResponse)?.statusCode
        let success = UploadOutcome.isSuccess(httpStatusCode: httpStatus, error: error)

        delegateHandler?.uploadSession(self, didCompleteTaskWithIdentifier: identifier, success: success)
    }
}

extension BackgroundUploadSession: URLSessionDelegate {
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async { [weak self] in
            self?.backgroundCompletionHandler?()
            self?.backgroundCompletionHandler = nil
        }
    }
}
