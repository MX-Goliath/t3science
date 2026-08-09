import { EnvironmentId, GENERAL_CHATS_PROJECT_ID } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildGeneralChatsProjectSnapshot, GENERAL_CHATS_PROJECT_KEY } from "./generalChats";
import type { Project } from "./types";

function makeGeneralProject(environmentId: EnvironmentId, workspaceRoot: string): Project {
  return {
    environmentId,
    id: GENERAL_CHATS_PROJECT_ID,
    title: "General chats",
    workspaceRoot,
    defaultModelSelection: null,
    defaultThreadEnvMode: null,
    faviconPath: null,
    scripts: [],
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
  };
}

describe("buildGeneralChatsProjectSnapshot", () => {
  it("merges the reserved containers from every environment into one sidebar section", () => {
    const primaryEnvironmentId = EnvironmentId.make("primary");
    const remoteEnvironmentId = EnvironmentId.make("remote");
    const snapshot = buildGeneralChatsProjectSnapshot({
      projects: [
        makeGeneralProject(remoteEnvironmentId, "/remote/general-chats"),
        makeGeneralProject(primaryEnvironmentId, "/local/general-chats"),
      ],
      primaryEnvironmentId,
      resolveEnvironmentLabel: (environmentId) =>
        environmentId === remoteEnvironmentId ? "Remote" : "Local",
    });

    expect(snapshot?.projectKey).toBe(GENERAL_CHATS_PROJECT_KEY);
    expect(snapshot?.environmentId).toBe(primaryEnvironmentId);
    expect(snapshot?.displayName).toBe("General chats");
    expect(snapshot?.environmentPresence).toBe("mixed");
    expect(snapshot?.memberProjectRefs).toEqual([
      { environmentId: remoteEnvironmentId, projectId: GENERAL_CHATS_PROJECT_ID },
      { environmentId: primaryEnvironmentId, projectId: GENERAL_CHATS_PROJECT_ID },
    ]);
  });

  it("returns null until an environment advertises its general chats container", () => {
    expect(
      buildGeneralChatsProjectSnapshot({
        projects: [],
        primaryEnvironmentId: null,
        resolveEnvironmentLabel: () => null,
      }),
    ).toBeNull();
  });
});
