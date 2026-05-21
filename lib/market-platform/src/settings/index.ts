export interface PlatformSettings {
  defaultProvider: string;
  defaultWorkspaceId?: string;
  marketTimezone: string;
  riskProfile: "conservative" | "balanced" | "aggressive";
}
