import defineMessages from '@app/utils/defineMessages';
import type { Diagnosis } from '@server/lib/diagnostics/types';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';
import type { IntlShape } from 'react-intl';

export const messages = defineMessages('components.RequestDiagnosis', {
  // Short badge labels
  soon: 'soon',
  badgeReleases: 'Releases {date}',
  badgeInCinemas: 'In Cinemas',
  badgeNotReleased: 'Not Released',
  badgeNextEpisode: 'Next Episode {date}',
  badgePremieres: 'Premieres {date}',
  badgeSearching: 'Searching',
  badgeNotFound: 'Not Found Yet',
  badgeLowerQuality: 'Only Lower Quality',
  badgeOtherLanguages: 'Other Languages Only',
  badgeNeedsAdmin: 'Needs Admin',
  badgeAlmostReady: 'Almost Ready',
  // Headlines
  headNotReleased: 'Not released yet',
  headCaughtUp: "You're caught up",
  headNotAired: 'Not aired yet',
  headPending: 'Looking for a copy',
  headReady: 'Copy found',
  headNoResults: 'No copies found yet',
  headQuality: 'Only lower quality available',
  headLanguage: 'Only other languages available',
  headOther: 'No usable copies right now',
  headDownloading: 'Downloading',
  headImport: 'Download needs attention',
  headNotSent: 'Request not sent',
  headNotMonitored: 'Request paused',
  headServiceError: "Can't check right now",
  headAwaitingScan: 'Almost ready',
  // Explanations
  bodyInCinemas:
    "It's only in cinemas so far. It will download automatically once it's released digitally{hasDate, select, true { (expected {date})} other {}}.",
  bodyNotReleasedDate:
    "It isn't out yet. It will download automatically when it's released on {date}.",
  bodyNotReleased:
    "It isn't out yet and there's no release date. It will download automatically once it's released.",
  bodyHeldBack:
    'A copy is already listed and will be grabbed as soon as it counts as released.',
  bodyCaughtUp:
    'Every episode that has aired is downloaded.{hasDate, select, true { The next one airs {date}.} other {}}',
  bodyNotAired:
    "It hasn't aired yet.{hasDate, select, true { It premieres {date}.} other {}} Episodes download automatically as they air.",
  bodyPending:
    "It's been sent to {arr}, which is searching for a copy. We'll check on it {next}.",
  bodyReady:
    'A copy that meets the quality settings is available, and a download has been requested.',
  bodyReadyNotYet:
    'A copy that meets the quality settings is available. It will be grabbed on the next automatic check, or use Search Again to grab it now.',
  bodyNoResults:
    "None of the sources have a copy yet. That's common for older, regional or very new titles. We check again automatically, next {next}.",
  bodyDead:
    '{count, plural, one {# listed copy has} other {# listed copies have}} no one sharing {count, plural, one {it} other {them}}, so {count, plural, one {it} other {they}} can’t be downloaded.',
  bodyQuality:
    'We found {count, plural, one {# copy} other {# copies}}, but none meet the quality settings. The best is {quality} ({size}).',
  bodyLanguage:
    'We found {count, plural, one {# copy} other {# copies}}, but only in {languages}.',
  bodyOther:
    "We found {count, plural, one {# copy} other {# copies}}, but none are usable: too small to be genuine, no one sharing them, or blocked. We'll keep checking, next {next}.",
  bodyDownloading: "It's downloading now.",
  bodyImport:
    'It downloaded, but couldn’t be added to the library. An admin needs to look at it.',
  bodyNotSent: "This request didn't reach {arr}. An admin needs to look at it.",
  bodyNotMonitored:
    "{arr} isn't watching for this title, so it won't download. An admin needs to turn it back on.",
  bodyServiceError: "{arr} couldn't be reached. Try again later.",
  bodyAwaitingScan:
    "It's downloaded and will show up in {mediaServer} shortly.",
});

export type BadgeType = 'primary' | 'warning' | 'danger' | 'success';

