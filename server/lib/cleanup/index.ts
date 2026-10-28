import PlexAPI from '@server/api/plexapi';
import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import TautulliAPI from '@server/api/tautulli';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { MediaServerType } from '@server/constants/server';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { MediaRequest } from '@server/entity/MediaRequest';
import SeasonRequest from '@server/entity/SeasonRequest';
import { User } from '@server/entity/User';
import type {
  CleanupAction,
  CleanupCandidate,
  CleanupRunSummary,
  DiskUsage,
  MediaCleanup,
} from '@server/lib/cleanup/types';
import { Permission } from '@server/lib/permissions';
import type { CleanupRule } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { appDataPath } from '@server/utils/appDataVolume';
import { readFileSync } from 'fs';
import { statfs, writeFile } from 'fs/promises';
import path from 'path';
import { In } from 'typeorm';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Removal dates are met by a run that starts up to this early. */
const TOLERANCE = HOUR;
/** How long a computed candidate list is reused by the cleanup page. */
const CANDIDATE_CACHE = 10 * 60 * 1000;

const AVAILABLE = [MediaStatus.AVAILABLE, MediaStatus.PARTIALLY_AVAILABLE];

type Kind = 'movie' | 'tv';

export class CleanupError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** One title as Radarr/Sonarr sees it. */
interface ArrItem {
  tmdbId?: number;
  tvdbId?: number;
  title: string;
  sizeBytes: number;
  year?: number;
}

const label = { label: 'Library Cleanup' };

/** The last run survives restarts, so the cleanup page can show it. */
const LAST_RUN_PATH = path.join(appDataPath(), 'cleanup-last-run.json');

const readLastRun = (): CleanupRunSummary | undefined => {
  try {
    return JSON.parse(readFileSync(LAST_RUN_PATH, 'utf8'));
  } catch {
    return undefined;
  }
};

class LibraryCleanup {
  public running = false;
  private cancelled = false;
  public lastRun = readLastRun();
  private candidateCache: Partial<
    Record<Kind, { at: number; candidates: CleanupCandidate[] }>
  > = {};

  public cancel() {
    this.cancelled = true;
  }

  /** Disk usage the way `df` reports it, so it matches what admins see. */
  public async diskUsage(): Promise<DiskUsage> {
    const path = getSettings().cleanup.diskPath;
    try {
      const s = await statfs(path);
      const used = (s.blocks - s.bfree) * s.bsize;
      const avail = s.bavail * s.bsize;
      return {
        path,
        usedPercent: Math.ceil((used / (used + avail)) * 100),
        totalBytes: s.blocks * s.bsize,
        freeBytes: avail,
      };
    } catch (e) {
      return { path, error: e.message };
    }
  }

  private async plex(): Promise<PlexAPI> {
    const admin = await getRepository(User).findOne({
      select: { id: true, plexToken: true },
      where: { id: 1 },
    });
    if (!admin?.plexToken) throw new Error('No Plex admin token');
    return new PlexAPI({ plexToken: admin.plexToken });
  }

  private sections(kind: Kind) {
    return getSettings().plex.libraries.filter(
      (l) => l.enabled && l.type === (kind === 'movie' ? 'movie' : 'show')
    );
  }

  private radarrs() {
    return getSettings()
      .radarr.filter((r) => !r.is4k)
      .map((server) => ({
        server,
        api: new RadarrAPI({
          apiKey: server.apiKey,
          url: RadarrAPI.buildUrl(server, '/api/v3'),
        }),
      }));
  }

  private sonarrs() {
    return getSettings()
      .sonarr.filter((s) => !s.is4k)
      .map((server) => ({
        server,
        api: new SonarrAPI({
          apiKey: server.apiKey,
          url: SonarrAPI.buildUrl(server, '/api/v3'),
        }),
      }));
  }

