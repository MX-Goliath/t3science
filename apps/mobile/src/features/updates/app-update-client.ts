export interface AppUpdateClient {
  readonly isEnabled: boolean;
  readonly installOnNextLaunch?: boolean;
  readonly installPendingOnLaunch?: () => Promise<void>;
  readonly checkForUpdateAsync: () => Promise<{
    readonly isAvailable: boolean;
    readonly isRollBackToEmbedded: boolean;
  }>;
  readonly fetchUpdateAsync: () => Promise<{
    readonly isNew: boolean;
    readonly isRollBackToEmbedded: boolean;
  }>;
  readonly reloadAsync: () => Promise<void>;
}
