export type BusinessRecord = {
  id: string;
  mediaId: string;
  kind:
    | "production_hours"
    | "production_cost"
    | "leads"
    | "sales"
    | "revenue"
    | "profit"
    | "clicks";
  value: number;
  unit: "hours" | "count" | "money";
  currency: string | null;
  from: number;
  to: number;
  source: string;
  attribution: "production" | "tagged_link" | "promo_code" | "confirmed_manual";
  allocation: string;
  recordedAt?: number;
};
export type ExperimentPlan = {
  question: string;
  metric: "views" | "reach" | "saves" | "shares" | "comments" | "follows";
  ageDays: 1 | 7 | 30;
  decisionRule: string;
  minimumSample: number;
  variants: { name: string; mediaIds: string[] }[];
  retrospective: boolean;
};
export type Experiment = {
  id: string;
  accountId: string;
  createdAt: number;
  plan: ExperimentPlan;
  assignments: { variant: string; mediaId: string }[];
  conclusion: {
    verdict: "supported" | "not_supported" | "insufficient_data";
    reasoning: string;
    nextCheck: string;
    recordedAt: number;
    source: "manual";
  } | null;
};
export type StorySequence = {
  id: string;
  accountId: string;
  name: string;
  mediaIds: string[];
  source: "manual";
  updatedAt: number;
};
export function divide(numerator: number | null, denominator: number | null, formula: string) {
  return {
    value:
      numerator !== null && denominator !== null && denominator > 0
        ? numerator / denominator
        : null,
    inputs: { numerator, denominator },
    formula,
    reason:
      numerator === null || denominator === null
        ? "missing_inputs"
        : denominator === 0
          ? "zero_denominator"
          : null,
  };
}