  /** Titles with files on disk. Daily and anime series are left alone. */
  private async arrItems(kind: Kind): Promise<ArrItem[]> {
    if (kind === 'movie') {
      const lists = await Promise.all(
        this.radarrs().map(({ api }) => api.getMovies())
      );
      return lists.flat().flatMap((m) =>
        m.hasFile && (m.sizeOnDisk ?? 0) > 0
          ? [
              {
                tmdbId: m.tmdbId,
                title: m.title,
                sizeBytes: m.sizeOnDisk ?? 0,
                year: m.year,
              },
            ]
          : []
      );
    }
    const lists = await Promise.all(
      this.sonarrs().map(({ api }) => api.getSeries())
    );
    return lists.flat().flatMap((s) =>
      s.seriesType === 'standard' && (s.statistics?.sizeOnDisk ?? 0) > 0
        ? [
            {
              tvdbId: s.tvdbId,
              title: s.title,
              sizeBytes: s.statistics?.sizeOnDisk ?? 0,
              year: s.year,
            },
          ]
        : []
    );
  }

  /**
   * Every title that may be removed right now, largest first. Rules match
   * Deleterr: nobody watched it recently, it wasn't added recently, it isn't
   * a recent release, and it doesn't carry the protected Plex label. Titles
   * someone kept or an admin protected are skipped too.
   */
  public async findCandidates(
    kind: Kind,
    { fresh = true }: { fresh?: boolean } = {}
  ): Promise<CleanupCandidate[]> {
    const cached = this.candidateCache[kind];
    if (!fresh && cached && Date.now() - cached.at < CANDIDATE_CACHE) {
      return cached.candidates;
    }

    const settings = getSettings();
    const rule: CleanupRule = settings.cleanup[kind];
    const now = Date.now();
    const sections = this.sections(kind);
    if (!sections.length) return [];

    const tautulli = new TautulliAPI(settings.tautulli);
    const plex = await this.plex();
    const lastWatched = new Map<string, number>();
    const labeled = new Set<string>();
    for (const section of sections) {
      const history = await tautulli.getLastWatchedBySection(section.id);
      history.forEach((at, key) => lastWatched.set(key, at));
      if (settings.cleanup.protectedLabel) {
        (
          await plex.getLabeledKeys(section.id, settings.cleanup.protectedLabel)
        ).forEach((k) => labeled.add(k));
      }
    }

    const items = await this.arrItems(kind);
    // An empty history for a full library means Tautulli is misconfigured,
    // not that nobody watches anything. Removing on that basis would be wrong.
    if (items.length && !lastWatched.size) {
      throw new Error(
        `Tautulli has no watch history for the ${kind} libraries; not removing anything`
      );
    }

    const media = await getRepository(Media).find({
      where: {
        mediaType: kind === 'movie' ? MediaType.MOVIE : MediaType.TV,
        status: In(AVAILABLE),
      },
      relations: { requests: true },
    });
    const byId = new Map(
      media.map((m) => [kind === 'movie' ? m.tmdbId : m.tvdbId, m])
    );

    const oldestYear = new Date().getFullYear() - rule.releaseYears;
    const candidates: CleanupCandidate[] = [];
    for (const item of items) {
      const m = byId.get(kind === 'movie' ? item.tmdbId : item.tvdbId);
      // Only titles Seerr has matched to Plex can be checked against history.
      if (!m?.ratingKey) continue;
      const state = m.cleanup?.state;
      if (state === 'protected') continue;
      if (
        state === 'kept' &&
        m.cleanup?.keptUntil &&
        new Date(m.cleanup.keptUntil).getTime() > now
      ) {
        continue;
      }
      if (labeled.has(m.ratingKey)) continue;
      const watched = lastWatched.get(m.ratingKey);
      if (watched && now - watched < rule.lastWatchedDays * DAY) continue;
      // No added date means Seerr hasn't scanned it properly; leave it alone.
      if (!m.mediaAddedAt) continue;
      // A fresh request counts as newly added, so a title someone asked for
      // again isn't picked the moment it comes back.
      const addedAt = Math.max(
        new Date(m.mediaAddedAt).getTime(),
        ...(m.requests ?? [])
          .filter((r) => !r.is4k && r.status !== MediaRequestStatus.DECLINED)
          .map((r) => new Date(r.createdAt).getTime())
      );
      if (now - addedAt < rule.addedDays * DAY) continue;
      if (item.year && item.year >= oldestYear) continue;

      candidates.push({
        mediaId: m.id,
        tmdbId: m.tmdbId,
        mediaType: kind,
        title: item.title,
        reason: {
          lastWatchedAt: watched ? new Date(watched).toISOString() : undefined,
          addedAt: new Date(addedAt).toISOString(),
          sizeBytes: item.sizeBytes,
          year: item.year,
        },
      });
    }
    candidates.sort((a, b) => b.reason.sizeBytes - a.reason.sizeBytes);
    this.candidateCache[kind] = { at: Date.now(), candidates };
    return candidates;
  }

