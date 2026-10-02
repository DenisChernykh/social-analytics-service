import { type BusinessRecord, divide } from "./model";

export function businessResults(id: string, records: BusinessRecord[]) {
  const sum = (kind: BusinessRecord["kind"], currency?: string) => {
    const rows = records.filter(
      (row) => row.kind === kind && (currency === undefined || row.currency === currency),
    );
    return rows.length ? rows.reduce((total, row) => total + row.value, 0) : null;
  };
  const hours = sum("production_hours");
  const currencies = [
    ...new Set(
      records.map((row) => row.currency).filter((value): value is string => value !== null),
    ),
  ];
  return {
    mediaId: id,
    records,
    hours,
    leadsPerHour: divide(sum("leads"), hours, "attributed leads / known production hours"),
    salesPerHour: divide(sum("sales"), hours, "attributed sales / known production hours"),
    currencies: currencies.map((currency) => {
      const cost = sum("production_cost", currency);
      const profit = sum("profit", currency);
      return {
        currency,
        cost,
        revenue: sum("revenue", currency),
        profit,
        revenuePerCost: divide(
          sum("revenue", currency),
          cost,
          "attributed gross revenue / production cost (not ROI)",
        ),
        returnOnCost: divide(
          profit,
          cost,
          "attributed net profit after all attributable costs / production cost",
        ),
        profitPerHour: divide(profit, hours, "attributed net profit / known production hours"),
      };
    }),
    limitations: [
      "Missing records are unknown, not zero. Records are explicit attributed increments; avoid overlapping cumulative totals.",
      "Shared costs must be allocated once according to the recorded allocation rule. Currency totals are separate; no currency conversion.",
      "Gross revenue is not profit. Return on cost uses explicitly supplied net profit, never revenue. This is not full-business ROI.",
      "Manual attribution is an owner assertion, not evidence of causation.",
    ],
  };
}
