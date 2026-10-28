import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import type { ServarrRelease } from '@server/lib/diagnostics/classify';
import { classifyReleases } from '@server/lib/diagnostics/classify';
import { stripDiagnosis } from '@server/lib/diagnostics/strip';
import type {
  Diagnosis,
  DiagnosisAction,
  DiagnosisActionState,
  DiagnosisResponse,
  SeasonDiagnosis,
} from '@server/lib/diagnostics/types';
import { DiagnosisCategory } from '@server/lib/diagnostics/types';
import { Permission } from '@server/lib/permissions';
import type { RadarrSettings, SonarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { In } from 'typeorm';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Wait after a request is sent before second-guessing Radarr/Sonarr's own search. */
const GRACE_PERIOD = 2 * HOUR;
/** Days between searches after consecutive misses: 1, 2, 4, then weekly. */
const BACKOFF_DAYS = [1, 2, 4, 7];
/** Interactive searches per job run, to stay within indexer API limits. */
const MAX_SEARCHES_PER_RUN = 10;
/** How often a requester may force a fresh check or a search. */
const USER_REFRESH_INTERVAL = HOUR;
const USER_SEARCH_INTERVAL = DAY;

/** Categories where the last search found nothing usable. */
const MISS_CATEGORIES = [
  DiagnosisCategory.NO_RESULTS,
  DiagnosisCategory.QUALITY_UNMET,
  DiagnosisCategory.LANGUAGE_UNMET,
  DiagnosisCategory.OTHER_REJECTED,
];

/** For TV, the season that best explains the whole request comes first. */
const TV_PRIORITY = [
  DiagnosisCategory.SERVICE_ERROR,
  DiagnosisCategory.IMPORT_PROBLEM,
  DiagnosisCategory.QUALITY_UNMET,
  DiagnosisCategory.LANGUAGE_UNMET,
  DiagnosisCategory.READY_TO_GRAB,
  DiagnosisCategory.NO_RESULTS,
  DiagnosisCategory.OTHER_REJECTED,
  DiagnosisCategory.DOWNLOADING,
  DiagnosisCategory.PENDING_CHECK,
  DiagnosisCategory.AWAITING_SCAN,
  DiagnosisCategory.NOT_RELEASED,
  DiagnosisCategory.FULFILLED,
];

const IMPORT_STATES = ['importBlocked', 'importFailed', 'failedPending'];

type SearchMode = 'never' | 'due' | 'force';

const field = (is4k: boolean) => (is4k ? 'diagnosis4k' : 'diagnosis');

const isDue = (previous: Diagnosis | null | undefined, now: number) =>
  !previous?.nextSearchAt || new Date(previous.nextSearchAt).getTime() <= now;

const nextSearch = (failedSearches: number, now: number) =>
  new Date(
    now +
      BACKOFF_DAYS[
        Math.min(Math.max(failedSearches - 1, 0), BACKOFF_DAYS.length - 1)
      ] *
        DAY
  ).toISOString();

const queueMessage = (
  items: { errorMessage?: string; statusMessages?: { messages: string[] }[] }[]
) =>
  items
    .flatMap((i) => [
      i.errorMessage,
      ...(i.statusMessages ?? []).flatMap((m) => m.messages),
    ])
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ') || undefined;

class RequestDiagnostics {
  public running = false;
  private cancelled = false;

  private radarrFor(media: Media, is4k: boolean) {
    const serviceId = is4k ? media.serviceId4k : media.serviceId;
    const server = getSettings().radarr.find((r) => r.id === serviceId);
    return server
      ? {
          server,
          api: new RadarrAPI({
            apiKey: server.apiKey,
            url: RadarrAPI.buildUrl(server, '/api/v3'),
          }),
        }
      : undefined;
  }

  private sonarrFor(media: Media, is4k: boolean) {
    const serviceId = is4k ? media.serviceId4k : media.serviceId;
    const server = getSettings().sonarr.find((s) => s.id === serviceId);
    return server
      ? {
          server,
          api: new SonarrAPI({
            apiKey: server.apiKey,
            url: SonarrAPI.buildUrl(server, '/api/v3'),
          }),
        }
      : undefined;
  }

  /**
   * Works out why a requested item hasn't arrived. Cheap checks (release
   * dates, monitoring, queue) always run; the indexer search only runs when
   * `search` allows it, otherwise the last search's result is carried over.
   */
  public async diagnose(
    media: Media,
    is4k: boolean,
    search: SearchMode = 'due'
  ): Promise<Diagnosis> {
    const previous = media[field(is4k)];
    const base: Diagnosis = {
      category: DiagnosisCategory.PENDING_CHECK,
      checkedAt: new Date().toISOString(),
      failedSearches: previous?.failedSearches ?? 0,
      searchedAt: previous?.searchedAt,
      nextSearchAt: previous?.nextSearchAt,
      search: previous?.search,
      actions: previous?.actions,
    };
    const externalId = is4k
      ? media.externalServiceId4k
      : media.externalServiceId;

    if (externalId === null || externalId === undefined) {
      return { ...base, category: DiagnosisCategory.NOT_SENT };
    }

    try {
      return media.mediaType === MediaType.MOVIE
        ? await this.diagnoseMovie(
            media,
            is4k,
            externalId,
            base,
            previous,
            search
          )
        : await this.diagnoseSeries(
            media,
            is4k,
            externalId,
            base,
            previous,
            search
          );
    } catch (e) {
      const notFound = e?.cause?.response?.status === 404;
      logger.warn('Request diagnosis failed', {
        label: 'Request Diagnostics',
        mediaId: media.id,
        errorMessage: e.message,
      });
      return {
        ...base,
        category: notFound
          ? DiagnosisCategory.NOT_SENT
          : DiagnosisCategory.SERVICE_ERROR,
        message: notFound ? undefined : e.message,
      };
    }
  }

  private async diagnoseMovie(
    media: Media,
    is4k: boolean,
    movieId: number,
    base: Diagnosis,
    previous: Diagnosis | null | undefined,
    search: SearchMode
  ): Promise<Diagnosis> {
    const radarr = this.radarrFor(media, is4k);
    if (!radarr) return { ...base, category: DiagnosisCategory.NOT_SENT };

    const movie = await radarr.api.getMovie({ id: movieId });
    const released = movie.isAvailable;
    const [expectedDate, dateType] =
      movie.minimumAvailability === 'inCinemas'
        ? [movie.inCinemas, 'cinema' as const]
        : movie.digitalRelease
          ? [movie.digitalRelease, 'digital' as const]
          : [movie.physicalRelease, 'physical' as const];
    // In cinemas with no home release date yet still reads as "in cinemas".
    const expectedDateType = expectedDate
      ? dateType
      : movie.status === 'inCinemas'
        ? ('cinema' as const)
        : undefined;
    const dated: Diagnosis = {
      ...base,
      expectedDate: released ? undefined : expectedDate,
      expectedDateType: released ? undefined : expectedDateType,
    };

    if (movie.hasFile) {
      return { ...dated, category: DiagnosisCategory.AWAITING_SCAN };
    }
    if (!movie.monitored) {
      return { ...dated, category: DiagnosisCategory.NOT_MONITORED };
    }

    const queue = await radarr.api.getQueueDetails({ movieId });
    if (queue.length > 0) {
      const blocked = queue.filter(
        (q) =>
          IMPORT_STATES.includes(q.trackedDownloadState) ||
          q.trackedDownloadStatus === 'error'
      );
      return {
        ...dated,
        category: blocked.length
          ? DiagnosisCategory.IMPORT_PROBLEM
          : DiagnosisCategory.DOWNLOADING,
        message: queueMessage(blocked.length ? blocked : queue),
      };
    }

    const now = Date.now();
    if (search === 'force' || (search === 'due' && isDue(previous, now))) {
      const releases = await radarr.api.getReleases<ServarrRelease>({
        movieId,
      });
      const { category, summary } = classifyReleases(releases, { released });
      const failedSearches = MISS_CATEGORIES.includes(category)
        ? base.failedSearches + 1
        : 0;
      const releaseAt = expectedDate ? new Date(expectedDate).getTime() : 0;
      return {
        ...dated,
        category,
        search: summary,
        searchedAt: new Date(now).toISOString(),
        failedSearches,
        nextSearchAt:
          !released && releaseAt > now
            ? new Date(releaseAt + HOUR).toISOString()
            : nextSearch(failedSearches, now),
      };
    }

    // No search this time: keep the last search's verdict.
    return {
      ...dated,
      category: !released
        ? DiagnosisCategory.NOT_RELEASED
        : previous?.searchedAt &&
            previous.category !== DiagnosisCategory.NOT_RELEASED
          ? previous.category
          : DiagnosisCategory.PENDING_CHECK,
    };
  }

  private async diagnoseSeries(
    media: Media,
    is4k: boolean,
    seriesId: number,
    base: Diagnosis,
    previous: Diagnosis | null | undefined,
    search: SearchMode
  ): Promise<Diagnosis> {
    const sonarr = this.sonarrFor(media, is4k);
    if (!sonarr) return { ...base, category: DiagnosisCategory.NOT_SENT };

    const series = await sonarr.api.getSeriesById(seriesId);
    if (!series.monitored) {
      return { ...base, category: DiagnosisCategory.NOT_MONITORED };
    }

    const wanted = media.seasons
      .filter((s) =>
        [MediaStatus.PROCESSING, MediaStatus.PARTIALLY_AVAILABLE].includes(
          is4k ? s.status4k : s.status
        )
      )
      .map((s) => s.seasonNumber);
    const [episodes, queue] = await Promise.all([
      sonarr.api.getEpisodes(seriesId),
      sonarr.api.getQueueDetails({ seriesId }),
    ]);
    const now = Date.now();
    const searchAllowed =
      search === 'force' || (search === 'due' && isDue(previous, now));
    const previousSeasons = new Map(
      (previous?.seasons ?? []).map((s) => [s.seasonNumber, s])
    );
    const seasons: SeasonDiagnosis[] = [];
    let searched = false;

    for (const seasonNumber of wanted) {
      const eps = episodes.filter((e) => e.seasonNumber === seasonNumber);
      const aired = eps.filter(
        (e) => e.airDateUtc && new Date(e.airDateUtc).getTime() <= now
      );
      const missing = aired.filter((e) => !e.hasFile && e.monitored);
      const nextAirDate = eps
        .map((e) => e.airDateUtc)
        .filter((d) => d && new Date(d).getTime() > now)
        .sort()[0];
      const season: SeasonDiagnosis = {
        seasonNumber,
        episodes: eps.length,
        aired: aired.length,
        downloaded: eps.filter((e) => e.hasFile).length,
        nextAirDate,
        category: DiagnosisCategory.PENDING_CHECK,
      };
      const missingIds = new Set(missing.map((e) => e.id));
      const inQueue = queue.filter(
        (q) =>
          (q as { episodeId?: number }).episodeId !== undefined &&
          missingIds.has((q as { episodeId?: number }).episodeId as number)
      );

      if (missing.length === 0) {
        // Everything aired is downloaded: waiting for new episodes, or for
        // the media server to pick up the last ones.
        season.category =
          aired.length < eps.length || aired.length === 0
            ? DiagnosisCategory.NOT_RELEASED
            : DiagnosisCategory.FULFILLED;
      } else if (inQueue.length > 0) {
        const blocked = inQueue.filter((q) =>
          IMPORT_STATES.includes(q.trackedDownloadState)
        );
        season.category = blocked.length
          ? DiagnosisCategory.IMPORT_PROBLEM
          : DiagnosisCategory.DOWNLOADING;
      } else if (searchAllowed) {
        const releases = (
          await sonarr.api.getReleases<ServarrRelease>({
            seriesId,
            seasonNumber,
          })
        ).filter(
          (r) => r.seasonNumber === undefined || r.seasonNumber === seasonNumber
        );
        const { category, summary } = classifyReleases(releases);
        season.category = category;
        season.search = summary;
        searched = true;
      } else {
        const before = previousSeasons.get(seasonNumber);
        season.category = before?.search
          ? before.category
          : DiagnosisCategory.PENDING_CHECK;
        season.search = before?.search;
      }
      seasons.push(season);
    }

    const lead = [...seasons].sort(
      (a, b) =>
        TV_PRIORITY.indexOf(a.category) - TV_PRIORITY.indexOf(b.category)
    )[0];
    const category = lead?.category ?? DiagnosisCategory.FULFILLED;
    const failedSearches = searched
      ? MISS_CATEGORIES.includes(category)
        ? base.failedSearches + 1
        : 0
      : base.failedSearches;
    const allUnaired = seasons.every(
      (s) => s.category === DiagnosisCategory.NOT_RELEASED
    );
    const nextAir = seasons
      .map((s) => s.nextAirDate)
      .filter(Boolean)
      .sort()[0];

    return {
      ...base,
      category,
      seasons,
      search: lead?.search,
      expectedDate: allUnaired ? nextAir : undefined,
      expectedDateType: allUnaired && nextAir ? 'air' : undefined,
      failedSearches,
      ...(searched && {
        searchedAt: new Date(now).toISOString(),
        nextSearchAt: nextSearch(failedSearches, now),
      }),
      message: queueMessage(
        queue.filter((q) => IMPORT_STATES.includes(q.trackedDownloadState))
      ),
    };
  }

  public async save(media: Media, is4k: boolean, diagnosis: Diagnosis | null) {
    // Only this column: scanners may be saving the same row concurrently.
    await getRepository(Media).update(media.id, { [field(is4k)]: diagnosis });
    media[field(is4k)] = diagnosis;
  }

  /** Scheduled job: re-checks approved requests that are still missing. */
  public async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.cancelled = false;
    let searches = 0;

    try {
      const media = await getRepository(Media).find({
        where: [
          {
            status: In([
              MediaStatus.PROCESSING,
              MediaStatus.PARTIALLY_AVAILABLE,
            ]),
          },
          {
            status4k: In([
              MediaStatus.PROCESSING,
              MediaStatus.PARTIALLY_AVAILABLE,
            ]),
          },
        ],
        relations: { requests: true },
      });

      for (const item of media) {
        for (const is4k of [false, true]) {
          if (this.cancelled) return;
          const status = is4k ? item.status4k : item.status;
          const approved = item.requests.filter(
            (r) => r.is4k === is4k && r.status === MediaRequestStatus.APPROVED
          );
          if (
            ![MediaStatus.PROCESSING, MediaStatus.PARTIALLY_AVAILABLE].includes(
              status
            ) ||
            approved.length === 0
          ) {
            continue;
          }
          const sentAt = Math.max(
            ...approved.map((r) => new Date(r.updatedAt).getTime())
          );
          const inGrace = Date.now() - sentAt < GRACE_PERIOD;
          const mayRun =
            !inGrace &&
            searches < MAX_SEARCHES_PER_RUN &&
            isDue(item[field(is4k)], Date.now());
          const diagnosis = await this.diagnose(
            item,
            is4k,
            mayRun ? 'due' : 'never'
          );
          if (diagnosis.searchedAt !== item[field(is4k)]?.searchedAt) {
            searches++;
          }
          await this.save(item, is4k, diagnosis);
          if (diagnosis.category === DiagnosisCategory.READY_TO_GRAB) {
            await this.autoSearch(item, is4k, diagnosis);
          }
        }
      }
      logger.info('Request diagnostics complete', {
        label: 'Request Diagnostics',
        checked: media.length,
        searches,
      });
    } catch (e) {
      logger.error('Request diagnostics failed', {
        label: 'Request Diagnostics',
        errorMessage: e.message,
      });
    } finally {
      this.running = false;
    }
  }

  public cancel() {
    this.cancelled = true;
  }

  /**
   * A release that meets the profile exists but nothing grabbed it (Radarr and
   * Sonarr only watch RSS after the first search). Ask for a real search, at
   * most once a day.
   */
  private async autoSearch(media: Media, is4k: boolean, diagnosis: Diagnosis) {
    const last = (diagnosis.actions ?? [])
      .filter((a) => a.action === 'search')
      .map((a) => new Date(a.at).getTime())
      .sort()
      .pop();
    if (last && Date.now() - last < DAY) return;
    await this.triggerSearch(media, is4k, diagnosis);
    diagnosis.actions = [
      ...(diagnosis.actions ?? []),
      { action: 'search' as const, userId: 0, at: new Date().toISOString() },
    ].slice(-10);
    await this.save(media, is4k, diagnosis);
  }

  private async triggerSearch(
    media: Media,
    is4k: boolean,
    diagnosis: Diagnosis
  ) {
    const externalId = (
      is4k ? media.externalServiceId4k : media.externalServiceId
    ) as number;
    if (media.mediaType === MediaType.MOVIE) {
      await this.radarrFor(media, is4k)?.api.searchMovie(externalId);
      return;
    }
    const sonarr = this.sonarrFor(media, is4k);
    const seasons = (diagnosis.seasons ?? []).filter(
      (s) => s.aired > s.downloaded
    );
    for (const s of seasons) {
      await sonarr?.api.searchSeason(externalId, s.seasonNumber);
    }
  }

  private fallbackProfile(
    server: RadarrSettings | SonarrSettings | undefined,
    action: DiagnosisAction
  ) {
    if (!server) return undefined;
    return action === 'lower_quality'
      ? server.fallbackQualityProfileId
        ? {
            id: server.fallbackQualityProfileId,
            name: server.fallbackQualityProfileName,
          }
        : undefined
      : action === 'any_language' && server.fallbackLanguageProfileId
        ? {
            id: server.fallbackLanguageProfileId,
            name: server.fallbackLanguageProfileName,
          }
        : undefined;
  }

  private serverFor(media: Media, is4k: boolean) {
    return media.mediaType === MediaType.MOVIE
      ? this.radarrFor(media, is4k)?.server
      : this.sonarrFor(media, is4k)?.server;
  }

  /** What `user` may see and do for this item. */
  public describe(media: Media, is4k: boolean, user: User): DiagnosisResponse {
    const diagnosis = media[field(is4k)] ?? null;
    const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
    const isRequester = (media.requests ?? []).some(
      (r) =>
        r.is4k === is4k &&
        r.status === MediaRequestStatus.APPROVED &&
        r.requestedBy?.id === user.id
    );
    const mayRemediate =
      isManager ||
      (isRequester && user.hasPermission(Permission.REMEDIATE_REQUESTS));
    const server = this.serverFor(media, is4k);
    const lastBy = (action: DiagnosisAction) =>
      (diagnosis?.actions ?? [])
        .filter((a) => a.action === action && (isManager || a.userId !== 0))
        .map((a) => new Date(a.at).getTime())
        .sort()
        .pop();

    const state = (action: DiagnosisAction): DiagnosisActionState => {
      if (!mayRemediate) return { allowed: false, reason: 'no_permission' };
      if (action === 'search') {
        const last = lastBy('search');
        if (!isManager && last && Date.now() - last < USER_SEARCH_INTERVAL) {
          return {
            allowed: false,
            reason: 'rate_limited',
            availableAt: new Date(last + USER_SEARCH_INTERVAL).toISOString(),
          };
        }
        return { allowed: true };
      }
      if (!this.fallbackProfile(server, action)) {
        return { allowed: false, reason: 'not_configured' };
      }
      const matches =
        action === 'lower_quality'
          ? diagnosis?.category === DiagnosisCategory.QUALITY_UNMET
          : diagnosis?.category === DiagnosisCategory.LANGUAGE_UNMET;
      if (!isManager && !matches) {
        return { allowed: false, reason: 'not_needed' };
      }
      if (lastBy(action)) return { allowed: false, reason: 'not_needed' };
      return { allowed: true };
    };

    return {
      diagnosis: isManager ? diagnosis : (stripDiagnosis(diagnosis) ?? null),
      canRefresh: isManager || isRequester,
      isManager,
      mediaType: media.mediaType === MediaType.MOVIE ? 'movie' : 'tv',
      actions: {
        search: state('search'),
        lower_quality: state('lower_quality'),
        any_language: state('any_language'),
      },
      fallbackProfiles: {
        lowerQuality: this.fallbackProfile(server, 'lower_quality')?.name,
        anyLanguage: this.fallbackProfile(server, 'any_language')?.name,
      },
    };
  }

  /** On-demand check from the UI. Requesters get a cached answer within the hour. */
  public async refresh(media: Media, is4k: boolean, user: User) {
    const previous = media[field(is4k)];
    const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
    const recent =
      previous?.searchedAt &&
      Date.now() - new Date(previous.searchedAt).getTime() <
        USER_REFRESH_INTERVAL;
    const diagnosis = await this.diagnose(
      media,
      is4k,
      isManager || !recent ? 'force' : 'never'
    );
    await this.save(media, is4k, diagnosis);
    return this.describe(media, is4k, user);
  }

  public async perform(
    media: Media,
    is4k: boolean,
    action: DiagnosisAction,
    user: User
  ): Promise<DiagnosisResponse> {
    const current = this.describe(media, is4k, user);
    if (!current.actions[action].allowed) {
      throw Object.assign(new Error('Action not allowed'), {
        status: 403,
        reason: current.actions[action].reason,
      });
    }
    const diagnosis: Diagnosis = current.diagnosis ?? {
      category: DiagnosisCategory.PENDING_CHECK,
      checkedAt: new Date().toISOString(),
      failedSearches: 0,
    };
    const externalId = (
      is4k ? media.externalServiceId4k : media.externalServiceId
    ) as number;
    let previousProfileId: number | undefined;

    if (action !== 'search') {
      const profile = this.fallbackProfile(this.serverFor(media, is4k), action);
      if (!profile) throw new Error('No fallback profile configured');
      previousProfileId =
        media.mediaType === MediaType.MOVIE
          ? await this.radarrFor(media, is4k)?.api.setQualityProfile(
              externalId,
              profile.id
            )
          : await this.sonarrFor(media, is4k)?.api.setQualityProfile(
              externalId,
              profile.id
            );
    }
    await this.triggerSearch(media, is4k, diagnosis);

    logger.info('Request remediation', {
      label: 'Request Diagnostics',
      mediaId: media.id,
      is4k,
      action,
      userId: user.id,
      previousProfileId,
    });

    const updated: Diagnosis = {
      ...diagnosis,
      category: DiagnosisCategory.PENDING_CHECK,
      failedSearches: 0,
      // Look again soon: the search runs in Radarr/Sonarr in the background.
      nextSearchAt: new Date(Date.now() + HOUR).toISOString(),
      actions: [
        ...(diagnosis.actions ?? []),
        {
          action,
          userId: user.id,
          at: new Date().toISOString(),
          previousProfileId,
        },
      ].slice(-10),
    };
    await this.save(media, is4k, updated);
    return this.describe(media, is4k, user);
  }
}

export const loadMediaForDiagnosis = (id: number) =>
  getRepository(Media).findOne({
    where: { id },
    relations: { requests: { requestedBy: true } },
  });

const requestDiagnostics = new RequestDiagnostics();
export default requestDiagnostics;
