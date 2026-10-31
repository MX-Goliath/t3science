import { useState } from "react";
import { FolderOpenIcon, RefreshCwIcon } from "lucide-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEnvironmentQuery } from "~/state/query";
import { imageLibraryList } from "~/state/imageLibrary";
import { useAssetUrlState } from "~/assets/assetUrls";
import { useAtomCommand } from "~/state/use-atom-command";
import { shellEnvironment } from "~/state/shell";
import { Button } from "../ui/button";
import type { GalleryImage, ImageSelection } from "./imageGalleryTypes";
import { imageLibraryCopy } from "./imageLibraryCopy";

export function ImagesGrid(props: {
  environmentId: EnvironmentId;
  label: string | null;
  onSelect: (selection: ImageSelection) => void;
}) {
  const [offsets, setOffsets] = useState([0]);
  return (
    <section className="pb-6">
      {props.label ? (
        <h2 className="pb-3 text-sm font-medium text-muted-foreground">{props.label}</h2>
      ) : null}
      {offsets.map((offset, index) => (
        <ImagePageChunk
          key={offset}
          environmentId={props.environmentId}
          offset={offset}
          first={index === 0}
          last={index === offsets.length - 1}
          onMore={(next) =>
            setOffsets((previous) => (previous.includes(next) ? previous : [...previous, next]))
          }
          onSelect={props.onSelect}
        />
      ))}
    </section>
  );
}

function ImagePageChunk(props: {
  environmentId: EnvironmentId;
  offset: number;
  first: boolean;
  last: boolean;
  onMore: (offset: number) => void;
  onSelect: (selection: ImageSelection) => void;
}) {
  const query = useEnvironmentQuery(
    imageLibraryList({
      environmentId: props.environmentId,
      input: { offset: props.offset, limit: 60 },
    }),
  );
  const openDirectory = useAtomCommand(shellEnvironment.openInEditor, "open image directory");
  const copy = imageLibraryCopy();
  const images =
    query.data?.images.map((image) => ({ ...image, environmentId: props.environmentId })) ?? [];
  return (
    <>
      {props.first ? (
        <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
          {query.data?.directories.map((directory) => (
            <Button
              key={directory.path}
              size="sm"
              variant="outline"
              title={directory.path}
              onClick={() =>
                void openDirectory({
                  environmentId: props.environmentId,
                  input: { cwd: directory.path, editor: "file-manager" },
                })
              }
            >
              <FolderOpenIcon />
              {copy.directory}
              {query.data!.directories.length > 1 ? ` · ${directory.label}` : ""}
            </Button>
          ))}
          <Button size="icon-sm" variant="ghost" aria-label={copy.refresh} onClick={query.refresh}>
            <RefreshCwIcon />
          </Button>
        </div>
      ) : null}
      {query.error ? (
        <div role="alert" className="flex items-center justify-center gap-3 py-8">
          <span>{copy.failed}</span>
          <Button variant="outline" size="sm" onClick={query.refresh}>
            {copy.retry}
          </Button>
        </div>
      ) : query.data === null ? (
        <p role="status" className="py-12 text-center text-muted-foreground">
          {copy.loading}
        </p>
      ) : images.length === 0 && props.first ? (
        <p className="py-16 text-center text-muted-foreground">{copy.empty}</p>
      ) : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 pb-3 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
        {images.map((image) => (
          <ImageTile
            key={image.id}
            image={image}
            onSelect={() => props.onSelect({ image, siblings: images })}
          />
        ))}
      </div>
      {props.last && query.data?.nextOffset != null ? (
        <div className="flex justify-center py-4">
          <Button variant="outline" onClick={() => props.onMore(query.data!.nextOffset!)}>
            {copy.more}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function ImageTile({ image, onSelect }: { image: GalleryImage; onSelect: () => void }) {
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const asset = useAssetUrlState(
    image.environmentId,
    visible ? { _tag: "draft-workspace-file", cwd: image.directory, path: image.fileName } : null,
  );
  const observe = (element: HTMLButtonElement) => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  };
  return (
    <button
      ref={observe}
      type="button"
      onClick={onSelect}
      aria-label={image.fileName}
      className="relative aspect-square cursor-pointer overflow-hidden rounded-xl bg-muted outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      {asset._tag === "Success" && !failed ? (
        <img
          src={asset.url}
          alt={image.fileName}
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex size-full items-center justify-center p-3 text-xs text-muted-foreground">
          {failed || asset._tag === "Failure"
            ? imageLibraryCopy().failed
            : imageLibraryCopy().loading}
        </span>
      )}
    </button>
  );
}
