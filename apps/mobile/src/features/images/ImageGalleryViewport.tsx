import { useState } from "react";
import { View } from "react-native";
import { Image } from "expo-image";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";

const createPinch = Gesture.Pinch;
const createPan = Gesture.Pan;
const createTap = Gesture.Tap;
const combineGestures = Gesture.Simultaneous;

export function ImageGalleryViewport({ uri }: { uri: string }) {
  const [size, setSize] = useState({ width: 1, height: 1 });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const pinch = createPinch()
    .onUpdate((event) => {
      scale.set(Math.max(1, Math.min(4, savedScale.get() * event.scale)));
    })
    .onEnd(() => {
      savedScale.set(scale.get());
      x.set(
        withTiming(
          Math.max(
            (-size.width * (scale.get() - 1)) / 2,
            Math.min((size.width * (scale.get() - 1)) / 2, x.get()),
          ),
        ),
      );
      y.set(
        withTiming(
          Math.max(
            (-size.height * (scale.get() - 1)) / 2,
            Math.min((size.height * (scale.get() - 1)) / 2, y.get()),
          ),
        ),
      );
    });
  const pan = createPan()
    .maxPointers(1)
    .onStart(() => {
      startX.set(x.get());
      startY.set(y.get());
    })
    .onUpdate((event) => {
      x.set(
        Math.max(
          (-size.width * (scale.get() - 1)) / 2,
          Math.min((size.width * (scale.get() - 1)) / 2, startX.get() + event.translationX),
        ),
      );
      y.set(
        Math.max(
          (-size.height * (scale.get() - 1)) / 2,
          Math.min((size.height * (scale.get() - 1)) / 2, startY.get() + event.translationY),
        ),
      );
    });
  const doubleTap = createTap()
    .numberOfTaps(2)
    .onEnd(() => {
      const next = scale.get() > 1 ? 1 : 2;
      scale.set(withTiming(next));
      savedScale.set(next);
      x.set(withTiming(0));
      y.set(withTiming(0));
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() }, { translateY: y.get() }, { scale: scale.get() }],
  }));
  return (
    <View
      className="flex-1 overflow-hidden"
      onLayout={(event) => setSize(event.nativeEvent.layout)}
    >
      <GestureDetector gesture={combineGestures(pinch, pan, doubleTap)}>
        <Animated.View style={[{ flex: 1 }, style]}>
          <Image source={{ uri }} style={{ width: "100%", height: "100%" }} contentFit="contain" />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