const shortDate = (intl: IntlShape, iso?: string) =>
  iso
    ? intl.formatDate(iso, {
        // Release and air dates are calendar dates stored as midnight UTC.
        timeZone: 'UTC',
        month: 'short',
        day: 'numeric',
        ...(new Date(iso).getFullYear() !== new Date().getFullYear() && {
          year: 'numeric',
        }),
      })
    : undefined;

/** Badge text and colour for a diagnosis, or undefined to keep "Requested". */
export const diagnosisBadge = (
  intl: IntlShape,
  diagnosis: Diagnosis | null | undefined,
  mediaType?: 'movie' | 'tv'
): { label: string; badgeType: BadgeType } | undefined => {
  if (!diagnosis) return undefined;
  const date = shortDate(intl, diagnosis.expectedDate);
  const label = (m: keyof typeof messages, values = {}) =>
    intl.formatMessage(messages[m], values);

  switch (diagnosis.category) {
    case DiagnosisCategory.NOT_RELEASED: {
      if (mediaType === 'tv') {
        const caughtUp = diagnosis.seasons?.some((s) => s.downloaded > 0);
        if (!date)
          return { label: label('badgeNotReleased'), badgeType: 'primary' };
        return {
          label: label(caughtUp ? 'badgeNextEpisode' : 'badgePremieres', {
            date,
          }),
          badgeType: 'primary',
        };
      }
      if (diagnosis.expectedDateType === 'cinema' || !date) {
        return {
          label: label(date ? 'badgeInCinemas' : 'badgeNotReleased'),
          badgeType: 'primary',
        };
      }
      return { label: label('badgeReleases', { date }), badgeType: 'primary' };
    }
    case DiagnosisCategory.READY_TO_GRAB:
      return { label: label('badgeSearching'), badgeType: 'primary' };
    case DiagnosisCategory.NO_RESULTS:
    case DiagnosisCategory.OTHER_REJECTED:
      return { label: label('badgeNotFound'), badgeType: 'warning' };
    case DiagnosisCategory.QUALITY_UNMET:
      return { label: label('badgeLowerQuality'), badgeType: 'warning' };
    case DiagnosisCategory.LANGUAGE_UNMET:
      return { label: label('badgeOtherLanguages'), badgeType: 'warning' };
    case DiagnosisCategory.IMPORT_PROBLEM:
    case DiagnosisCategory.NOT_SENT:
    case DiagnosisCategory.NOT_MONITORED:
    case DiagnosisCategory.SERVICE_ERROR:
      return { label: label('badgeNeedsAdmin'), badgeType: 'danger' };
    case DiagnosisCategory.AWAITING_SCAN:
      return { label: label('badgeAlmostReady'), badgeType: 'success' };
    default:
      return undefined;
  }
};

export const formatBytes = (intl: IntlShape, bytes: number) =>
  bytes >= 1e9
    ? `${intl.formatNumber(bytes / 1e9, { maximumFractionDigits: 1 })} GB`
    : `${intl.formatNumber(bytes / 1e6, { maximumFractionDigits: 0 })} MB`;

