import SwiftUI

struct StatusView: View {
    @Environment(HealthKitAuthManager.self) private var authManager
    @Environment(\.healthObserverCoordinator) private var deliveryToggle
    let lastSyncStore: LastSyncStore
    @State private var viewModel: StatusViewModel?
    @State private var filter: MetricFilter = .on
    @State private var searchText = ""

    var body: some View {
        NavigationStack {
            List {
                Section {
                    SyncHeader(summary: viewModel?.summary)
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
                    Picker("Show", selection: $filter) {
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
                    }
                } else {
                    ForEach(sections) { section in
                        Section {
                            ForEach(section.rows) { row in
                                MetricRow(row: row) { newValue in
                                    viewModel?.setEnabled(newValue, for: row.id)
                                }
                            }
                        } header: {
                            SectionHeader(
                                section: section,
                                onSetAll: { enabled in
                                    viewModel?.setEnabled(enabled, forGroup: section.group)
                                }
                            )
                        } footer: {
                            Text(section.group.blurb)
                                .font(.caption)
                                .foregroundStyle(BridgeTheme.inkFaint)
                        }
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
                        deliveryToggle: deliveryToggle
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
}

// MARK: - Header

/// The one bold moment in the app: a dark band that answers "is anything
/// actually reaching the server?" before any toggle is visible.
private struct SyncHeader: View {
    let summary: StatusSummary?

    private var accent: Color {
        switch summary?.state {
        case .broken: return BridgeTheme.badOnBand
        case .idle: return BridgeTheme.onBandSoft
        case .waiting: return BridgeTheme.warnOnBand
        case .streaming, .none: return BridgeTheme.accentOnBand
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Streaming to the ledger")
                .font(.caption)
                .foregroundStyle(BridgeTheme.onBandSoft)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(summary?.enabled ?? 0)")
                    .font(BridgeTheme.reading(44, weight: .heavy))
                    .foregroundStyle(accent)
                Text("of \(summary?.total ?? HealthMetric.allCases.count) metrics")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(BridgeTheme.onBandSoft)
            }

            Text(summary?.detail() ?? "Reading the current state…")
                .font(.footnote)
                .foregroundStyle(BridgeTheme.onBand)
                .fixedSize(horizontal: false, vertical: true)

            Text("iOS decides when background delivery runs, so this is never live to the second.")
                .font(.caption2)
                .foregroundStyle(BridgeTheme.onBandSoft)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(BridgeTheme.band)
        .overlay(alignment: .leading) {
            Rectangle().fill(accent).frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .padding(.vertical, 4)
    }
}

// MARK: - Rows

private struct MetricRow: View {
    let row: StatusRow
    let onToggle: (Bool) -> Void

    var body: some View {
        HStack(spacing: 12) {
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
        .padding(.vertical, 2)
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
        HStack(alignment: .firstTextBaseline) {
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
