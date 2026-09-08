import HealthKit

// Deliberately excludes: clinical records (allergy/condition/immunization/lab/
// medication/procedure/vitalSign/coverage — a separate entitlement, and actual
// medical records rather than fitness/vitals data), reproductive health
// (menstrual/fertility/pregnancy — not applicable to this app's single user),
// dietary quantity types (this app already tracks nutrition itself; syncing
// HealthKit's own dietary log would double-count), and insulin delivery
// (HealthKit requires an HKMetadataKeyInsulinDeliveryReason metadata key
// distinguishing basal/bolus doses on every sample — confirmed via a real
// _HKObjectValidationFailureException at runtime — which doesn't fit the
// generic {metric, value, unit} wire format every other metric uses, and
// this app has no diabetes-management UI to make the distinction meaningful).
enum HealthMetric: String, CaseIterable, Codable {
    case heartRate = "heart_rate"
    case steps = "steps"
    case activeEnergy = "active_energy"
    case weight = "weight"
    case vo2Max = "vo2max"
    case distance = "distance"
    case flightsClimbed = "flights_climbed"
    case restingHeartRate = "resting_heart_rate"
    case walkingHeartRate = "walking_heart_rate"
    case heartRateVariability = "heart_rate_variability"
    case respiratoryRate = "respiratory_rate"
    case bloodOxygen = "blood_oxygen"
    case bodyFatPercentage = "body_fat_percentage"
    case bmi = "bmi"
    case basalEnergy = "basal_energy"
    case exerciseMinutes = "exercise_minutes"
    // Body measurements
    case height = "height"
    case leanBodyMass = "lean_body_mass"
    case waistCircumference = "waist_circumference"
    case bodyTemperature = "body_temperature"
    // Mobility
    case walkingSpeed = "walking_speed"
    case walkingStepLength = "walking_step_length"
    case walkingAsymmetryPercentage = "walking_asymmetry"
    case walkingDoubleSupportPercentage = "walking_double_support"
    case stairAscentSpeed = "stair_ascent_speed"
    case stairDescentSpeed = "stair_descent_speed"
    case sixMinuteWalkTestDistance = "six_minute_walk_distance"
    case walkingSteadiness = "walking_steadiness"
    // Running dynamics
    case runningSpeed = "running_speed"
    case runningPower = "running_power"
    case runningStrideLength = "running_stride_length"
    case runningVerticalOscillation = "running_vertical_oscillation"
    case runningGroundContactTime = "running_ground_contact_time"
    // Cycling dynamics
    case cyclingSpeed = "cycling_speed"
    case cyclingPower = "cycling_power"
    case cyclingCadence = "cycling_cadence"
    case cyclingFunctionalThresholdPower = "cycling_ftp"
    // Distance variants
    case distanceCycling = "distance_cycling"
    case distanceSwimming = "distance_swimming"
    case distanceDownhillSnowSports = "distance_snow_sports"
    case distanceWheelchair = "distance_wheelchair"
    // Other activity
    case swimmingStrokeCount = "swimming_stroke_count"
    case pushCount = "push_count"
    // Vitals
    case bloodPressureSystolic = "blood_pressure_systolic"
    case bloodPressureDiastolic = "blood_pressure_diastolic"
    case bloodGlucose = "blood_glucose"
    case electrodermalActivity = "electrodermal_activity"
    case forcedExpiratoryVolume1 = "fev1"
    case forcedVitalCapacity = "forced_vital_capacity"
    case peakExpiratoryFlowRate = "peak_expiratory_flow"
    case peripheralPerfusionIndex = "peripheral_perfusion_index"
    case numberOfAlcoholicBeverages = "alcoholic_beverages"
    case bloodAlcoholContent = "blood_alcohol_content"
    case inhalerUsage = "inhaler_usage"
    case numberOfTimesFallen = "times_fallen"
    // Environmental
    case environmentalAudioExposure = "environmental_audio_exposure"
    case headphoneAudioExposure = "headphone_audio_exposure"
    case uvExposure = "uv_exposure"
    case timeInDaylight = "time_in_daylight"
    case waterTemperature = "water_temperature"
    case underwaterDepth = "underwater_depth"
    // Other
    case sleepingWristTemperature = "sleeping_wrist_temperature"
    case physicalEffort = "physical_effort"

