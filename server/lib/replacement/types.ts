/**
 * A request, attached to an issue, to throw away a bad movie or season and
 * fetch a different release of it.
 */
export type ReplacementStatus = 'pending' | 'completed' | 'failed' | 'declined';

export interface IssueReplacement {
  status: ReplacementStatus;
  requestedAt: string;
  /** Set once it is approved, declined or ran automatically. */
  decidedAt?: string;
  decidedBy?: { id: number; displayName: string };
  autoApproved?: boolean;
  /** Release names added to the Radarr/Sonarr blocklist. */
  blocklisted?: string[];
  deletedFiles?: number;
  /** Files with no download history (imported by hand), so not blocklisted. */
  notBlocklisted?: number;
  error?: string;
}

export interface ReplacementResult {
  blocklisted: string[];
  deletedFiles: number;
  notBlocklisted: number;
}
