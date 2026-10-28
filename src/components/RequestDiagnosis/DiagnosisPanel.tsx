import Alert from '@app/components/Common/Alert';
import Badge from '@app/components/Common/Badge';
import Button from '@app/components/Common/Button';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import {
  diagnosisBadge,
  diagnosisText,
  formatBytes,
  relative,
} from '@app/components/RequestDiagnosis/labels';
import useSettings from '@app/hooks/useSettings';
import useToasts from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import {
  ArrowDownCircleIcon,
  ArrowPathIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import { MediaServerType } from '@server/constants/server';
import type {
  DiagnosisAction,
  DiagnosisResponse,
} from '@server/lib/diagnostics/types';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';
import axios from 'axios';
import { useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.RequestDiagnosis', {
  lastChecked: 'Last checked {time}',
  neverChecked: 'Not checked yet',
  nextCheck: 'Next automatic check {time}',
  checkNow: 'Check Now',
  checking: 'Checking every source… this can take a minute.',
  whatYouCanDo: 'What you can do',
  nothingToDo:
    "Nothing for now. We'll keep checking and let you know when it's available.",
  search: 'Search Again',
  searchTip: 'Ask {arr} to search every source right now.',
  searchLimited: 'You can search again {time}.',
  lowerQuality: 'Accept Lower Quality',
  lowerQualityTip:
    'Switch to “{profile}” and download the best copy available{hasBest, select, true { ({best})} other {}}. It may be upgraded later.',
  anyLanguage: 'Accept Other Languages',
  anyLanguageTip:
    'Switch to “{profile}” and download a copy in {languages}, usually with subtitles.',
  seriesWide: 'This applies to the whole series, not just one season.',
  confirm: 'Are you sure?',
  applied: 'Done. {arr} is searching now.',
  failed: 'Something went wrong. Try again later.',
  alreadyApplied: 'Already applied',
  askAdmin: 'Ask an admin to set up a fallback profile to enable this.',
  seasons: 'Seasons',
  season: 'Season {number}',
  seasonHeader: 'Season',
  episodesHeader: 'Episodes',
  status: 'Status',
  episodes: '{downloaded} of {aired} downloaded',
  episodesUpcoming: '{count} still to air',
  adminDetails: 'Details for admins',
  results:
    '{results} copies for this title · {acceptable} acceptable · {quality} lower quality · {language} other language · {other} other',
  bestRelease: 'Best alternative: {title}',
  reasons: 'Most common rejections',
  qualitiesFound: 'Qualities found: {list}',
  message: '{arr} says: {message}',
  history: 'Actions',
  actionBy: '{action} by {who} {time}',
  system: 'automatic',
  someoneElse: 'user #{id}',
});

const ACTION_ICONS: Record<DiagnosisAction, typeof ArrowPathIcon> = {
  search: MagnifyingGlassIcon,
  lower_quality: ArrowDownCircleIcon,
  any_language: LanguageIcon,
};

const ACTION_NAMES: Record<DiagnosisAction, keyof typeof messages> = {
  search: 'search',
  lower_quality: 'lowerQuality',
  any_language: 'anyLanguage',
};

interface DiagnosisPanelProps {
  mediaId: number;
  is4k?: boolean;
  /** Called after an action, so parents can refresh the media. */
  onChange?: () => void;
}

