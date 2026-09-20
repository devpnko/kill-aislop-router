// Synthetic fixtures only. These dates/reasons are not UI Bowl observations.
export function missingPopularity(settings, index, signalId) {
  return settings.unavailable_popularity === "all" ||
    (settings.unavailable_popularity === "first" && index === 0) ||
    (settings.unavailable_signal_ids || []).includes(signalId);
}

export function unavailableRecord(record) {
  const { raw_value: _raw, as_of: _asOf, snapshot_at: _snapshot, ...rest } = record;
  return { ...rest, record_kind: "unavailable", checked_at: "2026-09-04T01:00:00.000Z",
    reason: "Synthetic capture fixture contains a control but no public count." };
}

export function unavailableSignal(signal) {
  const { raw_value: _raw, normalized_score: _score, as_of: _asOf,
    snapshot_at: _snapshot, ...rest } = signal;
  return { ...rest, availability: "unavailable", checked_at: "2026-09-04T01:00:00.000Z",
    reason: "Synthetic capture fixture contains a control but no public count." };
}
