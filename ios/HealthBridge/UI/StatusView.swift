import SwiftUI

struct StatusView: View {
    @Environment(HealthKitAuthManager.self) private var authManager
    @Environment(\.healthObserverCoordinator) private var deliveryToggle
    @Environment(\.syncAllNow) private var syncAllNow
    let lastSyncStore: LastSyncStore
    let eventSyncErrors: EventSyncErrorStore?
    @State private var viewModel: StatusViewModel?
    @State private var filter: MetricFilter = .on
    @State private var searchText = ""
    @State private var syncPhase: SyncPhase = .idle

    var body: some View {
        NavigationStack {
            List {
                Section {
                    SyncHeader(summary: viewModel?.summary, syncPhase: syncPhase, onSyncNow: syncNow)
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                }

                if !AppConfig.isConfigured {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("This build has no server to send to")
                                    .font(.subheadline.weight(.semibold))
                                Text("API_BASE_URL and MCP_ACCESS_TOKEN are still placeholders, so every upload fails. Set them in Secrets.xcconfig and rebuild.")
                                    .font(.footnote)
                                    .foregroundStyle(BridgeTheme.inkSoft)
                            }
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(BridgeTheme.warn)
                        }
                    }
                }

                if let authError = authManager.authorizationError {
                    Section {
                        Label {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Health data isn't available")
                                    .font(.subheadline.weight(.semibold))
                                Text(authError)
                                    .font(.footnote)
                                    .foregroundStyle(BridgeTheme.inkSoft)
                                Text("Nothing will sync until this is resolved in Settings › Health.")
                                    .font(.footnote)
                                    .foregroundStyle(BridgeTheme.inkSoft)
                            }
                        } icon: {
                            Image(systemName: "exclamationmark.triangle.fill")
                                .foregroundStyle(BridgeTheme.bad)
                        }
                    }
                }

                Section {
                    Picker("Show", selection: $filter.animation(.easeInOut(duration: 0.2))) {
                        ForEach(MetricFilter.allCases) { option in
                            Text(option.label).tag(option)
                        }
                    }
                    .pickerStyle(.segmented)
                    .listRowInsets(EdgeInsets(top: 4, leading: 0, bottom: 8, trailing: 0))
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                }

                let sections = viewModel?.sections(filter: filter, searchText: searchText) ?? []

                if sections.isEmpty {
                    Section {
                        EmptyResult(filter: filter, searchText: searchText)
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                            .transition(.opacity.combined(with: .scale(scale: 0.97)))
                    }
                } else {
                    ForEach(sections) { section in
                        Section {
                            ForEach(section.rows) { row in
                                MetricRow(row: row) { newValue in
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        viewModel?.setEnabled(newValue, for: row.id)
                                    }
                                }
                            }
                        } header: {
                            SectionHeader(
                                section: section,
                                onSetAll: { enabled in
                                    withAnimation(.easeInOut(duration: 0.2)) {
                                        viewModel?.setEnabled(enabled, forGroup: section.group)
                                    }
                                }
                            )
                        } footer: {
                            Text(section.group.blurb)
                                .font(.caption)
                                .foregroundStyle(BridgeTheme.inkFaint)
                        }
                    }
                }

                if let eventRows = viewModel?.eventRows, !eventRows.isEmpty {
                    Section {
                        ForEach(eventRows) { row in
                            EventRow(row: row)
                        }
                    } header: {
                        Text("Workouts, sleep & mood")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(BridgeTheme.ink)
                            .textCase(nil)
                    } footer: {
                        Text("These sync automatically, so there's no switch to turn them off. Each one updates the moment Health has something new.")
                            .font(.caption)
                            .foregroundStyle(BridgeTheme.inkFaint)
                    }
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(BridgeTheme.paper)
            .navigationTitle("HealthBridge")
            .navigationBarTitleDisplayMode(.inline)
            .searchable(text: $searchText, prompt: "Find a metric")
            .tint(BridgeTheme.accent)
            .onAppear {
                if viewModel == nil {
                    let vm = StatusViewModel(
                        authManager: authManager,
                        lastSyncStore: lastSyncStore,
                        deliveryToggle: deliveryToggle,
                        eventSyncErrors: eventSyncErrors
                    )
                    if let coordinator = deliveryToggle as? HealthObserverCoordinator {
                        coordinator.onDeliveryError = { [weak vm] metric, message in
                            // HealthKit invokes this from completion-handler/callback
                            // contexts with no main-thread guarantee, but `vm` is an
                            // @Observable view model whose state StatusView.body reads
                            // on the main thread — hop explicitly rather than racing it.
                            DispatchQueue.main.async {
                                vm?.recordDeliveryError(message, for: metric)
                            }
                        }
                    }
                    viewModel = vm
                }
                // Runs on every appearance (not just the first), so backgrounding and
                // re-foregrounding the app refreshes last-sync captions instead of
                // freezing them after the first appearance. Harmlessly redundant with
                // the refresh() the StatusViewModel init above already performs on the
                // very first appearance.
                viewModel?.refresh()
            }
        }
    }

    /// A visible, tappable counterpart to the passive background-delivery
    /// sync — see `AppDelegate.syncAllNow()`. There's no way to know from
    /// here how much a coordinator still has left to drain, so this doesn't
    /// pretend to track real progress — it holds `.syncing` for a few
    /// seconds (enough for a small delta, the common case, to land and show
    /// an updated "Last synced" time), then confirms with `.justSynced`
    /// before settling back to idle. The confirmation is the one
    /// deliberately animated moment in this screen: it answers the tap.
    private func syncNow() {
        guard syncPhase == .idle else { return }
        syncAllNow?()
        syncPhase = .syncing
        Task {
            try? await Task.sleep(for: .seconds(4))
            viewModel?.refresh()
            withAnimation(.spring(response: 0.45, dampingFraction: 0.65)) {
                syncPhase = .justSynced
            }
            try? await Task.sleep(for: .seconds(1.3))
            withAnimation(.easeInOut(duration: 0.3)) {
                syncPhase = .idle
            }
        }
    }
}

