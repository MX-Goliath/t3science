import { type NavigationTab } from "./navigation-tab-order";
import { NativeStackScreenOptions } from "../../../native/StackHeader";
import { UsageRouteScreen } from "../../usage/UsageRouteScreen";

import { ImagesScreen } from "../../images/ImagesScreen";

export function WorkspaceExtraTab(props: { tab: Extract<NavigationTab, "usage" | "images"> }) {
  return (
    <>
      <NativeStackScreenOptions options={{ headerSearchBarOptions: undefined }} />
      {props.tab === "images" ? <ImagesScreen workspace /> : <UsageRouteScreen workspace />}
    </>
  );
}
