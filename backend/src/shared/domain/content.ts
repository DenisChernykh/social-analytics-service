export type ContextValues = {
  rubric?: string | null;
  series?: string | null;
  topics?: string[];
  tags?: string[];
  format?: string | null;
  hook?: string | null;
  callToAction?: string | null;
  goal?: string | null;
  sponsored?: boolean | null;
  paidDistribution?: boolean | null;
  brandPartnership?: boolean | null;
  coauthor?: boolean | null;
  notes?: string | null;
};
export type ContentContext = {
  confirmed: ContextValues;
  proposal: ContextValues;
  confirmedSource: "manual";
  proposalSource: "assistant_suggestion";
  updatedAt: number;
};
