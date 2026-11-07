import { createFileRoute } from "@tanstack/react-router";
import { ScienceSettingsPanel } from "../components/settings/ScienceSettingsPanel";

export const Route = createFileRoute("/_chat/settings/science")({
  component: ScienceSettingsPanel,
});
