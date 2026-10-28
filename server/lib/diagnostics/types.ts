/**
 * Why a requested item hasn't arrived yet. Stored on Media (diagnosis /
 * diagnosis4k) and refreshed by the request-diagnostics job.
 */
export enum DiagnosisCategory {
  /** Approved in Seerr, but Radarr/Sonarr never received it. */
  NOT_SENT = 'not_sent',
  /** Radarr/Sonarr has it, but it is unmonitored, so nothing will be grabbed. */
  NOT_MONITORED = 'not_monitored',
  /** Not released yet (movie not available, or episodes not aired). */
  NOT_RELEASED = 'not_released',
  /** In the download queue. */
  DOWNLOADING = 'downloading',
  /** Downloaded, but Radarr/Sonarr can't import it. */
  IMPORT_PROBLEM = 'import_problem',
  /** Known to Radarr/Sonarr, but no indexer search has been checked yet. */
  PENDING_CHECK = 'pending_check',
  /** At least one release meets the profile, so a search should grab it. */
  READY_TO_GRAB = 'ready_to_grab',
  /** No release for this title on any indexer. */
  NO_RESULTS = 'no_results',
  /** Releases exist, but only below the quality profile (quality or size). */
  QUALITY_UNMET = 'quality_unmet',
  /** Releases exist, but only in languages the profile doesn't accept. */
  LANGUAGE_UNMET = 'language_unmet',
  /** Releases exist, but are rejected for other reasons (seeders, blocklist...). */
  OTHER_REJECTED = 'other_rejected',
  /** Downloaded and imported; waiting for the media server to scan it. */
  AWAITING_SCAN = 'awaiting_scan',
  /** Everything requested is downloaded; only unrequested seasons are missing. */
  FULFILLED = 'fulfilled',
  /** Radarr/Sonarr couldn't be reached. */
  SERVICE_ERROR = 'service_error',
}

export type DiagnosisAction = 'search' | 'lower_quality' | 'any_language';

/** A rejected release that would be grabbed if the user relaxed the profile. */
export interface DiagnosisAlternative {
  quality: string;
  size: number;
  languages: string[];
  /** Release title. Stripped for users without MANAGE_REQUESTS (see strip.ts). */
  title?: string;
  seeders?: number;
  protocol?: string;
}

export interface DiagnosisSearchSummary {
  /** Releases that belong to this title (other titles' results are dropped). */
  results: number;
  acceptable: number;
  qualityOnly: number;
  languageOnly: number;
  other: number;
  /** Torrents with no seeders: listed, but can't be downloaded. */
  dead?: number;
  /** Rejection reasons with counts, most common first (admin detail). */
  topReasons: { reason: string; count: number }[];
  /** Qualities found among this title's releases, best first. */
  qualitiesFound: string[];
  languagesFound: string[];
  bestAlternative?: DiagnosisAlternative;
  /** Releases acceptable to the profile but held back (e.g. not released yet). */
  heldBack?: number;
}

export interface SeasonDiagnosis {
  seasonNumber: number;
  episodes: number;
  aired: number;
  downloaded: number;
  nextAirDate?: string;
  category: DiagnosisCategory;
  search?: DiagnosisSearchSummary;
}

export interface DiagnosisActionLog {
  action: DiagnosisAction;
  userId: number;
  at: string;
  /** Profile the item was on before a fallback was applied, for undo. */
  previousProfileId?: number;
}

export interface Diagnosis {
  category: DiagnosisCategory;
  checkedAt: string;
  /** Last time an indexer search was inspected. */
  searchedAt?: string;
  nextSearchAt?: string;
  /** Consecutive searches that found nothing usable (drives backoff). */
  failedSearches: number;
  /** Expected release / next air date, when known. */
  expectedDate?: string;
  /** What the expected date refers to. */
  expectedDateType?: 'cinema' | 'digital' | 'physical' | 'air';
  /** Free-text detail from Radarr/Sonarr (import errors, service errors). */
  message?: string;
  search?: DiagnosisSearchSummary;
  seasons?: SeasonDiagnosis[];
  actions?: DiagnosisActionLog[];
}

/** What the current user may do about a diagnosis (computed per request). */
export interface DiagnosisActionState {
  allowed: boolean;
  /** When a rate-limited action becomes available again. */
  availableAt?: string;
  /** Why it isn't allowed, for display. */
  reason?: 'not_configured' | 'rate_limited' | 'no_permission' | 'not_needed';
}

export interface DiagnosisResponse {
  diagnosis: Diagnosis | null;
  canRefresh: boolean;
  isManager: boolean;
  actions: Record<DiagnosisAction, DiagnosisActionState>;
  /** Names of the fallback profiles, so the UI can say what changes. */
  fallbackProfiles: { lowerQuality?: string; anyLanguage?: string };
  /** Shows a profile change affects the whole series, not one season. */
  mediaType: 'movie' | 'tv';
}