  private async save(media: Media, cleanup: MediaCleanup | null) {
    media.cleanup = cleanup;
    await getRepository(Media).update(media.id, { cleanup });
  }

  /** Deletes the title and its files, and marks it removed in Seerr. */
  private async remove(media: Media) {
    const settings = getSettings();
    if (media.mediaType === MediaType.MOVIE) {
      const radarr =
        this.radarrs().find(({ server }) => server.id === media.serviceId) ??
        this.radarrs().find(({ server }) => server.isDefault);
      if (!radarr) throw new Error('No Radarr server');
      await radarr.api.removeMovie(media.tmdbId, {
        addImportExclusion: settings.cleanup.importExclusion,
      });
    } else {
      const sonarr =
        this.sonarrs().find(({ server }) => server.id === media.serviceId) ??
        this.sonarrs().find(({ server }) => server.isDefault);
      if (!sonarr) throw new Error('No Sonarr server');
      if (!media.tvdbId) throw new Error('No TVDB ID');
      await sonarr.api.removeSeries(media.tvdbId);
    }

    const repo = getRepository(Media);
    const fresh = await repo.findOneOrFail({ where: { id: media.id } });
    fresh.status = MediaStatus.DELETED;
    for (const season of fresh.seasons ?? []) {
      season.status = MediaStatus.DELETED;
    }
    fresh.resetServiceData(false);
    fresh.cleanup = {
      state: 'removed',
      since: new Date().toISOString(),
      reason: media.cleanup?.reason,
    };
    await repo.save(fresh);

    // Approved requests were fulfilled; leaving them open would hide the
    // Request button and block anyone from asking for the title again.
    // Listeners are off so the request subscriber doesn't re-send anything.
    const ids = (
      await getRepository(MediaRequest).find({
        select: { id: true },
        where: {
          media: { id: media.id },
          is4k: false,
          status: MediaRequestStatus.APPROVED,
        },
      })
    ).map((r) => r.id);
    if (ids.length) {
      await getRepository(MediaRequest)
        .createQueryBuilder()
        .update()
        .set({ status: MediaRequestStatus.COMPLETED })
        .whereInIds(ids)
        .callListeners(false)
        .execute();
      await getRepository(SeasonRequest)
        .createQueryBuilder()
        .update()
        .set({ status: MediaRequestStatus.COMPLETED })
        .where('"requestId" IN (:...ids)', { ids })
        .andWhere('status = :status', { status: MediaRequestStatus.APPROVED })
        .callListeners(false)
        .execute();
    }
  }

  /** Mirrors the leaving titles into each library's Plex collection. */
  public async syncCollections(kind: Kind) {
    const settings = getSettings().cleanup;
    if (settings.mode !== 'live' || !settings.collectionName) return;
    const leaving = await this.leaving(kind);
    const plex = await this.plex();
    const firstRemoval = leaving
      .map((m) => m.cleanup?.removeAt)
      .filter((d): d is string => !!d)
      .sort()[0];
    const summary = firstRemoval
      ? `Nobody has watched these in a while. They'll be removed from ${new Date(
          firstRemoval
        ).toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          timeZone: 'UTC',
        })} unless someone keeps them in Seerr.`
      : 'Nothing is leaving right now.';
    for (const section of this.sections(kind)) {
      const keys: string[] = [];
      for (const m of leaving) {
        if (!m.ratingKey) continue;
        const meta = (await plex
          .getMetadata(m.ratingKey)
          .catch(() => undefined)) as
          | { librarySectionID?: number | string }
          | undefined;
        if (String(meta?.librarySectionID) === section.id) {
          keys.push(m.ratingKey);
        }
      }
      await plex.setCollectionItems({
        sectionId: section.id,
        type: kind === 'movie' ? 'movie' : 'show',
        title: settings.collectionName,
        summary,
        ratingKeys: keys,
      });
    }
  }

