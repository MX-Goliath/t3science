import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";
import { WorkflowsScreen } from "../../workflows/WorkflowsScreen";

import { ImagesScreen } from "../../images/ImagesScreen";

export function WorkspaceExtraTab(props: {
  tab: Extract<NavigationTab, "usage" | "images" | "workflows">;
}) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "images" ? (
        <ImagesScreen workspace />
      ) : props.tab === "workflows" ? (
        <WorkflowsScreen />
      ) : (
        <UsageRouteScreen workspace />
      )}
    </>
  );
}
