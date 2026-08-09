import type { EnvironmentId } from "@t3tools/contracts";

import { derivePhysicalProjectKey } from "./logicalProject";
import type { SidebarProjectGroupMember, SidebarProjectSnapshot } from "./sidebarProjectGrouping";
import type { Project } from "./types";

export const GENERAL_CHATS_PROJECT_KEY = "general-chats";

export function buildGeneralChatsProjectSnapshot(input: {
  projects: ReadonlyArray<Project>;
  primaryEnvironmentId: EnvironmentId | null;
  resolveEnvironmentLabel: (environmentId: EnvironmentId) => string | null;
  isDesktopLocalEnvironment?: (environmentId: EnvironmentId) => boolean;
}): SidebarProjectSnapshot | null {
  if (input.projects.length === 0) {
    return null;
  }

  const members: SidebarProjectGroupMember[] = input.projects.map((project) => ({
    ...project,
    physicalProjectKey: derivePhysicalProjectKey(project),
    environmentLabel: input.resolveEnvironmentLabel(project.environmentId),
  }));
  const representative =
    members.find((project) => project.environmentId === input.primaryEnvironmentId) ?? members[0]!;
  const remoteMembers = members.filter(
    (project) =>
      input.primaryEnvironmentId !== null && project.environmentId !== input.primaryEnvironmentId,
  );
  const hasLocal = members.some((project) => project.environmentId === input.primaryEnvironmentId);
  const hasRemote = remoteMembers.length > 0;
  const isDesktopLocal = input.isDesktopLocalEnvironment ?? (() => false);

  return {
    ...representative,
    projectKey: GENERAL_CHATS_PROJECT_KEY,
    displayName: "General chats",
    groupedProjectCount: members.length,
    environmentPresence: hasLocal && hasRemote ? "mixed" : hasRemote ? "remote-only" : "local-only",
    allRemoteMembersAreDesktopLocal:
      remoteMembers.length > 0 &&
      remoteMembers.every((project) => isDesktopLocal(project.environmentId)),
    memberProjects: members,
    memberProjectRefs: members.map((project) => ({
      environmentId: project.environmentId,
      projectId: project.id,
    })),
    remoteEnvironmentLabels: remoteMembers
      .flatMap((project) => (project.environmentLabel ? [project.environmentLabel] : []))
      .filter((label, index, labels) => labels.indexOf(label) === index),
  };
}