  public async leaving(kind?: Kind): Promise<Media[]> {
    return this.withState('leaving', kind);
  }

  private async withState(state: string, kind?: Kind): Promise<Media[]> {
    const media = await getRepository(Media)
      .createQueryBuilder('media')
      .where('media.cleanup LIKE :state', { state: `%"state":"${state}"%` })
      .getMany();
    return media.filter(
      (m) =>
        m.cleanup?.state === state &&
        (!kind ||
          m.mediaType === (kind === 'movie' ? MediaType.MOVIE : MediaType.TV))
    );
  }

  /**
   * Daily job. In live mode: removes leaving titles whose date has come and
   * that still qualify, releases the rest, and marks the next batch once a
   * library has nothing leaving. Preview mode only reports.
   */
  public async run(): Promise<CleanupRunSummary | undefined> {
    const settings = getSettings().cleanup;
    if (settings.mode === 'off' || this.running) return;
    if (getSettings().main.mediaServerType !== MediaServerType.PLEX) {
      logger.warn('Library cleanup needs Plex and Tautulli', label);
      return;
    }
    this.running = true;
    this.cancelled = false;
    const live = settings.mode === 'live';
    const disk = await this.diskUsage();
    const known = disk.usedPercent !== undefined;
    const full = known && (disk.usedPercent ?? 0) >= settings.maxUsedPercent;
    const summary: CleanupRunSummary = {
      at: new Date().toISOString(),
      mode: live ? 'live' : 'preview',
      disk,
      marked: 0,
      removed: 0,
      released: 0,
      errors: disk.error ? [`Disk: ${disk.error}`] : [],
      wouldMark: live ? undefined : [],
    };
    logger.info(
      `Starting ${summary.mode} run; disk ${disk.usedPercent ?? '?'}% used (threshold ${settings.maxUsedPercent}%)`,
      label
    );

    try {
      if (live) await this.housekeeping();
      for (const kind of ['movie', 'tv'] as const) {
        if (this.cancelled) break;
        const rule = settings[kind];
        if (!rule.enabled) continue;
        try {
          const candidates = await this.findCandidates(kind);
          const eligible = new Set(candidates.map((c) => c.mediaId));
          const now = Date.now();

          if (!live) {
            const waiting = (await this.leaving(kind)).length;
            if (full && !waiting) {
              summary.wouldMark?.push(...candidates.slice(0, rule.batchSize));
            }
            continue;
          }

          let stillLeaving = 0;
          let removedHere = 0;
          for (const m of await this.leaving(kind)) {
            if (this.cancelled) break;
            const due =
              m.cleanup?.removeAt &&
              new Date(m.cleanup.removeAt).getTime() <= now + TOLERANCE;
            if (!AVAILABLE.includes(m.status) || (known && !full)) {
              // Gone already, or the disk has room again: nothing to warn about.
              await this.save(m, null);
              summary.released++;
            } else if (!known || !due) {
              // Can't read the disk: hold everything as it is.
              stillLeaving++;
            } else if (!eligible.has(m.id)) {
              // Watched, kept, labeled or protected since it was marked.
              logger.info(`Keeping ${m.tmdbId}: no longer qualifies`, label);
              await this.save(m, null);
              summary.released++;
            } else {
              try {
                await this.remove(m);
                summary.removed++;
                removedHere++;
                logger.info(
                  `Removed ${kind} tmdb:${m.tmdbId} (${Math.round(
                    (m.cleanup?.reason?.sizeBytes ?? 0) / 1e9
                  )} GB)`,
                  label
                );
              } catch (e) {
                stillLeaving++;
                summary.errors.push(`Removing ${m.tmdbId}: ${e.message}`);
                logger.error('Failed to remove title', {
                  ...label,
                  mediaId: m.id,
                  errorMessage: e.message,
                });
              }
            }
          }

          // After removals, wait for the next run to re-measure the disk.
          if (full && !stillLeaving && !removedHere) {
            const since = new Date().toISOString();
            const removeAt = new Date(
              now + settings.graceDays * DAY
            ).toISOString();
            for (const c of candidates.slice(0, rule.batchSize)) {
              const m = await getRepository(Media).findOne({
                where: { id: c.mediaId },
              });
              if (!m) continue;
              await this.save(m, {
                state: 'leaving',
                since,
                removeAt,
                reason: c.reason,
              });
              summary.marked++;
            }
          }

          await this.syncCollections(kind).catch((e) => {
            summary.errors.push(`Plex collection: ${e.message}`);
          });
        } catch (e) {
          summary.errors.push(`${kind}: ${e.message}`);
          logger.error('Library cleanup failed', {
            ...label,
            kind,
            errorMessage: e.message,
          });
        }
      }
    } finally {
      this.running = false;
      this.lastRun = summary;
      await writeFile(LAST_RUN_PATH, JSON.stringify(summary)).catch(() => {
        // Only the cleanup page's "last run" depends on it.
      });
      logger.info(
        `Finished: ${summary.marked} marked, ${summary.removed} removed, ${summary.released} released`,
        label
      );
    }
    return summary;
  }

