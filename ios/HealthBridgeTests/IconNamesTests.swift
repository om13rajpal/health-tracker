import XCTest
import UIKit
@testable import HealthBridge

/// A typo'd SF Symbol name doesn't fail to compile or crash — it just
/// silently renders nothing. `UIImage(systemName:)` returning nil is
/// exactly that failure, made checkable instead of relying on eyeballing
/// a screenshot for every icon this app references.
final class IconNamesTests: XCTestCase {
    func testEveryHealthMetricGroupIconResolves() {
        for group in HealthMetricGroup.allCases {
            XCTAssertNotNil(UIImage(systemName: group.icon), "\(group): \(group.icon) is not a real SF Symbol")
        }
    }

    func testEveryHealthCategoryMetricIconResolves() {
        for category in HealthCategoryMetric.allCases {
            XCTAssertNotNil(UIImage(systemName: category.icon), "\(category): \(category.icon) is not a real SF Symbol")
        }
    }

    func testEventRowIconsUsedOutsideHealthCategoryMetricResolve() {
        // "figure.run" (workouts) and "face.smiling.fill" (mood) are set as
        // literals in StatusViewModel.buildEventRows rather than coming from
        // an enum's own icon property, so nothing above already covers them.
        for name in ["figure.run", "face.smiling.fill"] {
            XCTAssertNotNil(UIImage(systemName: name), "\(name) is not a real SF Symbol")
        }
    }
}