private enum SyncPhase: Equatable {
    case idle
    case syncing
    case justSynced
}

// MARK: - Header

/// The one bold moment in the app: a dark band that answers "is anything
/// actually reaching the server?" before any toggle is visible.
private struct SyncHeader: View {
    let summary: StatusSummary?
    let syncPhase: SyncPhase
    let onSyncNow: () -> Void

    private var accent: Color {
        switch summary?.state {
        case .broken: return BridgeTheme.badOnBand
        case .idle: return BridgeTheme.onBandSoft
        case .waiting: return BridgeTheme.warnOnBand
        case .streaming, .none: return BridgeTheme.accentOnBand
        }
    }

    private var progress: Double {
        guard let summary, summary.total > 0 else { return 0 }
        return Double(summary.enabled) / Double(summary.total)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline) {
                HStack(spacing: 6) {
                    Circle()
                        .fill(accent)
                        .frame(width: 6, height: 6)
                    Text("Streaming to the ledger")
                        .font(.caption)
                        .foregroundStyle(BridgeTheme.onBandSoft)
                }
                Spacer()
                SyncButton(phase: syncPhase, action: onSyncNow)
            }

            HStack(alignment: .center, spacing: 16) {
                RingGauge(
                    progress: progress,
                    trackColor: BridgeTheme.onBandSoft.opacity(0.22),
                    color: accent,
                    enabledCount: summary?.enabled ?? 0,
                    justSynced: syncPhase == .justSynced
                )
                .frame(width: 62, height: 62)

                VStack(alignment: .leading, spacing: 3) {
                    Text("of \(summary?.total ?? HealthMetric.allCases.count) metrics switched on")
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(BridgeTheme.onBand)
                    Text(summary?.detail() ?? "Reading the current state…")
                        .font(.footnote)
                        .foregroundStyle(BridgeTheme.onBandSoft)
                        .fixedSize(horizontal: false, vertical: true)
                        .contentTransition(.opacity)
                }
            }

