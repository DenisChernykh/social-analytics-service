export const measurementDefinitionVersion = "instagram-measurement-v2";

export type ReceiptReference = {
  receiptId: string;
  operationId: string | null;
  requestStartedAt: number;
  responseReceivedAt: number | null;
  requestedApiVersion: string;
  actualApiVersion: string | null;
  login: "instagram_login";
};
export type MeasurementProvenance = ReceiptReference & {
  definitionVersion: string;
  surface: "instagram" | "facebook" | "combined" | "unknown";
  distribution: "organic" | "includes_paid" | "unknown";
};
export type ObservationProvenance = {
  requestStartedAt: number;
  responseReceivedAt: number;
  receiptIds: string[];
  semantics: "sequential_requests_lifetime";
  definitionVersion: string;
};

export function compatibleMeasurements(
  a: { unit: string; provenance?: MeasurementProvenance | null },
  b: { unit: string; provenance?: MeasurementProvenance | null },
  toleranceMs = 60_000,
) {
  if (a.unit !== b.unit) return false;
  const x = a.provenance,
    y = b.provenance;
  if (!x && !y) return true; // Legacy: same saved observation, provenance remains unknown.
  if (!x || !y) return false;
  // Unknown paid coverage is disclosed; only a known organic/includes-paid contradiction rejects a pair.
  return (
    x.definitionVersion === y.definitionVersion &&
    x.login === y.login &&
    x.requestedApiVersion === y.requestedApiVersion &&
    x.surface === y.surface &&
    (x.distribution === y.distribution ||
      x.distribution === "unknown" ||
      y.distribution === "unknown") &&
    (x.actualApiVersion === null ||
      y.actualApiVersion === null ||
      x.actualApiVersion === y.actualApiVersion) &&
    x.responseReceivedAt !== null &&
    y.responseReceivedAt !== null &&
    Math.abs(x.responseReceivedAt - y.responseReceivedAt) <= toleranceMs
  );
}
