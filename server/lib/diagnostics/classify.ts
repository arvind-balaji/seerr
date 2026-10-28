import type {
  DiagnosisAlternative,
  DiagnosisSearchSummary,
} from '@server/lib/diagnostics/types';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';

/**
 * The parts of a Radarr/Sonarr `GET /release` result we use. Rejections are
 * English messages: the *arr APIs don't expose their internal reason codes,
 * so they're grouped by pattern below.
 */
export interface ServarrRelease {
  title: string;
  size: number;
  approved: boolean;
  temporarilyRejected?: boolean;
  rejections: string[];
  quality: { quality: { name: string; resolution?: number } };
  qualityWeight?: number;
  languages?: { name: string }[];
  seeders?: number | null;
  protocol?: string;
  /** Sonarr: the release covers the whole season. */
  fullSeason?: boolean;
  seasonNumber?: number;
}

type RejectionKind =
  | 'other_title'
  | 'existing'
  | 'dead'
  | 'quality'
  | 'language'
  | 'held'
  | 'other';

const PATTERNS: [RejectionKind, RegExp][] = [
  // Results for a different title, or that can't be parsed: not ours.
  [
    'other_title',
    /Unknown (Movie|Series|Season)|Wrong (movie|season|episode)|Episode wasn't requested|Unable to (parse|identify)|matches an alias for series|Multi-season releases|not (a|the) requested/i,
  ],
  // About the file already on disk; irrelevant for a missing title.
  [
    'existing',
    /Existing file|does not allow upgrades|is not an upgrade|equal or higher (preference|revision|Custom Format)|Custom Format cutoff|already meets cutoff/i,
  ],
  // A torrent nobody seeds can't be downloaded, so it's as good as absent.
  ['dead', /Not enough seeders/i],
  ['language', /is wanted, but found|language/i],
  [
    'quality',
    /not wanted in profile|smaller than minimum|larger than maximum|below .*profile minimum|Custom Formats? .*score/i,
  ],
  // Acceptable, but waiting on availability or a delay profile.
  [
    'held',
    /not (yet )?available|will (only )?be (considered )?(available|released)|delay|is not released/i,
  ],
];

export const classifyRejection = (message: string): RejectionKind =>
  PATTERNS.find(([, re]) => re.test(message))?.[0] ?? 'other';

/** Normalises a message for grouping: drops sizes, numbers and "(for Title)". */
const reasonKey = (message: string) =>
  message
    .replace(/\s*\(for .*\)\s*$/, '')
    .replace(/[\d.,]+\s*[KMGT]i?B/g, 'N')
    .replace(/(seeders|Seeders):\s*\d+/g, '$1: N')
    .trim();

const SIZE_REJECTION = /smaller than minimum|larger than maximum/i;

/**
 * Real copies first: a "1080p" release rejected for being 200 MB is usually
 * fake or broken, so it ranks below a genuine lower-quality copy.
 */
const bestFirst = (a: ServarrRelease, b: ServarrRelease) =>
  Number(a.rejections.some((r) => SIZE_REJECTION.test(r))) -
    Number(b.rejections.some((r) => SIZE_REJECTION.test(r))) ||
  (b.qualityWeight ?? 0) - (a.qualityWeight ?? 0) ||
  (b.seeders ?? 0) - (a.seeders ?? 0) ||
  b.size - a.size;

const toAlternative = (r: ServarrRelease): DiagnosisAlternative => ({
  quality: r.quality.quality.name,
  size: r.size,
  languages: (r.languages ?? []).map((l) => l.name),
  title: r.title,
  seeders: r.seeders ?? undefined,
  protocol: r.protocol,
});

export interface ClassifiedSearch {
  category: DiagnosisCategory;
  summary: DiagnosisSearchSummary;
}

/**
 * Sorts a title's search results into what's grabbable, what's blocked only by
 * quality or only by language, and everything else, then picks the category
 * that best explains why nothing has been grabbed.
 */
export const classifyReleases = (
  releases: ServarrRelease[],
  { released = true }: { released?: boolean } = {}
): ClassifiedSearch => {
  const reasonCounts = new Map<string, number>();
  const qualities = new Map<string, number>();
  const languages = new Set<string>();
  const qualityOnly: ServarrRelease[] = [];
  const languageOnly: ServarrRelease[] = [];
  /** Wrong language and below the quality profile. */
  const languageAndQuality: ServarrRelease[] = [];
  let results = 0;
  let acceptable = 0;
  let heldBack = 0;
  let dead = 0;
  let other = 0;

  for (const release of releases) {
    const kinds = release.rejections.map(classifyRejection);
    if (kinds.includes('other_title')) continue;
    if (kinds.includes('dead')) {
      dead++;
      continue;
    }
    results++;
    const name = release.quality.quality.name;
    qualities.set(
      name,
      Math.max(qualities.get(name) ?? 0, release.qualityWeight ?? 0)
    );
    (release.languages ?? []).forEach((l) => languages.add(l.name));

    const blocking = new Set(
      kinds.filter((k) => k !== 'existing' && k !== 'held')
    );
    for (const message of release.rejections) {
      const kind = classifyRejection(message);
      if (kind === 'existing') continue;
      const key = reasonKey(message);
      reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
    }

    if (blocking.size === 0) {
      if (kinds.includes('held') || release.temporarilyRejected) heldBack++;
      else acceptable++;
    } else if (blocking.size === 1 && blocking.has('quality')) {
      qualityOnly.push(release);
    } else if (blocking.size === 1 && blocking.has('language')) {
      languageOnly.push(release);
    } else if (
      blocking.size === 2 &&
      blocking.has('language') &&
      blocking.has('quality')
    ) {
      languageAndQuality.push(release);
    } else {
      other++;
    }
  }

  let category: DiagnosisCategory;
  let alternatives: ServarrRelease[] = [];
  if (!released) {
    category = DiagnosisCategory.NOT_RELEASED;
  } else if (acceptable > 0) {
    category = DiagnosisCategory.READY_TO_GRAB;
  } else if (results === 0) {
    category = DiagnosisCategory.NO_RESULTS;
  } else if (
    // Copies rejected only for size are usually fakes or samples, and size
    // limits apply to every profile, so a fallback profile wouldn't help.
    qualityOnly.some((r) => !r.rejections.some((m) => SIZE_REJECTION.test(m)))
  ) {
    category = DiagnosisCategory.QUALITY_UNMET;
    alternatives = qualityOnly;
  } else if (languageOnly.length > 0 || languageAndQuality.length > 0) {
    // Language is the first thing to relax; quality may also fall short.
    category = DiagnosisCategory.LANGUAGE_UNMET;
    alternatives = languageOnly.length ? languageOnly : languageAndQuality;
  } else if (heldBack > 0) {
    // Acceptable, but held by a delay profile or availability rule.
    category = DiagnosisCategory.READY_TO_GRAB;
  } else {
    category = DiagnosisCategory.OTHER_REJECTED;
  }

  const best = [...alternatives].sort(bestFirst)[0];

  return {
    category,
    summary: {
      results,
      acceptable: acceptable + (released ? 0 : heldBack),
      qualityOnly: qualityOnly.length,
      languageOnly: languageOnly.length + languageAndQuality.length,
      other,
      dead: dead || undefined,
      heldBack: heldBack || undefined,
      topReasons: [...reasonCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([reason, count]) => ({ reason, count })),
      qualitiesFound: [...qualities.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name),
      languagesFound: [...languages],
      bestAlternative: best ? toAlternative(best) : undefined,
    },
  };
};
