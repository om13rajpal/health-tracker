import SwiftUI
import UIKit

/// The same ledger palette the web app uses, so the bridge reads as part of
/// the same thing rather than as a separate utility. One accent carries every
/// interactive element; the status trio is reserved for state and never used
/// decoratively.
enum BridgeTheme {
    /// The dark band behind the header — the page ground on the web.
    static let band = Color(light: Color(hex: 0x15211C), dark: Color(hex: 0x080F0D))
    /// A touch deeper than `band` — the far end of the header's gradient,
    /// giving the one card in the app with real weight a little more depth
    /// than a flat fill.
    static let bandDeep = Color(light: Color(hex: 0x0E1712), dark: Color(hex: 0x050A08))
    static let onBand = Color(light: Color(hex: 0xEEF0E9), dark: Color(hex: 0xE7EAE3))
    static let onBandSoft = Color(light: Color(hex: 0x9DAAA1), dark: Color(hex: 0x93A19A))

    static let paper = Color(light: Color(hex: 0xEFF0EA), dark: Color(hex: 0x0E1714))
    static let field = Color(light: Color(hex: 0xFAFBF7), dark: Color(hex: 0x16211D))
    static let ink = Color(light: Color(hex: 0x15211C), dark: Color(hex: 0xE7EAE3))
    static let inkSoft = Color(light: Color(hex: 0x4A564F), dark: Color(hex: 0x9AA79F))
    static let inkFaint = Color(light: Color(hex: 0x7C877F), dark: Color(hex: 0x75837B))
    static let rule = Color(light: Color(hex: 0xD7D9D0), dark: Color(hex: 0x29362F))

    static let accent = Color(light: Color(hex: 0x0C6C41), dark: Color(hex: 0x0D8A55))

    // Reserved for state. Never a decorative colour.
    static let good = Color(light: Color(hex: 0x0C6C41), dark: Color(hex: 0x4FB383))
    static let warn = Color(light: Color(hex: 0x8F6208), dark: Color(hex: 0xD9A441))
    static let bad = Color(light: Color(hex: 0x9B3A21), dark: Color(hex: 0xE0836A))

    // The band is dark under both appearances, so anything drawn on it uses the
    // dark-tuned step in both — the light-mode pigments do not carry enough
    // contrast against it.
    static let accentOnBand = Color(hex: 0x0D8A55)
    static let warnOnBand = Color(hex: 0xD9A441)
    static let badOnBand = Color(hex: 0xE0836A)

    /// Numerals are read as data, so they get tabular figures and a monospaced
    /// digit width — the same rule the web app follows.
    static func reading(_ size: CGFloat, weight: Font.Weight = .semibold) -> Font {
        .system(size: size, weight: weight, design: .rounded).monospacedDigit()
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255
        )
    }

    /// Resolves per appearance rather than flipping one palette, matching the
    /// web app's "dark is a selected theme, not an inversion" rule.
    init(light: Color, dark: Color) {
        self.init(UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}
