import { useState } from "react";
import { useEnvironments, usePrimaryEnvironmentId } from "~/state/environments";
import { isElectron } from "~/env";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ImagesGrid } from "./ImagesGrid";
import { ImageViewer } from "./ImageViewer";
import { ImageGalleryComposer } from "./ImageGalleryComposer";
import type { ImageSelection } from "./imageGalleryTypes";
import { useImageGallerySelection } from "./imageGalleryNavigation";
import { imageLibraryCopy } from "./imageLibraryCopy";

export function ImagesPage() {
  const { environments } = useEnvironments();
  const primary = usePrimaryEnvironmentId();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const { selection, select: setImageSelection } = useImageGallerySelection();
  const [showConversation, setShowConversation] = useState(false);
  const [composerAttempt, setComposerAttempt] = useState(0);
  const copy = imageLibraryCopy();
  const environmentId =
    selection?.image.environmentId ??
    connected.find((entry) => entry.environmentId === primary)?.environmentId ??
    connected[0]?.environmentId ??
    null;
  const select = (next: ImageSelection | null) => {
    setImageSelection(next);
    setShowConversation(false);
  };
  const content =
    selection === null ? (
      <div className="flex min-h-0 flex-1 flex-col">
        <WorkspacePageHeader electron={isElectron}>
          <h1 className="text-lg font-semibold">{copy.title}</h1>
        </WorkspacePageHeader>
        <div
          data-image-gallery-scroll
          className="min-h-0 flex-1 overflow-y-auto px-4 pb-(--image-gallery-composer-space) sm:px-6"
        >
          {connected.length === 0 ? (
            <p className="py-12 text-center text-muted-foreground">{copy.noEnvironment}</p>
          ) : (
            connected.map((environment) => (
              <ImagesGrid
                key={environment.environmentId}
                environmentId={environment.environmentId}
                label={connected.length > 1 ? environment.label : null}
                onSelect={select}
              />
            ))
          )}
        </div>
      </div>
    ) : (
      <ImageViewer
        selection={selection}
        onSelect={select}
        showConversation={showConversation}
        onShowConversation={() => setShowConversation(true)}
        onHideConversation={() => setShowConversation(false)}
      />
    );
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      {environmentId === null ? (
        content
      ) : (
        <ImageGalleryComposer
          key={`${environmentId}:${selection?.image.id ?? "new"}:${composerAttempt}`}
          environmentId={environmentId}
          image={selection?.image ?? null}
          content={content}
          onRetry={() => setComposerAttempt((attempt) => attempt + 1)}
        />
      )}
    </SidebarInset>
  );
}