    var sampleType: HKSampleType {
        switch self {
        case .heartRate: return HKObjectType.quantityType(forIdentifier: .heartRate)!
        case .steps: return HKObjectType.quantityType(forIdentifier: .stepCount)!
        case .activeEnergy: return HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!
        case .weight: return HKObjectType.quantityType(forIdentifier: .bodyMass)!
        case .vo2Max: return HKObjectType.quantityType(forIdentifier: .vo2Max)!
        case .distance: return HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!
        case .flightsClimbed: return HKObjectType.quantityType(forIdentifier: .flightsClimbed)!
        case .restingHeartRate: return HKObjectType.quantityType(forIdentifier: .restingHeartRate)!
        case .walkingHeartRate: return HKObjectType.quantityType(forIdentifier: .walkingHeartRateAverage)!
        case .heartRateVariability: return HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN)!
        case .respiratoryRate: return HKObjectType.quantityType(forIdentifier: .respiratoryRate)!
        case .bloodOxygen: return HKObjectType.quantityType(forIdentifier: .oxygenSaturation)!
        case .bodyFatPercentage: return HKObjectType.quantityType(forIdentifier: .bodyFatPercentage)!
        case .bmi: return HKObjectType.quantityType(forIdentifier: .bodyMassIndex)!
        case .basalEnergy: return HKObjectType.quantityType(forIdentifier: .basalEnergyBurned)!
        case .exerciseMinutes: return HKObjectType.quantityType(forIdentifier: .appleExerciseTime)!
        case .height: return HKObjectType.quantityType(forIdentifier: .height)!
        case .leanBodyMass: return HKObjectType.quantityType(forIdentifier: .leanBodyMass)!
        case .waistCircumference: return HKObjectType.quantityType(forIdentifier: .waistCircumference)!
        case .bodyTemperature: return HKObjectType.quantityType(forIdentifier: .bodyTemperature)!
        case .walkingSpeed: return HKObjectType.quantityType(forIdentifier: .walkingSpeed)!
        case .walkingStepLength: return HKObjectType.quantityType(forIdentifier: .walkingStepLength)!
        case .walkingAsymmetryPercentage: return HKObjectType.quantityType(forIdentifier: .walkingAsymmetryPercentage)!
        case .walkingDoubleSupportPercentage: return HKObjectType.quantityType(forIdentifier: .walkingDoubleSupportPercentage)!
        case .stairAscentSpeed: return HKObjectType.quantityType(forIdentifier: .stairAscentSpeed)!
        case .stairDescentSpeed: return HKObjectType.quantityType(forIdentifier: .stairDescentSpeed)!
        case .sixMinuteWalkTestDistance: return HKObjectType.quantityType(forIdentifier: .sixMinuteWalkTestDistance)!
        case .walkingSteadiness: return HKObjectType.quantityType(forIdentifier: .appleWalkingSteadiness)!
        case .runningSpeed: return HKObjectType.quantityType(forIdentifier: .runningSpeed)!
        case .runningPower: return HKObjectType.quantityType(forIdentifier: .runningPower)!
        case .runningStrideLength: return HKObjectType.quantityType(forIdentifier: .runningStrideLength)!
        case .runningVerticalOscillation: return HKObjectType.quantityType(forIdentifier: .runningVerticalOscillation)!
        case .runningGroundContactTime: return HKObjectType.quantityType(forIdentifier: .runningGroundContactTime)!
        case .cyclingSpeed: return HKObjectType.quantityType(forIdentifier: .cyclingSpeed)!
        case .cyclingPower: return HKObjectType.quantityType(forIdentifier: .cyclingPower)!
        case .cyclingCadence: return HKObjectType.quantityType(forIdentifier: .cyclingCadence)!
        case .cyclingFunctionalThresholdPower: return HKObjectType.quantityType(forIdentifier: .cyclingFunctionalThresholdPower)!
        case .distanceCycling: return HKObjectType.quantityType(forIdentifier: .distanceCycling)!
        case .distanceSwimming: return HKObjectType.quantityType(forIdentifier: .distanceSwimming)!
        case .distanceDownhillSnowSports: return HKObjectType.quantityType(forIdentifier: .distanceDownhillSnowSports)!
        case .distanceWheelchair: return HKObjectType.quantityType(forIdentifier: .distanceWheelchair)!
        case .swimmingStrokeCount: return HKObjectType.quantityType(forIdentifier: .swimmingStrokeCount)!
        case .pushCount: return HKObjectType.quantityType(forIdentifier: .pushCount)!
        case .bloodPressureSystolic: return HKObjectType.quantityType(forIdentifier: .bloodPressureSystolic)!
        case .bloodPressureDiastolic: return HKObjectType.quantityType(forIdentifier: .bloodPressureDiastolic)!
        case .bloodGlucose: return HKObjectType.quantityType(forIdentifier: .bloodGlucose)!
        case .electrodermalActivity: return HKObjectType.quantityType(forIdentifier: .electrodermalActivity)!
        case .forcedExpiratoryVolume1: return HKObjectType.quantityType(forIdentifier: .forcedExpiratoryVolume1)!
        case .forcedVitalCapacity: return HKObjectType.quantityType(forIdentifier: .forcedVitalCapacity)!
        case .peakExpiratoryFlowRate: return HKObjectType.quantityType(forIdentifier: .peakExpiratoryFlowRate)!
        case .peripheralPerfusionIndex: return HKObjectType.quantityType(forIdentifier: .peripheralPerfusionIndex)!
        case .numberOfAlcoholicBeverages: return HKObjectType.quantityType(forIdentifier: .numberOfAlcoholicBeverages)!
        case .bloodAlcoholContent: return HKObjectType.quantityType(forIdentifier: .bloodAlcoholContent)!
        case .inhalerUsage: return HKObjectType.quantityType(forIdentifier: .inhalerUsage)!
        case .numberOfTimesFallen: return HKObjectType.quantityType(forIdentifier: .numberOfTimesFallen)!
        case .environmentalAudioExposure: return HKObjectType.quantityType(forIdentifier: .environmentalAudioExposure)!
        case .headphoneAudioExposure: return HKObjectType.quantityType(forIdentifier: .headphoneAudioExposure)!
        case .uvExposure: return HKObjectType.quantityType(forIdentifier: .uvExposure)!
        case .timeInDaylight: return HKObjectType.quantityType(forIdentifier: .timeInDaylight)!
        case .waterTemperature: return HKObjectType.quantityType(forIdentifier: .waterTemperature)!
        case .underwaterDepth: return HKObjectType.quantityType(forIdentifier: .underwaterDepth)!
        case .sleepingWristTemperature: return HKObjectType.quantityType(forIdentifier: .appleSleepingWristTemperature)!
        case .physicalEffort: return HKObjectType.quantityType(forIdentifier: .physicalEffort)!
        }
    }

    var displayName: String {
        switch self {
        case .heartRate: return "Heart Rate"
        case .steps: return "Steps"
        case .activeEnergy: return "Active Energy"
        case .weight: return "Weight"
        case .vo2Max: return "VO2 Max"
        case .distance: return "Walking + Running Distance"
        case .flightsClimbed: return "Flights Climbed"
        case .restingHeartRate: return "Resting Heart Rate"
        case .walkingHeartRate: return "Walking Heart Rate"
        case .heartRateVariability: return "Heart Rate Variability"
        case .respiratoryRate: return "Respiratory Rate"
        case .bloodOxygen: return "Blood Oxygen"
        case .bodyFatPercentage: return "Body Fat Percentage"
        case .bmi: return "BMI"
        case .basalEnergy: return "Basal Energy"
        case .exerciseMinutes: return "Exercise Time"
        case .height: return "Height"
        case .leanBodyMass: return "Lean Body Mass"
        case .waistCircumference: return "Waist Circumference"
        case .bodyTemperature: return "Body Temperature"
        case .walkingSpeed: return "Walking Speed"
        case .walkingStepLength: return "Walking Step Length"
        case .walkingAsymmetryPercentage: return "Walking Asymmetry"
        case .walkingDoubleSupportPercentage: return "Walking Double Support"
        case .stairAscentSpeed: return "Stair Ascent Speed"
        case .stairDescentSpeed: return "Stair Descent Speed"
        case .sixMinuteWalkTestDistance: return "Six-Minute Walk Distance"
        case .walkingSteadiness: return "Walking Steadiness"
        case .runningSpeed: return "Running Speed"
        case .runningPower: return "Running Power"
        case .runningStrideLength: return "Running Stride Length"
        case .runningVerticalOscillation: return "Running Vertical Oscillation"
        case .runningGroundContactTime: return "Running Ground Contact Time"
        case .cyclingSpeed: return "Cycling Speed"
        case .cyclingPower: return "Cycling Power"
        case .cyclingCadence: return "Cycling Cadence"
        case .cyclingFunctionalThresholdPower: return "Cycling FTP"
        case .distanceCycling: return "Cycling Distance"
        case .distanceSwimming: return "Swimming Distance"
        case .distanceDownhillSnowSports: return "Snow Sports Distance"
        case .distanceWheelchair: return "Wheelchair Distance"
        case .swimmingStrokeCount: return "Swimming Strokes"
        case .pushCount: return "Wheelchair Pushes"
        case .bloodPressureSystolic: return "Blood Pressure (Systolic)"
        case .bloodPressureDiastolic: return "Blood Pressure (Diastolic)"
        case .bloodGlucose: return "Blood Glucose"
        case .electrodermalActivity: return "Electrodermal Activity"
        case .forcedExpiratoryVolume1: return "Forced Expiratory Volume"
        case .forcedVitalCapacity: return "Forced Vital Capacity"
        case .peakExpiratoryFlowRate: return "Peak Expiratory Flow"
        case .peripheralPerfusionIndex: return "Peripheral Perfusion Index"
        case .numberOfAlcoholicBeverages: return "Alcoholic Beverages"
        case .bloodAlcoholContent: return "Blood Alcohol Content"
        case .inhalerUsage: return "Inhaler Usage"
        case .numberOfTimesFallen: return "Times Fallen"
        case .environmentalAudioExposure: return "Environmental Audio Exposure"
        case .headphoneAudioExposure: return "Headphone Audio Exposure"
        case .uvExposure: return "UV Exposure"
        case .timeInDaylight: return "Time in Daylight"
        case .waterTemperature: return "Water Temperature"
        case .underwaterDepth: return "Underwater Depth"
        case .sleepingWristTemperature: return "Sleeping Wrist Temperature"
        case .physicalEffort: return "Physical Effort"
        }
    }
}