/** Headline and one-paragraph explanation for the dialog and callout. */
export const diagnosisText = (
  intl: IntlShape,
  diagnosis: Diagnosis,
  { mediaType, mediaServer }: { mediaType: 'movie' | 'tv'; mediaServer: string }
): { headline: string; body: string[] } => {
  const arr = mediaType === 'movie' ? 'Radarr' : 'Sonarr';
  const date = diagnosis.expectedDate
    ? intl.formatDate(diagnosis.expectedDate, {
        dateStyle: 'long',
        timeZone: 'UTC',
      })
    : '';
  const next = diagnosis.nextSearchAt
    ? relative(intl, diagnosis.nextSearchAt)
    : intl.formatMessage(messages.soon);
  const s = diagnosis.search;
  const t = (m: keyof typeof messages, values: Record<string, unknown> = {}) =>
    intl.formatMessage(messages[m], values as Record<string, string>);

  switch (diagnosis.category) {
    case DiagnosisCategory.NOT_RELEASED: {
      if (mediaType === 'tv') {
        const caughtUp = diagnosis.seasons?.some((x) => x.downloaded > 0);
        return {
          headline: t(caughtUp ? 'headCaughtUp' : 'headNotAired'),
          body: [
            t(caughtUp ? 'bodyCaughtUp' : 'bodyNotAired', {
              hasDate: String(!!date),
              date,
            }),
          ],
        };
      }
      const body =
        diagnosis.expectedDateType === 'cinema'
          ? t('bodyInCinemas', { hasDate: String(!!date), date })
          : date
            ? t('bodyNotReleasedDate', { date })
            : t('bodyNotReleased');
      return {
        headline: t('headNotReleased'),
        body: [
          body,
          ...(s?.acceptable || s?.heldBack ? [t('bodyHeldBack')] : []),
        ],
      };
    }
    case DiagnosisCategory.PENDING_CHECK:
      return {
        headline: t('headPending'),
        body: [t('bodyPending', { arr, next })],
      };
    case DiagnosisCategory.READY_TO_GRAB: {
      const searchedSince = (diagnosis.actions ?? []).some(
        (a) =>
          a.action === 'search' &&
          (!diagnosis.searchedAt || a.at >= diagnosis.searchedAt)
      );
      return {
        headline: t('headReady'),
        body: [t(searchedSince ? 'bodyReady' : 'bodyReadyNotYet')],
      };
    }
    case DiagnosisCategory.NO_RESULTS:
      return {
        headline: t('headNoResults'),
        body: [
          t('bodyNoResults', { next }),
          ...(s?.dead ? [t('bodyDead', { count: s.dead })] : []),
        ],
      };
    case DiagnosisCategory.QUALITY_UNMET:
      return {
        headline: t('headQuality'),
        body: [
          t('bodyQuality', {
            count: s?.qualityOnly ?? 0,
            quality: s?.bestAlternative?.quality ?? '',
            size: s?.bestAlternative
              ? formatBytes(intl, s.bestAlternative.size)
              : '',
          }),
        ],
      };
    case DiagnosisCategory.LANGUAGE_UNMET:
      return {
        headline: t('headLanguage'),
        body: [
          t('bodyLanguage', {
            count: s?.languageOnly ?? 0,
            languages: intl.formatList(s?.languagesFound ?? [], {
              type: 'conjunction',
            }),
          }),
        ],
      };
    case DiagnosisCategory.OTHER_REJECTED:
      return {
        headline: t('headOther'),
        body: [t('bodyOther', { count: s?.results ?? 0, next })],
      };
    case DiagnosisCategory.DOWNLOADING:
      return { headline: t('headDownloading'), body: [t('bodyDownloading')] };
    case DiagnosisCategory.IMPORT_PROBLEM:
      return { headline: t('headImport'), body: [t('bodyImport')] };
    case DiagnosisCategory.NOT_SENT:
      return { headline: t('headNotSent'), body: [t('bodyNotSent', { arr })] };
    case DiagnosisCategory.NOT_MONITORED:
      return {
        headline: t('headNotMonitored'),
        body: [t('bodyNotMonitored', { arr })],
      };
    case DiagnosisCategory.SERVICE_ERROR:
      return {
        headline: t('headServiceError'),
        body: [t('bodyServiceError', { arr })],
      };
    case DiagnosisCategory.FULFILLED:
    case DiagnosisCategory.AWAITING_SCAN:
      return {
        headline: t('headAwaitingScan'),
        body: [t('bodyAwaitingScan', { mediaServer })],
      };
  }
};

/** "in 3 days", "2 hours ago": the largest sensible unit. */
export const relative = (intl: IntlShape, iso: string) => {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 3600
      ? [Math.round(seconds / 60), 'minute']
      : abs < 86400
        ? [Math.round(seconds / 3600), 'hour']
        : [Math.round(seconds / 86400), 'day'];
  return intl.formatRelativeTime(value, unit, { numeric: 'auto' });
};
