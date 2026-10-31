import { ArrowLeftIcon } from "lucide-react";
import { useEnvironmentQuery } from "~/state/query";
import { imageLibraryConversation } from "~/state/imageLibrary";
import { useAssetUrlState } from "~/assets/assetUrls";
import { Button } from "../ui/button";
import type { GalleryImage } from "./imageGalleryTypes";
import { imageLibraryCopy } from "./imageLibraryCopy";

export function ImageSourceConversation({
  image,
  onBack,
}: {
  image: GalleryImage;
  onBack: () => void;
}) {
  const query = useEnvironmentQuery(
    imageLibraryConversation({ environmentId: image.environmentId, input: { id: image.id } }),
  );
  const asset = useAssetUrlState(image.environmentId, {
    _tag: "draft-workspace-file",
    cwd: image.directory,
    path: image.fileName,
  });
  const copy = imageLibraryCopy();
  return (
    <div
      data-image-gallery-scroll
      className="min-h-0 flex-1 overflow-y-auto px-6 pb-(--image-gallery-composer-space) scrollbar-gutter-both"
    >
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeftIcon />
        {copy.back}
      </Button>
      <h2 className="my-4 text-lg font-semibold">{copy.original}</h2>
      {query.data === null ? (
        <p role="status">{query.error ? copy.failed : copy.loading}</p>
      ) : query.data.messages.length === 0 ? (
        <p>{copy.noConversation}</p>
      ) : (
        query.data.messages.map((message, index) => (
          <div
            key={`${message.role}:${message.createdAt}:${message.text}`}
            ref={
              index === query.data!.imageMessageIndex
                ? (element) => element?.scrollIntoView({ block: "center" })
                : undefined
            }
            className={`mx-auto mb-5 max-w-3xl whitespace-pre-wrap rounded-xl p-4 ${message.role === "user" ? "bg-muted" : ""}`}
          >
            <p>{message.text}</p>
            {index === query.data!.imageMessageIndex && asset._tag === "Success" ? (
              <img
                src={asset.url}
                alt={image.fileName}
                className="mt-4 max-h-96 max-w-full rounded-lg object-contain"
                onLoad={(event) =>
                  event.currentTarget.parentElement?.scrollIntoView({ block: "center" })
                }
              />
            ) : null}
          </div>
        ))
      )}
    </div>
  );
}
