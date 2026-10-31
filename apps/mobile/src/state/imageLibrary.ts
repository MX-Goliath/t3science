import { WS_METHODS } from "@t3tools/contracts";
import { createEnvironmentRpcQueryAtomFamily } from "@t3tools/client-runtime/state/runtime";
import { connectionAtomRuntime } from "../connection/runtime";

export const imageLibraryList = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:images:list",
  tag: WS_METHODS.imagesList,
  staleTimeMs: 15_000,
  idleTtlMs: 60_000,
});
export const imageLibraryConversation = createEnvironmentRpcQueryAtomFamily(connectionAtomRuntime, {
  label: "environment-data:images:conversation",
  tag: WS_METHODS.imagesGetConversation,
  staleTimeMs: 30_000,
  idleTtlMs: 60_000,
});