/// HKCategorySample types — sleep stages, stand hours, mindful sessions, and
/// heart/hygiene "event" markers. All read-only (see CategorySyncCoordinator).
enum HealthCategoryMetric: String, CaseIterable, Codable {
    case sleepAnalysis = "sleep_analysis"
    case standHour = "stand_hour"
    case mindfulSession = "mindful_session"
    case highHeartRateEvent = "high_heart_rate_event"
    case lowHeartRateEvent = "low_heart_rate_event"
    case irregularHeartRhythmEvent = "irregular_heart_rhythm_event"
    case handwashingEvent = "handwashing_event"
    case toothbrushingEvent = "toothbrushing_event"
    case walkingSteadinessEvent = "walking_steadiness_event"
    case lowCardioFitnessEvent = "low_cardio_fitness_event"

    var categoryType: HKCategoryType {
        switch self {
        case .sleepAnalysis: return HKObjectType.categoryType(forIdentifier: .sleepAnalysis)!
        case .standHour: return HKObjectType.categoryType(forIdentifier: .appleStandHour)!
        case .mindfulSession: return HKObjectType.categoryType(forIdentifier: .mindfulSession)!
        case .highHeartRateEvent: return HKObjectType.categoryType(forIdentifier: .highHeartRateEvent)!
        case .lowHeartRateEvent: return HKObjectType.categoryType(forIdentifier: .lowHeartRateEvent)!
        case .irregularHeartRhythmEvent: return HKObjectType.categoryType(forIdentifier: .irregularHeartRhythmEvent)!
        case .handwashingEvent: return HKObjectType.categoryType(forIdentifier: .handwashingEvent)!
        case .toothbrushingEvent: return HKObjectType.categoryType(forIdentifier: .toothbrushingEvent)!
        case .walkingSteadinessEvent: return HKObjectType.categoryType(forIdentifier: .appleWalkingSteadinessEvent)!
        case .lowCardioFitnessEvent: return HKObjectType.categoryType(forIdentifier: .lowCardioFitnessEvent)!
        }
    }

