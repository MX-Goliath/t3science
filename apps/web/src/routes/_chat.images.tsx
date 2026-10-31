import { createFileRoute, Navigate } from "@tanstack/react-router";
import { ImagesPage } from "~/components/images/ImagesPage";
import { useClientSettings, useClientSettingsHydrated } from "~/hooks/useSettings";

export const Route = createFileRoute("/_chat/images")({ component: ImagesRoute });

function ImagesRoute() {
  const enabled = useClientSettings((settings) => settings.imagesEnabled);
  const hydrated = useClientSettingsHydrated();
  if (!hydrated) return null;
  return enabled ? <ImagesPage /> : <Navigate to="/settings/general" replace />;
}