const DiagnosisPanel = ({
  mediaId,
  is4k = false,
  onChange,
}: DiagnosisPanelProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const settings = useSettings();
  const [busy, setBusy] = useState<'refresh' | DiagnosisAction | null>(null);
  const [confirming, setConfirming] = useState<DiagnosisAction | null>(null);
  const { data, error, mutate } = useSWR<DiagnosisResponse>(
    `/api/v1/media/${mediaId}/diagnosis?is4k=${is4k}`
  );

  if (error) return null;
  if (!data) return <LoadingSpinner />;

  const { diagnosis, actions, fallbackProfiles, isManager, mediaType } = data;
  const arr = mediaType === 'movie' ? 'Radarr' : 'Sonarr';
  const mediaServer =
    settings.currentSettings.mediaServerType === MediaServerType.PLEX
      ? 'Plex'
      : settings.currentSettings.mediaServerType === MediaServerType.EMBY
        ? 'Emby'
        : 'Jellyfin';

  const refresh = async () => {
    setBusy('refresh');
    try {
      const res = await axios.post<DiagnosisResponse>(
        `/api/v1/media/${mediaId}/diagnosis/refresh`,
        { is4k }
      );
      mutate(res.data, false);
      onChange?.();
    } catch {
      addToast(intl.formatMessage(messages.failed), { appearance: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const perform = async (action: DiagnosisAction) => {
    setBusy(action);
    setConfirming(null);
    try {
      const res = await axios.post<DiagnosisResponse>(
        `/api/v1/media/${mediaId}/diagnosis/action`,
        { is4k, action }
      );
      mutate(res.data, false);
      onChange?.();
      addToast(intl.formatMessage(messages.applied, { arr }), {
        appearance: 'success',
        autoDismiss: true,
      });
    } catch {
      addToast(intl.formatMessage(messages.failed), { appearance: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (!diagnosis) return null;

  const text = diagnosisText(intl, diagnosis, { mediaType, mediaServer });
  const badge = diagnosisBadge(intl, diagnosis, mediaType);
  const search = diagnosis.search;
  const alertType =
    badge?.badgeType === 'danger'
      ? 'error'
      : badge?.badgeType === 'warning'
        ? 'warning'
        : 'info';

  // Offer only the fixes that fit the problem; managers also see the rest.
  const offered = (['lower_quality', 'any_language', 'search'] as const).filter(
    (a) => {
      const st = actions[a];
      if (st.reason === 'no_permission') return false;
      if (a === 'search') return true;
      // Fallbacks only make sense when that kind of copy exists.
      return st.allowed || st.reason === 'not_configured' || isManager
        ? (a === 'lower_quality' &&
            diagnosis.category === DiagnosisCategory.QUALITY_UNMET) ||
            (a === 'any_language' &&
              diagnosis.category === DiagnosisCategory.LANGUAGE_UNMET)
        : false;
    }
  );
  const searchUseful = ![
    DiagnosisCategory.DOWNLOADING,
    DiagnosisCategory.AWAITING_SCAN,
    DiagnosisCategory.NOT_SENT,
    DiagnosisCategory.NOT_MONITORED,
  ].includes(diagnosis.category);

  const tip = (a: DiagnosisAction) => {
    switch (a) {
      case 'search':
        return actions.search.reason === 'rate_limited' &&
          actions.search.availableAt
          ? intl.formatMessage(messages.searchLimited, {
              time: relative(intl, actions.search.availableAt),
            })
          : intl.formatMessage(messages.searchTip, { arr });
      case 'lower_quality':
        if (actions.lower_quality.reason === 'not_configured')
          return intl.formatMessage(messages.askAdmin);
        return intl.formatMessage(messages.lowerQualityTip, {
          profile: fallbackProfiles.lowerQuality ?? '',
          hasBest: String(!!search?.bestAlternative),
          best: search?.bestAlternative
            ? `${search.bestAlternative.quality} · ${formatBytes(intl, search.bestAlternative.size)}`
            : '',
        });
      case 'any_language':
        if (actions.any_language.reason === 'not_configured')
          return intl.formatMessage(messages.askAdmin);
        return intl.formatMessage(messages.anyLanguageTip, {
          profile: fallbackProfiles.anyLanguage ?? '',
          languages: intl.formatList(search?.languagesFound ?? [], {
            type: 'disjunction',
          }),
        });
    }
  };

  const visible = offered.filter((a) => a !== 'search' || searchUseful);

  return (
    <div className="text-sm text-gray-300">
      <Alert type={alertType} title={text.headline}>
        {text.body.map((p) => (
          <p key={p} className="mt-1 first:mt-0">
            {p}
          </p>
        ))}
      </Alert>

      {diagnosis.seasons && diagnosis.seasons.length > 0 && (
        <>
          <div className="mb-2 mt-4 flex items-center text-lg font-semibold text-white">
            {intl.formatMessage(messages.seasons)}
          </div>
          <div className="overflow-hidden rounded-lg border border-gray-700 shadow backdrop-blur">
            <table className="min-w-full">
              <thead>
                <tr>
                  {(['seasonHeader', 'episodesHeader', 'status'] as const).map(
                    (h) => (
                      <th
                        key={h}
                        className="bg-gray-700/80 px-4 py-3 text-left text-xs font-medium uppercase leading-4 tracking-wider text-gray-200"
                      >
                        {intl.formatMessage(messages[h])}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {diagnosis.seasons.map((s) => {
                  const sb = diagnosisBadge(
                    intl,
                    {
                      ...diagnosis,
                      category: s.category,
                      expectedDate: s.nextAirDate,
                      seasons: [s],
                    },
                    'tv'
                  );
                  return (
                    <tr key={s.seasonNumber}>
                      <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-100">
                        {intl.formatMessage(messages.season, {
                          number: s.seasonNumber,
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-200">
                        {intl.formatMessage(messages.episodes, {
                          downloaded: s.downloaded,
                          aired: s.aired,
                        })}
                        {s.episodes > s.aired && (
                          <span className="block text-xs text-gray-400">
                            {intl.formatMessage(messages.episodesUpcoming, {
                              count: s.episodes - s.aired,
                            })}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {sb && (
                          <Badge badgeType={sb.badgeType}>{sb.label}</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {data.canRefresh && (
        <>
          <div className="mb-2 mt-4 flex items-center text-lg font-semibold text-white">
            {intl.formatMessage(messages.whatYouCanDo)}
          </div>
          {visible.length === 0 ? (
            <p>{intl.formatMessage(messages.nothingToDo)}</p>
          ) : (
            <ul className="divide-y divide-gray-700 overflow-hidden rounded-lg border border-gray-700 shadow backdrop-blur">
              {visible.map((a) => {
                const ActionIcon = ACTION_ICONS[a];
                return (
                  <li
                    key={a}
                    className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <p className="text-gray-300">
                      {tip(a)}
                      {a !== 'search' && mediaType === 'tv' && (
                        <span className="block text-xs text-gray-400">
                          {intl.formatMessage(messages.seriesWide)}
                        </span>
                      )}
                    </p>
                    <Button
                      buttonType={
                        a === 'search'
                          ? 'ghost'
                          : confirming === a
                            ? 'warning'
                            : 'primary'
                      }
                      buttonSize="sm"
                      className="flex-shrink-0"
                      disabled={!actions[a].allowed || busy !== null}
                      onClick={() =>
                        a === 'search' || confirming === a
                          ? perform(a)
                          : setConfirming(a)
                      }
                    >
                      {busy === a ? (
                        <ArrowPathIcon className="animate-spin" />
                      ) : (
                        <ActionIcon />
                      )}
                      <span>
                        {actions[a].reason === 'not_needed' && a !== 'search'
                          ? intl.formatMessage(messages.alreadyApplied)
                          : confirming === a
                            ? intl.formatMessage(messages.confirm)
                            : intl.formatMessage(messages[ACTION_NAMES[a]])}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-400">
        <span>
          {busy === 'refresh'
            ? intl.formatMessage(messages.checking)
            : diagnosis.searchedAt
              ? intl.formatMessage(messages.lastChecked, {
                  time: relative(intl, diagnosis.searchedAt),
                })
              : intl.formatMessage(messages.neverChecked)}
          {busy !== 'refresh' &&
            diagnosis.nextSearchAt &&
            new Date(diagnosis.nextSearchAt).getTime() > Date.now() &&
            ` · ${intl.formatMessage(messages.nextCheck, {
              time: relative(intl, diagnosis.nextSearchAt),
            })}`}
        </span>
        {data.canRefresh && (
          <Button
            buttonType="ghost"
            buttonSize="sm"
            onClick={refresh}
            disabled={busy !== null}
          >
            <ArrowPathIcon
              className={busy === 'refresh' ? 'animate-spin' : ''}
            />
            <span>{intl.formatMessage(messages.checkNow)}</span>
          </Button>
        )}
      </div>

      {isManager &&
        (search || diagnosis.message || diagnosis.actions?.length) && (
          <details className="mt-4 overflow-hidden rounded-lg border border-gray-700 px-4 py-3 text-xs text-gray-400 shadow backdrop-blur">
            <summary className="cursor-pointer font-medium text-gray-200">
              {intl.formatMessage(messages.adminDetails)}
            </summary>
            <div className="mt-2 space-y-2">
              {diagnosis.message && (
                <p>
                  {intl.formatMessage(messages.message, {
                    arr,
                    message: diagnosis.message,
                  })}
                </p>
              )}
              {search && (
                <>
                  <p>
                    {intl.formatMessage(messages.results, {
                      results: search.results,
                      acceptable: search.acceptable,
                      quality: search.qualityOnly,
                      language: search.languageOnly,
                      other: search.other,
                    })}
                  </p>
                  {search.qualitiesFound.length > 0 && (
                    <p>
                      {intl.formatMessage(messages.qualitiesFound, {
                        list: search.qualitiesFound.join(', '),
                      })}
                    </p>
                  )}
                  {search.bestAlternative?.title && (
                    <p className="break-all">
                      {intl.formatMessage(messages.bestRelease, {
                        title: search.bestAlternative.title,
                      })}
                    </p>
                  )}
                  {search.topReasons.length > 0 && (
                    <>
                      <p className="font-semibold text-gray-300">
                        {intl.formatMessage(messages.reasons)}
                      </p>
                      <ul className="list-inside list-disc">
                        {search.topReasons.map((r) => (
                          <li key={r.reason}>
                            {r.count}× {r.reason}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )}
              {diagnosis.actions && diagnosis.actions.length > 0 && (
                <>
                  <p className="font-semibold text-gray-300">
                    {intl.formatMessage(messages.history)}
                  </p>
                  <ul className="list-inside list-disc">
                    {[...diagnosis.actions].reverse().map((a) => (
                      <li key={a.at}>
                        {intl.formatMessage(messages.actionBy, {
                          action: intl.formatMessage(
                            messages[ACTION_NAMES[a.action]]
                          ),
                          who:
                            a.userId === 0
                              ? intl.formatMessage(messages.system)
                              : intl.formatMessage(messages.someoneElse, {
                                  id: a.userId,
                                }),
                          time: relative(intl, a.at),
                        })}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </details>
        )}
    </div>
  );
};

export default DiagnosisPanel;
