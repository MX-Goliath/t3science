import * as Schema from "effect/Schema";

/**
 * Who an install belongs to, from strongest to weakest. `connect` is the T3
 * Connect account. `openai` and `claude` are provider accounts. `device` is a
 * client device that connected.
 */
export const TelemetryOwnerSource = Schema.Literals(["connect", "openai", "claude", "device"]);
export type TelemetryOwnerSource = typeof TelemetryOwnerSource.Type;

export interface TelemetryOwner {
  readonly source: TelemetryOwnerSource;
  /** `hashTelemetryId` of the source's raw id. */
  readonly ownerId: string;
}
