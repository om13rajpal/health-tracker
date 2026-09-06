import Foundation
import HealthKit

protocol HealthSampleWriting {
    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws
}

enum HealthUnitMapper {
    private static let countPerMinute = HKUnit.count().unitDivided(by: .minute())
    private static let vo2MaxUnit = HKUnit.literUnit(with: .milli)
        .unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
    private static let metersPerSecond = HKUnit.meter().unitDivided(by: .second())
    private static let litersPerMinute = HKUnit.liter().unitDivided(by: .minute())
    private static let mgPerDL = HKUnit.gramUnit(with: .milli).unitDivided(by: HKUnit.literUnit(with: .deci))
    private static let physicalEffortUnit = HKUnit.kilocalorie()
        .unitDivided(by: HKUnit.hour().unitMultiplied(by: .gramUnit(with: .kilo)))

    static func unit(for metric: HealthMetric) -> HKUnit {
        switch metric {
        case .heartRate, .restingHeartRate, .walkingHeartRate, .respiratoryRate, .cyclingCadence:
            return countPerMinute
        case .steps, .flightsClimbed, .bmi, .swimmingStrokeCount, .pushCount, .numberOfAlcoholicBeverages,
            .numberOfTimesFallen, .inhalerUsage, .uvExposure:
            return .count()
        case .activeEnergy, .basalEnergy:
            return .kilocalorie()
        case .weight, .leanBodyMass:
            return .gramUnit(with: .kilo)
        case .vo2Max:
            return vo2MaxUnit
        case .distance, .height, .waistCircumference, .walkingStepLength, .runningStrideLength,
            .runningVerticalOscillation, .sixMinuteWalkTestDistance, .underwaterDepth,
            .distanceCycling, .distanceSwimming, .distanceDownhillSnowSports, .distanceWheelchair:
            return .meter()
        case .heartRateVariability, .runningGroundContactTime:
            return HKUnit.secondUnit(with: .milli)
        case .bloodOxygen, .bodyFatPercentage, .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .walkingSteadiness, .peripheralPerfusionIndex, .bloodAlcoholContent:
            return .percent()
        case .exerciseMinutes, .timeInDaylight:
            return .minute()
        case .bodyTemperature, .sleepingWristTemperature, .waterTemperature:
            return .degreeCelsius()
        case .walkingSpeed, .runningSpeed, .cyclingSpeed, .stairAscentSpeed, .stairDescentSpeed:
            return metersPerSecond
        case .runningPower, .cyclingPower, .cyclingFunctionalThresholdPower:
            return .watt()
        case .bloodPressureSystolic, .bloodPressureDiastolic:
            return .millimeterOfMercury()
        case .bloodGlucose:
            return mgPerDL
        case .electrodermalActivity:
            return HKUnit.siemenUnit(with: .micro)
        case .forcedExpiratoryVolume1, .forcedVitalCapacity:
            return .liter()
        case .peakExpiratoryFlowRate:
            return litersPerMinute
        case .environmentalAudioExposure, .headphoneAudioExposure:
            return .decibelAWeightedSoundPressureLevel()
        case .physicalEffort:
            return physicalEffortUnit
        }
    }

    // Wire-format unit strings sent alongside the value in HealthEventPayload.
    static func wireUnit(for metric: HealthMetric) -> String {
        switch metric {
        case .heartRate, .restingHeartRate, .walkingHeartRate, .respiratoryRate, .cyclingCadence:
            return "count/min"
        case .steps, .flightsClimbed, .bmi, .swimmingStrokeCount, .pushCount, .numberOfAlcoholicBeverages,
            .numberOfTimesFallen, .inhalerUsage, .uvExposure:
            return "count"
        case .activeEnergy, .basalEnergy:
            return "kcal"
        case .weight, .leanBodyMass:
            return "kg"
        case .vo2Max:
            return "mL/(kg·min)"
        case .distance, .height, .waistCircumference, .walkingStepLength, .runningStrideLength,
            .runningVerticalOscillation, .sixMinuteWalkTestDistance, .underwaterDepth,
            .distanceCycling, .distanceSwimming, .distanceDownhillSnowSports, .distanceWheelchair:
            return "m"
        case .heartRateVariability, .runningGroundContactTime:
            return "ms"
        case .bloodOxygen, .bodyFatPercentage, .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .walkingSteadiness, .peripheralPerfusionIndex, .bloodAlcoholContent:
            return "%"
        case .exerciseMinutes, .timeInDaylight:
            return "min"
        case .bodyTemperature, .sleepingWristTemperature, .waterTemperature:
            return "degC"
        case .walkingSpeed, .runningSpeed, .cyclingSpeed, .stairAscentSpeed, .stairDescentSpeed:
            return "m/s"
        case .runningPower, .cyclingPower, .cyclingFunctionalThresholdPower:
            return "W"
        case .bloodPressureSystolic, .bloodPressureDiastolic:
            return "mmHg"
        case .bloodGlucose:
            return "mg/dL"
        case .electrodermalActivity:
            return "µS"
        case .forcedExpiratoryVolume1, .forcedVitalCapacity:
            return "L"
        case .peakExpiratoryFlowRate:
            return "L/min"
        case .environmentalAudioExposure, .headphoneAudioExposure:
            return "dBASPL"
        case .physicalEffort:
            return "kcal/(hr·kg)"
        }
    }
}

final class HealthKitSampleWriter: HealthSampleWriting {
    private let healthStore: HKHealthStore

    init(healthStore: HKHealthStore) {
        self.healthStore = healthStore
    }

    func save(metric: HealthMetric, value: Double, timestamp: Date) async throws {
        let quantityType = metric.sampleType as! HKQuantityType
        let quantity = HKQuantity(unit: HealthUnitMapper.unit(for: metric), doubleValue: value)
        let sample = HKQuantitySample(type: quantityType, quantity: quantity, start: timestamp, end: timestamp)
        try await healthStore.save(sample)
    }
}
