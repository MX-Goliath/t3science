import { isReasoningSelect } from "@t3tools/client-runtime/model-traits";
import type { ProviderOptionDescriptor } from "@t3tools/contracts";
import { getProviderOptionCurrentValue } from "@t3tools/shared/model";

export function getReasoningAppearance(descriptors: readonly ProviderOptionDescriptor[]) {
  const ultracode = descriptors.find(
    (descriptor) =>
      descriptor.id === "ultracode" &&
      descriptor.type === "boolean" &&
      descriptor.currentValue === true,
  );
  const effort = getProviderOptionCurrentValue(
    descriptors.find((descriptor) => descriptor.type === "select" && isReasoningSelect(descriptor)),
  );
  return {
    ultra: Boolean(ultracode) || effort === "ultra" || effort === "ultracode",
    label: ultracode?.label,
  };
}
