import Foundation
import HealthKit

struct HealthEventPayload: Codable, Equatable {
    let source: String
    let metric: String
    let timestamp: String
    let value: Double
    let unit: String?
}

extension ISO8601DateFormatter {
    nonisolated(unsafe) static let hb: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

enum HealthSampleNormalizer {
    static func payload(for sample: HKQuantitySample, metric: HealthMetric) -> HealthEventPayload {
        let (value, unit) = quantityValueAndUnit(sample.quantity, metric: metric)
        return HealthEventPayload(
            source: "ios-bridge",
            metric: metric.rawValue,
            timestamp: ISO8601DateFormatter.hb.string(from: sample.endDate),
            value: value,
            unit: unit
        )
    }

    private static func quantityValueAndUnit(_ quantity: HKQuantity, metric: HealthMetric) -> (Double, String?) {
        let unit = HealthUnitMapper.unit(for: metric)
        return (quantity.doubleValue(for: unit), HealthUnitMapper.wireUnit(for: metric))
    }
}

struct WorkoutPayload: Codable, Equatable {
    let source: String
    let activityType: String
    let startDate: String
    let endDate: String
    let durationSeconds: Double
    let totalEnergyBurnedKcal: Double?
    let totalDistanceMeters: Double?
}

enum WorkoutActivityTypeMapper {
    // Not every one of HKWorkoutActivityType's 80+ cases is listed — anything
    // not covered here falls back to "other" (still synced, just generically
    // labeled) rather than being dropped, matching every other scope decision
    // in this file: sync everything, degrade gracefully for the long tail.
    static func wireValue(for activityType: HKWorkoutActivityType) -> String {
        switch activityType {
        case .running: return "running"
        case .walking: return "walking"
        case .cycling: return "cycling"
        case .swimming: return "swimming"
        case .hiking: return "hiking"
        case .yoga: return "yoga"
        case .functionalStrengthTraining: return "functional_strength_training"
        case .traditionalStrengthTraining: return "traditional_strength_training"
        case .coreTraining: return "core_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .mixedCardio: return "mixed_cardio"
        case .elliptical: return "elliptical"
        case .rowing: return "rowing"
        case .stairClimbing: return "stair_climbing"
        case .dance: return "dance"
        case .pilates: return "pilates"
        case .boxing: return "boxing"
        case .soccer: return "soccer"
        case .basketball: return "basketball"
        case .tennis: return "tennis"
        case .badminton: return "badminton"
        case .cricket: return "cricket"
        case .cooldown: return "cooldown"
        case .flexibility: return "flexibility"
        case .stairs: return "stairs"
        case .stepTraining: return "step_training"
        case .crossTraining: return "cross_training"
        case .jumpRope: return "jump_rope"
        case .kickboxing: return "kickboxing"
        case .martialArts: return "martial_arts"
        case .climbing: return "climbing"
        case .golf: return "golf"
        case .tableTennis: return "table_tennis"
        case .volleyball: return "volleyball"
        case .trackAndField: return "track_and_field"
        case .paddleSports: return "paddle_sports"
        case .other: return "other"
        default: return "other"
        }
    }
}

enum WorkoutNormalizer {
    static func payload(for workout: HKWorkout) -> WorkoutPayload {
        WorkoutPayload(
            source: "ios-bridge",
            activityType: WorkoutActivityTypeMapper.wireValue(for: workout.workoutActivityType),
            startDate: ISO8601DateFormatter.hb.string(from: workout.startDate),
            endDate: ISO8601DateFormatter.hb.string(from: workout.endDate),
            durationSeconds: workout.duration,
            totalEnergyBurnedKcal: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
            totalDistanceMeters: workout.totalDistance?.doubleValue(for: .meter())
        )
    }
}

struct CategorySamplePayload: Codable, Equatable {
    let source: String
    let category: String
    let value: String
    let startDate: String
    let endDate: String
}

enum CategorySampleNormalizer {
    static func payload(for sample: HKCategorySample, category: HealthCategoryMetric) -> CategorySamplePayload {
        CategorySamplePayload(
            source: "ios-bridge",
            category: category.rawValue,
            value: category.valueDescription(rawValue: sample.value),
            startDate: ISO8601DateFormatter.hb.string(from: sample.startDate),
            endDate: ISO8601DateFormatter.hb.string(from: sample.endDate)
        )
    }
}

struct MoodPayload: Codable, Equatable {
    let source: String
    let kind: String
    let valence: Double
    let valenceClassification: String?
    let labels: [String]
    let associations: [String]
    let date: String
}

@available(iOS 18.0, *)
enum MoodNormalizer {
    static func payload(for mood: HKStateOfMind) -> MoodPayload {
        MoodPayload(
            source: "ios-bridge",
            kind: mood.kind == .dailyMood ? "daily_mood" : "momentary_emotion",
            valence: mood.valence,
            valenceClassification: valenceClassificationString(mood.valenceClassification),
            labels: mood.labels.map(labelString),
            associations: mood.associations.map(associationString),
            date: ISO8601DateFormatter.hb.string(from: mood.startDate)
        )
    }

