import { ImagesIcon } from "lucide-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { resetImageGallery } from "./imageGalleryNavigation";
import { imageLibraryCopy } from "./imageLibraryCopy";

export function ImagesSidebarItem() {
  const navigate = useNavigate();
  const active = useLocation({ select: (location) => location.pathname === "/images" });
  const copy = imageLibraryCopy();
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
