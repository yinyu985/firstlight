export type SyncDecision = "idle" | "upload" | "restore" | "adopt" | "conflict";

export function decideSync(localHash: string, remoteHash: string, baselineHash: string): SyncDecision {
  const localChanged = localHash !== baselineHash;
  const remoteChanged = remoteHash !== baselineHash;
  if (!localChanged && !remoteChanged) return "idle";
  if (localChanged && !remoteChanged) return "upload";
  if (!localChanged && remoteChanged) return "restore";
  if (localHash === remoteHash) return "adopt";
  return "conflict";
}

export function decideSyncWithRevision(
  localHash: string,
  remoteHash: string,
  baselineHash: string,
  baselineRemoteUpdatedAt: string,
  remoteUpdatedAt: string
): SyncDecision {
  if (remoteUpdatedAt === baselineRemoteUpdatedAt) {
    return localHash === remoteHash ? "adopt" : "upload";
  }
  return decideSync(localHash, remoteHash, baselineHash);
}

export function canAutoUpload(enabled: boolean | undefined, token: string | undefined, gistId: string | undefined, restoring: boolean): boolean {
  return Boolean(enabled && token && gistId && !restoring);
}