  /** Expired keeps lapse; removed titles that came back are forgotten. */
  private async housekeeping() {
    const now = Date.now();
    for (const m of await this.withState('kept')) {
      if (
        !m.cleanup?.keptUntil ||
        new Date(m.cleanup.keptUntil).getTime() <= now
      ) {
        await this.save(m, null);
      }
    }
    for (const m of await this.withState('removed')) {
      if (AVAILABLE.includes(m.status)) await this.save(m, null);
    }
  }

  /** Keep, protect, or undo either, on behalf of a user. */
  public async perform(
    media: Media,
    action: CleanupAction,
    user: User
  ): Promise<MediaCleanup | null> {
    const settings = getSettings().cleanup;
    const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
    const now = new Date();
    const current = media.cleanup;
    let next: MediaCleanup | null;

    switch (action) {
      case 'keep': {
        if (!user.hasPermission([Permission.REQUEST], { type: 'or' })) {
          throw new CleanupError(403, 'You need permission to request.');
        }
        if (current?.state !== 'leaving') {
          throw new CleanupError(409, 'This title is not leaving.');
        }
        if (!isManager) {
          const mine = (await this.withState('kept')).filter(
            (m) =>
              m.cleanup?.userId === user.id &&
              new Date(m.cleanup.keptUntil ?? 0).getTime() > now.getTime()
          ).length;
          if (mine >= settings.maxKeepsPerUser) {
            throw new CleanupError(
              429,
              `You can keep up to ${settings.maxKeepsPerUser} titles at a time.`
            );
          }
        }
        next = {
          state: 'kept',
          since: now.toISOString(),
          keptUntil: new Date(
            now.getTime() + settings.keepDays * DAY
          ).toISOString(),
          userId: user.id,
          reason: current.reason,
        };
        break;
      }
      case 'unkeep':
        if (
          current?.state !== 'kept' ||
          (!isManager && current.userId !== user.id)
        ) {
          throw new CleanupError(403, 'Only whoever kept it can undo that.');
        }
        next = null;
        break;
      case 'protect':
        if (!isManager) throw new CleanupError(403, 'Managers only.');
        next = {
          state: 'protected',
          since: now.toISOString(),
          userId: user.id,
        };
        break;
      case 'unprotect':
        if (!isManager) throw new CleanupError(403, 'Managers only.');
        if (current?.state !== 'protected') return current ?? null;
        next = null;
        break;
    }

    await this.save(media, next);
    delete this.candidateCache[
      media.mediaType === MediaType.MOVIE ? 'movie' : 'tv'
    ];
    if (current?.state === 'leaving') {
      await this.syncCollections(
        media.mediaType === MediaType.MOVIE ? 'movie' : 'tv'
      ).catch((e) =>
        logger.warn('Failed to update Plex collection', {
          ...label,
          errorMessage: e.message,
        })
      );
    }
    return next;
  }
}

const libraryCleanup = new LibraryCleanup();
export default libraryCleanup;
