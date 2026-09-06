import Foundation

/// Sixty-four metrics in one flat list is a list nobody reads. Grouping them
/// the way Apple's own Health app groups them means a metric can be found by
/// where it belongs rather than by scrolling.
enum HealthMetricGroup: String, CaseIterable, Identifiable {
    case activity
    case heart
    case body
    case mobility
    case running
    case cycling
    case water
    case environment
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .activity: return "Activity and energy"
        case .heart: return "Heart and breathing"
        case .body: return "Body measurements"
        case .mobility: return "Mobility and gait"
        case .running: return "Running form"
        case .cycling: return "Cycling"
        case .water: return "Water"
        case .environment: return "Environment"
        case .other: return "Everything else"
        }
    }

    /// One line saying what the group is for, shown under the heading.
    var blurb: String {
        switch self {
        case .activity: return "The daily totals the dashboard's Move row is built from."
        case .heart: return "Resting rate and variability are the two that move slowly enough to mean something."
        case .body: return "Weight feeds the training block's own trend line."
        case .mobility: return "Gait measures the Watch derives on its own."
        case .running: return "Only recorded during a tracked run."
        case .cycling: return "Only recorded during a tracked ride."
        case .water: return "Only recorded during a swim or dive."
        case .environment: return "Sound, light and daylight exposure."
        case .other: return "Rarely recorded, kept for completeness."
        }
    }
}

extension HealthMetric {
    var group: HealthMetricGroup {
        switch self {
        case .steps, .distance, .flightsClimbed, .activeEnergy, .basalEnergy, .exerciseMinutes, .physicalEffort:
            return .activity
        case .heartRate, .restingHeartRate, .walkingHeartRate, .heartRateVariability, .respiratoryRate,
            .bloodOxygen, .vo2Max, .bloodPressureSystolic, .bloodPressureDiastolic, .peripheralPerfusionIndex:
            return .heart
        case .weight, .bodyFatPercentage, .bmi, .height, .leanBodyMass, .waistCircumference, .bodyTemperature:
            return .body
        case .walkingSpeed, .walkingStepLength, .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .stairAscentSpeed, .stairDescentSpeed, .sixMinuteWalkTestDistance, .walkingSteadiness:
            return .mobility
        case .runningSpeed, .runningPower, .runningStrideLength, .runningVerticalOscillation,
            .runningGroundContactTime:
            return .running
        case .cyclingSpeed, .cyclingPower, .cyclingCadence, .cyclingFunctionalThresholdPower, .distanceCycling:
            return .cycling
        case .distanceSwimming, .swimmingStrokeCount, .waterTemperature, .underwaterDepth:
            return .water
        case .environmentalAudioExposure, .headphoneAudioExposure, .uvExposure, .timeInDaylight:
            return .environment
        case .sleepingWristTemperature, .bloodGlucose, .electrodermalActivity, .forcedExpiratoryVolume1,
            .forcedVitalCapacity, .peakExpiratoryFlowRate, .numberOfAlcoholicBeverages, .bloodAlcoholContent,
            .inhalerUsage, .numberOfTimesFallen, .distanceDownhillSnowSports, .distanceWheelchair, .pushCount:
            return .other
        }
    }

    /// Extra words a search should match, so "hrv" finds Heart Rate
    /// Variability and "kg" finds Weight.
    var searchAliases: [String] {
        switch self {
        case .heartRateVariability: return ["hrv", "sdnn"]
        case .restingHeartRate: return ["rhr"]
        case .weight: return ["kg", "body mass", "scale"]
        case .bloodOxygen: return ["spo2", "oxygen saturation"]
        case .activeEnergy, .basalEnergy: return ["calories", "kcal"]
        case .exerciseMinutes: return ["move ring", "exercise ring"]
        case .vo2Max: return ["cardio fitness"]
        case .bmi: return ["body mass index"]
        case .distance: return ["walking", "running", "km"]
        default: return []
        }
    }
}
