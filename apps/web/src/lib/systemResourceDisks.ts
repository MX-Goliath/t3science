export function systemResourceDiskName(mountPath: string): string {
  return mountPath.split("/").at(-1) || "/";
}
