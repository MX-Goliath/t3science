import { useState } from "react";
import { FlatList, Pressable, View } from "react-native";
import { Image } from "expo-image";
import type { EnvironmentId, ImageLibraryEntry } from "@t3tools/contracts";
import { useEnvironmentQuery } from "../../state/query";
import { imageLibraryList } from "../../state/imageLibrary";
import { useAssetUrlState } from "../../state/assets";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { Button } from "../../components/ui/Button";
import { imageResource } from "./imageGalleryFiles";
import { imageLibraryCopy } from "./imageLibraryCopy";

function ImageTile(props: {
  environmentId: EnvironmentId;
  image: ImageLibraryEntry;
  onPress: () => void;
}) {
  const asset = useAssetUrlState(props.environmentId, imageResource(props.image));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.image.fileName}
      onPress={props.onPress}
      className="m-1 aspect-square flex-1 overflow-hidden rounded-xl bg-subtle"
      style={{ maxWidth: "33.333%" }}
    >
      {asset._tag === "Success" ? (
        <Image
          source={{ uri: asset.url }}
          recyclingKey={props.image.id}
          style={{ width: "100%", height: "100%" }}
          contentFit="cover"
        />
      ) : (
        <Text className="p-2 text-xs text-foreground-muted">
          {asset._tag === "Failure" ? "!" : "…"}
        </Text>
      )}
    </Pressable>
  );
}

export function ImageGalleryGrid(props: {
  environmentId: EnvironmentId;
  bottomInset: number;
  onSelect: (image: ImageLibraryEntry, siblings: readonly ImageLibraryEntry[]) => void;
  canOpenDirectory: boolean;
  onOpenDirectory: (path: string) => void;
  onBrowse: () => void;
}) {
  const [offset, setOffset] = useState(0);
  const query = useEnvironmentQuery(
    imageLibraryList({ environmentId: props.environmentId, input: { offset, limit: 60 } }),
  );
  const [pages, setPages] = useState<readonly ImageLibraryEntry[]>(query.data?.images ?? []);
  const [lastPage, setLastPage] = useState(query.data);
  if (query.data !== lastPage) {
    setLastPage(query.data);
    if (query.data) {
      const prior = offset === 0 ? [] : pages;
      const ids = new Set(prior.map((image) => image.id));
      setPages([...prior, ...query.data.images.filter((image) => !ids.has(image.id))]);
    }
  }
  const copy = imageLibraryCopy();
  return (
    <FlatList
      data={pages}
      keyExtractor={(image) => image.id}
      numColumns={3}
      initialNumToRender={12}
      windowSize={5}
      contentContainerStyle={{ padding: 8, paddingBottom: props.bottomInset }}
      keyboardDismissMode="on-drag"
      onScrollBeginDrag={props.onBrowse}
      refreshing={query.isPending && offset === 0}
      onRefresh={() => {
        setOffset(0);
        query.refresh();
      }}
      renderItem={({ item }) => (
        <ImageTile
          environmentId={props.environmentId}
          image={item}
          onPress={() => {
            props.onSelect(item, pages);
          }}
        />
      )}
      ListHeaderComponent={
        query.data?.directories.length ? (
          <View className="px-2 pb-2">
            <Menu
              accessibilityLabel={copy.directory}
              actions={query.data.directories.map((directory) => ({
                id: directory.path,
                title: directory.label,
                attributes: { disabled: !props.canOpenDirectory },
              }))}
              onPressAction={({ nativeEvent }) => props.onOpenDirectory(nativeEvent.event)}
            >
              <Button
                label={copy.directory}
                tone="secondary"
                disabled={!props.canOpenDirectory}
                onPress={() => {}}
              />
            </Menu>
          </View>
        ) : undefined
      }
      ListEmptyComponent={
        <View className="items-center gap-3 py-16">
          <Text className="text-center text-foreground-muted">
            {query.error ? copy.failed : query.isPending ? copy.loading : copy.empty}
          </Text>
          {query.error ? <Button label={copy.retry} onPress={query.refresh} /> : undefined}
        </View>
      }
      ListFooterComponent={
        query.data?.nextOffset !== null && query.data?.nextOffset !== undefined ? (
          <Button
            label={query.isPending ? copy.loading : copy.more}
            disabled={query.isPending}
            onPress={() => setOffset(query.data!.nextOffset!)}
          />
        ) : undefined
      }
    />
  );
}
