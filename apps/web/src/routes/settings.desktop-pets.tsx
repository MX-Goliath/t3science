import { createFileRoute } from "@tanstack/react-router";

import { DesktopPetsSettings } from "../components/settings/DesktopPetsSettings";
import { SettingsPageContainer } from "../components/settings/settingsLayout";

function SettingsDesktopPetsRoute() {
  return (
    <SettingsPageContainer>
      <DesktopPetsSettings />
    </SettingsPageContainer>
  );
}

export const Route = createFileRoute("/settings/desktop-pets")({
  component: SettingsDesktopPetsRoute,
});