    private static func valenceClassificationString(_ classification: HKStateOfMind.ValenceClassification) -> String {
        switch classification {
        case .veryUnpleasant: return "very_unpleasant"
        case .unpleasant: return "unpleasant"
        case .slightlyUnpleasant: return "slightly_unpleasant"
        case .neutral: return "neutral"
        case .slightlyPleasant: return "slightly_pleasant"
        case .pleasant: return "pleasant"
        case .veryPleasant: return "very_pleasant"
        @unknown default: return "neutral"
        }
    }

    // HKStateOfMind.Label/.Association are large, Apple-curated enums (dozens
    // of cases each) with no public rawValue string — `description`/mirror
    // via debugDescription would be too fragile to rely on, so this falls
    // back to a generic marker for anything not explicitly named here rather
    // than guessing at internal representations. Covers the common labels a
    // user is most likely to actually pick.
    private static func labelString(_ label: HKStateOfMind.Label) -> String {
        switch label {
        case .amazed: return "amazed"
        case .amused: return "amused"
        case .angry: return "angry"
        case .anxious: return "anxious"
        case .ashamed: return "ashamed"
        case .brave: return "brave"
        case .calm: return "calm"
        case .content: return "content"
        case .disappointed: return "disappointed"
        case .discouraged: return "discouraged"
        case .disgusted: return "disgusted"
        case .embarrassed: return "embarrassed"
        case .excited: return "excited"
        case .frustrated: return "frustrated"
        case .grateful: return "grateful"
        case .guilty: return "guilty"
        case .happy: return "happy"
        case .hopeful: return "hopeful"
        case .indifferent: return "indifferent"
        case .jealous: return "jealous"
        case .joyful: return "joyful"
        case .lonely: return "lonely"
        case .overwhelmed: return "overwhelmed"
        case .peaceful: return "peaceful"
        case .proud: return "proud"
        case .relieved: return "relieved"
        case .sad: return "sad"
        case .scared: return "scared"
        case .stressed: return "stressed"
        case .surprised: return "surprised"
        case .worried: return "worried"
        default: return "other"
        }
    }

    private static func associationString(_ association: HKStateOfMind.Association) -> String {
        switch association {
        case .community: return "community"
        case .currentEvents: return "current_events"
        case .dating: return "dating"
        case .education: return "education"
        case .family: return "family"
        case .fitness: return "fitness"
        case .friends: return "friends"
        case .health: return "health"
        case .hobbies: return "hobbies"
        case .identity: return "identity"
        case .money: return "money"
        case .partner: return "partner"
        case .selfCare: return "self_care"
        case .spirituality: return "spirituality"
        case .tasks: return "tasks"
        case .travel: return "travel"
        case .weather: return "weather"
        case .work: return "work"
        default: return "other"
        }
    }
}