            Text("iOS decides when background delivery runs on its own. Tap Sync now to try immediately, which works best with the app open.")
                .font(.caption2)
                .foregroundStyle(BridgeTheme.onBandSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(
            LinearGradient(
                colors: [BridgeTheme.band, BridgeTheme.bandDeep],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(.vertical, 4)
        .animation(.easeInOut(duration: 0.3), value: accent)
        .animation(.easeInOut(duration: 0.6), value: progress)
    }
}

private struct SyncButton: View {
    let phase: SyncPhase
    let action: () -> Void

    private var label: String {
        switch phase {
        case .idle: return "Sync now"
        case .syncing: return "Syncing…"
        case .justSynced: return "Synced"
        }
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                switch phase {
                case .idle:
                    Image(systemName: "arrow.triangle.2.circlepath")
                case .syncing:
                    ProgressView().tint(BridgeTheme.onBand).scaleEffect(0.7)
                case .justSynced:
                    Image(systemName: "checkmark")
                }
                Text(label)
            }
            .font(.caption.weight(.semibold))
            .contentTransition(.opacity)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(BridgeTheme.onBand.opacity(phase == .justSynced ? 0.2 : 0.12), in: Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(BridgeTheme.onBand)
        .disabled(phase != .idle)
        .animation(.easeInOut(duration: 0.25), value: phase)
    }
}

/// A thin ring gauge, the same visual language as Apple's own Activity
/// rings, used here for "how much of the catalogue is switched on" — a
/// proportion reads faster as a ring than as a fraction of two numbers.
/// The one deliberately animated moment in the screen lives here too: a
/// ripple that answers a completed "Sync now" tap, rather than motion
/// scattered across every row.
private struct RingGauge: View {
    let progress: Double
    let trackColor: Color
    let color: Color
    let enabledCount: Int
    let justSynced: Bool

    var body: some View {
        ZStack {
            Circle().stroke(trackColor, lineWidth: 6)
            Circle()
                .trim(from: 0, to: max(0.001, min(1, progress)))
                .stroke(color, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                .rotationEffect(.degrees(-90))

            // The ripple: a ring that expands outward and fades, answering a
            // completed "Sync now" tap. Reserved for that one moment rather
            // than looping or repeating on its own.
            Circle()
                .stroke(color, lineWidth: 2)
                .scaleEffect(justSynced ? 1.5 : 1)
                .opacity(justSynced ? 0 : 0.7)
                .animation(.easeOut(duration: 0.9), value: justSynced)

            if justSynced {
                Image(systemName: "checkmark")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(color)
                    .transition(.scale.combined(with: .opacity))
            } else {
                Text("\(enabledCount)")
                    .font(BridgeTheme.reading(22, weight: .heavy))
                    .foregroundStyle(color)
                    .contentTransition(.numericText())
                    .transition(.scale.combined(with: .opacity))
            }
        }
        .animation(.spring(response: 0.45, dampingFraction: 0.65), value: justSynced)
    }
}

// MARK: - Rows

/// A small circular icon, tinted with the row's state rather than
/// decoratively per-metric — `BridgeTheme`'s own rule is one accent for
/// everything interactive and the status trio reserved for state, so a
/// rainbow of per-group colors here would work against the palette this
/// app already committed to. The icon itself still varies; the color says
/// whether it's fine or not.
private struct IconBadge: View {
    let systemName: String
    let isBad: Bool

    var body: some View {
        ZStack {
            Circle().fill((isBad ? BridgeTheme.bad : BridgeTheme.ink).opacity(isBad ? 0.12 : 0.07))
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(isBad ? BridgeTheme.bad : BridgeTheme.inkSoft)
        }
        .frame(width: 30, height: 30)
    }
}

private struct MetricRow: View {
    let row: StatusRow
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: row.id.group.icon, isBad: row.errorMessage != nil)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.displayName)
                    .font(.body)
                    .foregroundStyle(BridgeTheme.ink)
                if let errorMessage = row.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(BridgeTheme.bad)
                } else {
                    Text(row.lastSyncDescription)
                        .font(.caption)
                        .foregroundStyle(row.lastSync == nil ? BridgeTheme.inkFaint : BridgeTheme.inkSoft)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 8)
            Toggle("", isOn: Binding(get: { row.isEnabled }, set: onToggle))
                .labelsHidden()
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(row.displayName))
        .accessibilityValue(Text(row.errorMessage ?? row.lastSyncDescription))
    }
}

/// The read-only counterpart to `MetricRow` for workouts, category samples,
/// and mood — a status line with no toggle, since there's nothing to switch.
private struct EventRow: View {
    let row: EventSyncRow

    var body: some View {
        HStack(spacing: 12) {
            IconBadge(systemName: row.icon, isBad: row.errorMessage != nil)
            VStack(alignment: .leading, spacing: 3) {
                Text(row.displayName)
                    .font(.body)
                    .foregroundStyle(BridgeTheme.ink)
                if let errorMessage = row.errorMessage {
                    Label(errorMessage, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(BridgeTheme.bad)
                } else {
                    Text(row.lastSyncDescription)
                        .font(.caption)
                        .foregroundStyle(row.lastSync == nil ? BridgeTheme.inkFaint : BridgeTheme.inkSoft)
                        .monospacedDigit()
                }
            }
            Spacer(minLength: 8)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(row.displayName))
        .accessibilityValue(Text(row.errorMessage ?? row.lastSyncDescription))
    }
}

private struct SectionHeader: View {
    let section: MetricSection
    let onSetAll: (Bool) -> Void

    private var allOn: Bool { section.enabledCount == section.rows.count }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Image(systemName: section.group.icon)
                .font(.caption)
                .foregroundStyle(BridgeTheme.accent)
            Text(section.group.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(BridgeTheme.ink)
                .textCase(nil)
            Spacer()
            Text("\(section.enabledCount)/\(section.rows.count)")
                .font(.caption.monospacedDigit())
                .foregroundStyle(BridgeTheme.inkFaint)
            Button(allOn ? "Turn off" : "Turn on") { onSetAll(!allOn) }
                .font(.caption.weight(.semibold))
                .buttonStyle(.plain)
                .foregroundStyle(BridgeTheme.accent)
                .textCase(nil)
        }
        .padding(.bottom, 2)
    }
}

/// An empty result is an instruction, not a shrug.
private struct EmptyResult: View {
    let filter: MetricFilter
    let searchText: String

    private var message: String {
        if !searchText.trimmingCharacters(in: .whitespaces).isEmpty {
            return "No metric matches “\(searchText)”. Try the metric's name as it appears in the Health app."
        }
        switch filter {
        case .problems: return "Nothing is failing. Every metric that is switched on is delivering."
        case .on: return "Every metric is switched off. Switch on All to pick the ones to send."
        case .all: return "No metrics available."
        }
    }

    var body: some View {
        Text(message)
            .font(.footnote)
            .foregroundStyle(BridgeTheme.inkSoft)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 12)
    }
}
