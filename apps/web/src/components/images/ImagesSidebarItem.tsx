import { ImagesIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { resetImageGallery } from "./imageGalleryNavigation";
import { imageLibraryCopy } from "./imageLibraryCopy";
import { useClientSettings } from "~/hooks/useSettings";

export function ImagesSidebarItem() {
  const navigate = useNavigate();
  const active = useLocation({ select: (location) => location.pathname === "/images" });
  const copy = imageLibraryCopy();
  const enabled = useClientSettings((settings) => settings.imagesEnabled);
  if (!enabled) return null;
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={active}
        onClick={() => {
          resetImageGallery();
          void navigate({ to: "/images" });
        }}
        aria-label={copy.images}
      >
        <ImagesIcon className="size-4 shrink-0" />
        <span className="truncate">{copy.images}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
