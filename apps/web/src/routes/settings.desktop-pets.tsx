import { createFileRoute } from "@tanstack/react-router";

import { DesktopPetsSettingsPanel } from "../components/settings/SettingsPanels";

function SettingsDesktopPetsRoute() {
  return <DesktopPetsSettingsPanel />;
}

export const Route = createFileRoute("/settings/desktop-pets")({
  component: SettingsDesktopPetsRoute,
});
