import XCTest
@testable import HealthBridge

final class BackgroundUploadSessionTests: XCTestCase {
    func testSuccessForA201Response() {
        XCTAssertTrue(UploadOutcome.isSuccess(httpStatusCode: 201, error: nil))
    }

    func testFailureForA401Response() {
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: 401, error: nil))
    }

    func testFailureWhenTransportErrorPresent() {
        struct DummyError: Error {}
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: 201, error: DummyError()))
    }

    func testFailureWhenNoResponseReceived() {
        XCTAssertFalse(UploadOutcome.isSuccess(httpStatusCode: nil, error: nil))
    }
}
