export const GUIDANCE_SOURCE_STRATEGIES = ["ignore", "copy", "move", "keep_source_fill_gaps"] as const;

export type GuidanceSourceStrategy = (typeof GUIDANCE_SOURCE_STRATEGIES)[number];

export type ConfirmedGuidanceSourceStrategy = {
  sourceRef: string;
  strategy: GuidanceSourceStrategy;
  note: string | null;
};

export const formatGuidanceSourceStrategy = (strategy: GuidanceSourceStrategy): string => {
  switch (strategy) {
    case "ignore":
      return "ignore";
    case "copy":
      return "copy";
    case "move":
      return "move";
    case "keep_source_fill_gaps":
      return "keep source, fill gaps in bank";
  }
};
