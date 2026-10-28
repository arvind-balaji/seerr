/**
 * Library cleanup: titles nobody watches are announced in Leaving Soon, then
 * removed through Radarr/Sonarr unless someone keeps them.
 */

export type CleanupState = 'leaving' | 'kept' | 'protected' | 'removed';

/** Why a title qualified for removal, captured when it was marked. */
export interface CleanupReason {
  /** Last time anyone played it, per Tautulli; absent if never. */
  lastWatchedAt?: string;
  addedAt?: string;
  sizeBytes: number;
  year?: number;
}

/** Stored on Media.cleanup. */
export interface MediaCleanup {
  state: CleanupState;
  /** When the title entered this state. */
  since: string;
  /** leaving: when it will be removed. */
  removeAt?: string;
  /** kept: when the protection ends. */
  keptUntil?: string;
  /** User who kept or protected it. */
  userId?: number;
  reason?: CleanupReason;
}

export interface CleanupCandidate {
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  reason: CleanupReason;
}

export interface DiskUsage {
  path: string;
  usedPercent?: number;
  totalBytes?: number;
  freeBytes?: number;
  error?: string;
}

/** Outcome of the last run, shown on the cleanup page. */
export interface CleanupRunSummary {
  at: string;
  mode: 'preview' | 'live';
  disk: DiskUsage;
  marked: number;
  removed: number;
  released: number;
  errors: string[];
  /** In preview mode, what a live run would have marked. */
  wouldMark?: CleanupCandidate[];
}

export type CleanupAction = 'keep' | 'unkeep' | 'protect' | 'unprotect';

export interface CleanupItem {
  mediaId: number;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year?: number;
  posterPath?: string;
  backdropPath?: string;
  cleanup?: MediaCleanup | null;
  /** Requesters of the title, for managers. */
  requestedBy?: { id: number; displayName: string }[];
  /** Next-in-line only: why it qualifies. */
  candidate?: CleanupCandidate;
}

export interface CleanupResponse {
  mode: 'off' | 'preview' | 'live';
  graceDays: number;
  keepDays: number;
  maxKeepsPerUser: number;
  /** Active keeps by the current user. */
  myKeeps: number;
  leaving: CleanupItem[];
  /** Request managers only from here on. */
  manager?: {
    disk: DiskUsage;
    maxUsedPercent: number;
    lastRun?: CleanupRunSummary;
    nextInLine: CleanupItem[];
    nextInLineError?: string;
    kept: CleanupItem[];
    protected: CleanupItem[];
    removed: CleanupItem[];
  };
}