    var displayName: String {
        switch self {
        case .sleepAnalysis: return "Sleep"
        case .standHour: return "Stand Hours"
        case .mindfulSession: return "Mindful Minutes"
        case .highHeartRateEvent: return "High Heart Rate Events"
        case .lowHeartRateEvent: return "Low Heart Rate Events"
        case .irregularHeartRhythmEvent: return "Irregular Rhythm Notifications"
        case .handwashingEvent: return "Handwashing"
        case .toothbrushingEvent: return "Toothbrushing"
        case .walkingSteadinessEvent: return "Walking Steadiness Events"
        case .lowCardioFitnessEvent: return "Low Cardio Fitness Events"
        }
    }

    var icon: String {
        switch self {
        case .sleepAnalysis: return "moon.zzz.fill"
        case .standHour: return "figure.stand"
        case .mindfulSession: return "leaf.fill"
        case .highHeartRateEvent: return "arrow.up.heart.fill"
        case .lowHeartRateEvent: return "arrow.down.heart.fill"
        case .irregularHeartRhythmEvent: return "waveform.path.ecg"
        case .handwashingEvent: return "hands.sparkles.fill"
        case .toothbrushingEvent: return "timer"
        case .walkingSteadinessEvent: return "figure.walk.motion"
        case .lowCardioFitnessEvent: return "bolt.heart.fill"
        }
    }

    // Only sleepAnalysis and standHour have a well-documented, stable public
    // value enum worth translating to a friendly string. Every event type's
    // raw `value` is reported as-is (still fully captured, just not
    // translated) rather than guessing at an undocumented enum name.
    func valueDescription(rawValue: Int) -> String {
        switch self {
        case .sleepAnalysis:
            switch HKCategoryValueSleepAnalysis(rawValue: rawValue) {
            case .inBed: return "in_bed"
            case .asleepUnspecified: return "asleep_unspecified"
            case .awake: return "awake"
            case .asleepCore: return "asleep_core"
            case .asleepDeep: return "asleep_deep"
            case .asleepREM: return "asleep_rem"
            default: return String(rawValue)
            }
        case .standHour:
            switch HKCategoryValueAppleStandHour(rawValue: rawValue) {
            case .stood: return "stood"
            case .idle: return "idle"
            default: return String(rawValue)
            }
        default:
            return String(rawValue)
        }
    }
}
