import HealthKit

/// The HKUnit each `HealthMetric` is read out of HealthKit in, and the string
/// sent alongside the value over the wire. `unit(for:)` and `wireUnit(for:)`
/// must stay in lockstep for every case — see `HealthSampleNormalizerTests`,
/// which checks every metric's assumed unit against its real HealthKit
/// quantity type rather than trusting this by inspection.
///
/// Built from HKUnit factory methods and `.unitDivided(by:)`/`.unitMultiplied(by:)`
/// rather than `HKUnit(from: "...")` string parsing — a malformed unit string
/// traps at runtime, where a compound built from factories is checked by the
/// compiler.
enum HealthUnitMapper {
    static func unit(for metric: HealthMetric) -> HKUnit {
        switch metric {
        case .heartRate, .restingHeartRate, .walkingHeartRate, .respiratoryRate, .cyclingCadence:
            return HKUnit.count().unitDivided(by: .minute())
        case .steps, .flightsClimbed, .bmi, .uvExposure, .swimmingStrokeCount, .pushCount,
            .numberOfAlcoholicBeverages, .inhalerUsage, .numberOfTimesFallen:
            return .count()
        case .activeEnergy, .basalEnergy:
            return .kilocalorie()
        case .weight, .leanBodyMass:
            return .gramUnit(with: .kilo)
        // HealthKit's own documented unit for VO2 Max — millilitres of
        // oxygen per kilogram of body mass per minute.
        case .vo2Max:
            return HKUnit.literUnit(with: .milli).unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: .minute()))
        case .distance, .distanceCycling, .distanceSwimming, .distanceDownhillSnowSports, .distanceWheelchair,
            .height, .waistCircumference, .walkingStepLength, .runningStrideLength, .underwaterDepth,
            .sixMinuteWalkTestDistance:
            return .meter()
        case .heartRateVariability, .runningGroundContactTime:
            return HKUnit.secondUnit(with: .milli)
        // Blood oxygen, body fat, walking asymmetry/double support, walking
        // steadiness, peripheral perfusion index and blood alcohol content
        // are all fractions HealthKit stores 0-1 — `.percent()` reports the
        // 0-100 value this app and its backend expect.
        case .bloodOxygen, .bodyFatPercentage, .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .walkingSteadiness, .peripheralPerfusionIndex, .bloodAlcoholContent:
            return .percent()
        case .exerciseMinutes, .timeInDaylight:
            return .minute()
        case .bodyTemperature, .waterTemperature, .sleepingWristTemperature:
            return .degreeCelsius()
        case .walkingSpeed, .stairAscentSpeed, .stairDescentSpeed, .runningSpeed, .cyclingSpeed:
            return HKUnit.meter().unitDivided(by: .second())
        // Vertical oscillation is the one length-type running-dynamics metric
        // HealthKit itself reports in centimetres rather than metres.
        case .runningVerticalOscillation:
            return HKUnit.meterUnit(with: .centi)
        case .runningPower, .cyclingPower, .cyclingFunctionalThresholdPower:
            return .watt()
        case .bloodPressureSystolic, .bloodPressureDiastolic:
            return .millimeterOfMercury()
        case .bloodGlucose:
            return HKUnit.gramUnit(with: .milli).unitDivided(by: HKUnit.literUnit(with: .deci))
        case .electrodermalActivity:
            return HKUnit.siemenUnit(with: .micro)
        case .forcedExpiratoryVolume1, .forcedVitalCapacity:
            return .liter()
        case .peakExpiratoryFlowRate:
            return HKUnit.liter().unitDivided(by: .minute())
        case .environmentalAudioExposure, .headphoneAudioExposure:
            return .decibelAWeightedSoundPressureLevel()
        // HealthKit's own documented unit for Physical Effort — kilocalories
        // per hour per kilogram of body mass, a MET-like normalized rate.
        case .physicalEffort:
            return HKUnit.kilocalorie().unitDivided(by: HKUnit.hour().unitMultiplied(by: HKUnit.gramUnit(with: .kilo)))
        }
    }

    static func wireUnit(for metric: HealthMetric) -> String {
        switch metric {
        case .heartRate, .restingHeartRate, .walkingHeartRate, .respiratoryRate, .cyclingCadence:
            return "count/min"
        case .steps, .flightsClimbed, .bmi, .uvExposure, .swimmingStrokeCount, .pushCount,
            .numberOfAlcoholicBeverages, .inhalerUsage, .numberOfTimesFallen:
            return "count"
        case .activeEnergy, .basalEnergy:
            return "kcal"
        case .weight, .leanBodyMass:
            return "kg"
        case .vo2Max:
            return "ml/kg/min"
        case .distance, .distanceCycling, .distanceSwimming, .distanceDownhillSnowSports, .distanceWheelchair,
            .height, .waistCircumference, .walkingStepLength, .runningStrideLength, .underwaterDepth,
            .sixMinuteWalkTestDistance:
            return "m"
        case .heartRateVariability, .runningGroundContactTime:
            return "ms"
        case .bloodOxygen, .bodyFatPercentage, .walkingAsymmetryPercentage, .walkingDoubleSupportPercentage,
            .walkingSteadiness, .peripheralPerfusionIndex, .bloodAlcoholContent:
            return "%"
        case .exerciseMinutes, .timeInDaylight:
            return "min"
        case .bodyTemperature, .waterTemperature, .sleepingWristTemperature:
            return "degC"
        case .walkingSpeed, .stairAscentSpeed, .stairDescentSpeed, .runningSpeed, .cyclingSpeed:
            return "m/s"
        case .runningVerticalOscillation:
            return "cm"
        case .runningPower, .cyclingPower, .cyclingFunctionalThresholdPower:
            return "W"
        case .bloodPressureSystolic, .bloodPressureDiastolic:
            return "mmHg"
        case .bloodGlucose:
            return "mg/dL"
        case .electrodermalActivity:
            return "microsiemens"
        case .forcedExpiratoryVolume1, .forcedVitalCapacity:
            return "L"
        case .peakExpiratoryFlowRate:
            return "L/min"
        case .environmentalAudioExposure, .headphoneAudioExposure:
            return "dBASPL"
        case .physicalEffort:
            return "kcal/hr/kg"
        }
    }
}
