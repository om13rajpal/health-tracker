import XCTest
import HealthKit
@testable import HealthBridge

final class HealthSampleNormalizerTests: XCTestCase {
    func testNormalizesStepCountSample() {
        let type = HKObjectType.quantityType(forIdentifier: .stepCount)!
        let quantity = HKQuantity(unit: .count(), doubleValue: 250)
        let start = Date(timeIntervalSince1970: 1_757_000_000)
        let sample = HKQuantitySample(type: type, quantity: quantity, start: start, end: start)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .steps)

        XCTAssertEqual(payload.source, "ios-bridge")
        XCTAssertEqual(payload.metric, "steps")
        XCTAssertEqual(payload.value, 250)
        XCTAssertEqual(payload.unit, "count")
        XCTAssertEqual(payload.timestamp, ISO8601DateFormatter.hb.string(from: start))
    }

    func testNormalizesWeightSampleToKilograms() {
        let type = HKObjectType.quantityType(forIdentifier: .bodyMass)!
        let quantity = HKQuantity(unit: .gramUnit(with: .kilo), doubleValue: 70.5)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .weight)

        XCTAssertEqual(payload.value, 70.5, accuracy: 0.0001)
        XCTAssertEqual(payload.unit, "kg")
    }

    func testNormalizesHeartRateSample() {
        let type = HKObjectType.quantityType(forIdentifier: .heartRate)!
        let unit = HKUnit.count().unitDivided(by: .minute())
        let quantity = HKQuantity(unit: unit, doubleValue: 61)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .heartRate)

        XCTAssertEqual(payload.value, 61)
        XCTAssertEqual(payload.unit, "count/min")
    }

    // Blood oxygen and body fat percentage are the only metrics HealthKit
    // stores as a 0-1 fraction rather than a plain count — HKUnit.percent()
    // is what converts that fraction into the 0-100 value this app reports.
    func testNormalizesBloodOxygenSampleAsPercent() {
        let type = HKObjectType.quantityType(forIdentifier: .oxygenSaturation)!
        let quantity = HKQuantity(unit: .percent(), doubleValue: 0.98)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .bloodOxygen)

        XCTAssertEqual(payload.value, 0.98, accuracy: 0.0001)
        XCTAssertEqual(payload.unit, "%")
    }

    func testNormalizesDistanceSampleInMeters() {
        let type = HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
        let quantity = HKQuantity(unit: .meter(), doubleValue: 1500)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .distance)

        XCTAssertEqual(payload.value, 1500)
        XCTAssertEqual(payload.unit, "m")
    }

    func testNormalizesHeartRateVariabilitySampleInMilliseconds() {
        let type = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
        let quantity = HKQuantity(unit: HKUnit.secondUnit(with: .milli), doubleValue: 45)
        let now = Date()
        let sample = HKQuantitySample(type: type, quantity: quantity, start: now, end: now)

        let payload = HealthSampleNormalizer.payload(for: sample, metric: .heartRateVariability)

        XCTAssertEqual(payload.value, 45)
        XCTAssertEqual(payload.unit, "ms")
    }

    // HealthUnitMapper.unit(for:) and .wireUnit(for:) must stay in lockstep
    // for every case — a mismatch would silently mislabel a value's unit
    // without any type error, since both are independent switch statements.
    func testEveryMetricHasBothAUnitAndAWireUnit() {
        for metric in HealthMetric.allCases {
            _ = HealthUnitMapper.unit(for: metric)
            XCTAssertFalse(HealthUnitMapper.wireUnit(for: metric).isEmpty, "\(metric) has an empty wire unit")
        }
    }

    // The real, load-bearing check for this whole file: HKQuantity's unit
    // must be dimensionally compatible with the metric's actual HealthKit
    // quantity type, or constructing/normalizing a sample throws at runtime
    // (exactly how the writeTypes crash happened for a different reason).
    // `is(compatibleWith:)` is HealthKit's own compatibility check, not a
    // guess — this test would fail immediately, with the offending metric
    // named, for any of the ~50 unit assignments in HealthUnitMapper that
    // turned out to be wrong.
    func testEveryMetricsAssumedUnitIsCompatibleWithItsRealHealthKitQuantityType() {
        for metric in HealthMetric.allCases {
            guard let quantityType = metric.sampleType as? HKQuantityType else {
                XCTFail("\(metric) is not a quantity type")
                continue
            }
            let unit = HealthUnitMapper.unit(for: metric)
            XCTAssertTrue(
                quantityType.is(compatibleWith: unit),
                "\(metric): HealthUnitMapper's unit (\(unit)) is not compatible with \(quantityType)"
            )
        }
    }

    // Round-trips a real value through normalize -> the exact unit used to
    // construct the sample, for every metric, catching any case where the
    // unit is dimensionally compatible but silently wrong (e.g. reads back
    // scaled by a prefix factor).
    func testEveryMetricNormalizesToTheSameValueItWasConstructedWith() {
        let end = Date()
        // A handful of exposure/duration-based types (environmental and
        // headphone audio exposure) reject a zero-length sample at
        // construction time — confirmed via a real
        // _HKObjectValidationFailureException, not assumed — so every sample
        // here spans a minute, matching how the real anchored query would
        // actually receive them (an instant reading like heart rate is just
        // as valid over a one-minute window as a zero-length one).
        let start = end.addingTimeInterval(-60)
        for metric in HealthMetric.allCases {
            guard let quantityType = metric.sampleType as? HKQuantityType else { continue }
            let unit = HealthUnitMapper.unit(for: metric)
            let quantity = HKQuantity(unit: unit, doubleValue: 12.5)
            let sample = HKQuantitySample(type: quantityType, quantity: quantity, start: start, end: end)

            let payload = HealthSampleNormalizer.payload(for: sample, metric: metric)

            XCTAssertEqual(payload.value, 12.5, accuracy: 0.0001, "\(metric) did not round-trip its value")
            XCTAssertEqual(payload.unit, HealthUnitMapper.wireUnit(for: metric))
        }
    }

    func testNormalizesAWorkoutWithDistanceAndEnergy() throws {
        let start = Date(timeIntervalSince1970: 1_757_000_000)
        let end = start.addingTimeInterval(1800)
        let workout = HKWorkout(
            activityType: .running,
            start: start,
            end: end,
            duration: 1800,
            totalEnergyBurned: HKQuantity(unit: .kilocalorie(), doubleValue: 320),
            totalDistance: HKQuantity(unit: .meter(), doubleValue: 5000),
            metadata: nil
        )

        let payload = WorkoutNormalizer.payload(for: workout)

        XCTAssertEqual(payload.source, "ios-bridge")
        XCTAssertEqual(payload.activityType, "running")
        XCTAssertEqual(payload.durationSeconds, 1800)
        XCTAssertEqual(payload.totalEnergyBurnedKcal ?? -1, 320, accuracy: 0.0001)
        XCTAssertEqual(payload.totalDistanceMeters ?? -1, 5000, accuracy: 0.0001)
        XCTAssertEqual(payload.startDate, ISO8601DateFormatter.hb.string(from: start))
        XCTAssertEqual(payload.endDate, ISO8601DateFormatter.hb.string(from: end))
    }

    // A strength workout HealthKit has no distance for — must not crash on
    // the nil totalDistance/totalEnergyBurned, and must serialize as an
    // absent (not zero, not null-that-breaks-parsing) optional field.
    func testNormalizesAWorkoutWithNoDistanceOrEnergy() {
        let start = Date()
        let workout = HKWorkout(
            activityType: .functionalStrengthTraining,
            start: start,
            end: start.addingTimeInterval(2700)
        )

        let payload = WorkoutNormalizer.payload(for: workout)

        XCTAssertEqual(payload.activityType, "functional_strength_training")
        XCTAssertNil(payload.totalEnergyBurnedKcal)
        XCTAssertNil(payload.totalDistanceMeters)
    }

    func testUnmappedActivityTypeFallsBackToOtherRatherThanCrashingOrBeingDropped() {
        // .fencing has no explicit case in WorkoutActivityTypeMapper — this
        // is the "long tail" fallback this app relies on to keep syncing
        // every workout rather than silently dropping unmapped types.
        XCTAssertEqual(WorkoutActivityTypeMapper.wireValue(for: .fencing), "other")
    }
}
