/** Permissions stay visible; composer.mode has one target across the chip, picker and overflow. */
export function resolveComposerControlsOwnership(input: {
  /** Non-default permissions show their label when there is room. */
  readonly matchesDefault: boolean;
  readonly planModeUiEnabled: boolean;
  readonly collapsed: boolean;
  /** How many trailing blocks the width measurement moved into the overflow menu. */
  readonly measuredHiddenBlockCount: number;
}) {
  const accessDisplay = input.matchesDefault
    ? ("icon" as const)
    : input.collapsed
      ? ("icon" as const)
      : ("label" as const);
  const showModeBlock = true;
  const modeHidden = showModeBlock && input.measuredHiddenBlockCount > 0;
  const hiddenBlockIds = modeHidden ? (["mode"] as const) : ([] as const);
  // An overflowed chip needs a home for Permissions only when the Plan toggle is not there to fill
  // the overflow menu; otherwise Permissions stay in the model picker.
  const overflowShowsPermissions = modeHidden && !input.planModeUiEnabled;
  return {
    accessDisplay,
    showModeBlock,
    hiddenBlockCount: hiddenBlockIds.length,
    hiddenBlockIds,
    overflowShowsPermissions,
    /** Without a visible chip or an overflow menu holding it, the model picker answers composer.mode. */
    pickerOwnsModeShortcut: !overflowShowsPermissions && modeHidden,
  };
}
