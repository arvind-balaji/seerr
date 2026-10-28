import TheMovieDb from '@server/api/themoviedb';
import { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import type { User } from '@server/entity/User';
import libraryCleanup from '@server/lib/cleanup';
import type {
  CleanupCandidate,
  CleanupItem,
  CleanupResponse,
} from '@server/lib/cleanup/types';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';
import { In } from 'typeorm';

const NEXT_IN_LINE = 20;
const RECENTLY_REMOVED = 50;

const cleanupRoutes = Router();

/** Adds the title, year and poster from TMDB (cached) to each title. */
const describe = async (
  media: Media[],
  isManager: boolean,
  candidates: Map<number, CleanupCandidate> = new Map()
): Promise<CleanupItem[]> => {
  const tmdb = new TheMovieDb();
  return Promise.all(
    media.map(async (m) => {
      const item: CleanupItem = {
        mediaId: m.id,
        tmdbId: m.tmdbId,
        mediaType: m.mediaType === MediaType.MOVIE ? 'movie' : 'tv',
        title: candidates.get(m.id)?.title ?? `TMDB ${m.tmdbId}`,
        cleanup: m.cleanup,
        candidate: candidates.get(m.id),
      };
      try {
        if (m.mediaType === MediaType.MOVIE) {
          const movie = await tmdb.getMovie({ movieId: m.tmdbId });
          item.title = movie.title;
          item.year = Number(movie.release_date?.slice(0, 4)) || undefined;
          item.posterPath = movie.poster_path ?? undefined;
          item.backdropPath = movie.backdrop_path ?? undefined;
        } else {
          const show = await tmdb.getTvShow({ tvId: m.tmdbId });
          item.title = show.name;
          item.year = Number(show.first_air_date?.slice(0, 4)) || undefined;
          item.posterPath = show.poster_path ?? undefined;
          item.backdropPath = show.backdrop_path ?? undefined;
        }
      } catch {
        // Keep the fallback title.
      }
      if (isManager) {
        item.requestedBy = (m.requests ?? [])
          .filter((r) => !r.is4k && r.requestedBy)
          .map((r) => ({
            id: r.requestedBy.id,
            displayName: r.requestedBy.displayName,
          }));
      }
      return item;
    })
  );
};

const withRequests = (ids: number[]) =>
  ids.length
    ? getRepository(Media).find({
        where: { id: In(ids) },
        relations: { requests: { requestedBy: true } },
      })
    : Promise.resolve([] as Media[]);

const byDate =
  (field: 'removeAt' | 'since' | 'keptUntil', dir: 1 | -1) =>
  (a: CleanupItem, b: CleanupItem) =>
    dir * (a.cleanup?.[field] ?? '').localeCompare(b.cleanup?.[field] ?? '');

cleanupRoutes.get<never, CleanupResponse>('/', async (req, res, next) => {
  try {
    const settings = getSettings().cleanup;
    const user = req.user as User;
    const isManager = user.hasPermission(Permission.MANAGE_REQUESTS);
    const repo = getRepository(Media);
    const all = (
      await repo
        .createQueryBuilder('media')
        .where('media.cleanup IS NOT NULL')
        .getMany()
    ).filter((m) => m.cleanup);
    const inState = (state: string) =>
      all.filter((m) => m.cleanup?.state === state).map((m) => m.id);
    const now = Date.now();

    const response: CleanupResponse = {
      mode: settings.mode,
      graceDays: settings.graceDays,
      keepDays: settings.keepDays,
      maxKeepsPerUser: settings.maxKeepsPerUser,
      myKeeps: all.filter(
        (m) =>
          m.cleanup?.state === 'kept' &&
          m.cleanup.userId === user.id &&
          new Date(m.cleanup.keptUntil ?? 0).getTime() > now
      ).length,
      // Leaving Soon is only public once cleanup actually acts.
      leaving: req.query.summary
        ? []
        : settings.mode === 'live' || isManager
          ? (
              await describe(await withRequests(inState('leaving')), isManager)
            ).sort(byDate('removeAt', 1))
          : [],
    };

    if (isManager && settings.mode !== 'off' && !req.query.summary) {
      let nextInLineError: string | undefined;
      const candidates: CleanupCandidate[] = [];
      for (const kind of ['movie', 'tv'] as const) {
        if (!settings[kind].enabled) continue;
        try {
          candidates.push(
            ...(
              await libraryCleanup.findCandidates(kind, { fresh: false })
            ).filter((c) => !inState('leaving').includes(c.mediaId))
          );
        } catch (e) {
          nextInLineError = e.message;
        }
      }
      candidates.sort((a, b) => b.reason.sizeBytes - a.reason.sizeBytes);
      const top = candidates.slice(0, NEXT_IN_LINE);
      const removedIds = all
        .filter((m) => m.cleanup?.state === 'removed')
        .sort((a, b) =>
          (b.cleanup?.since ?? '').localeCompare(a.cleanup?.since ?? '')
        )
        .slice(0, RECENTLY_REMOVED)
        .map((m) => m.id);

      response.manager = {
        disk: await libraryCleanup.diskUsage(),
        maxUsedPercent: settings.maxUsedPercent,
        lastRun: libraryCleanup.lastRun,
        nextInLine: (
          await describe(
            await withRequests(top.map((c) => c.mediaId)),
            true,
            new Map(top.map((c) => [c.mediaId, c]))
          )
        ).sort(
          (a, b) =>
            (b.candidate?.reason.sizeBytes ?? 0) -
            (a.candidate?.reason.sizeBytes ?? 0)
        ),
        nextInLineError,
        kept: (await describe(await withRequests(inState('kept')), true)).sort(
          byDate('keptUntil', 1)
        ),
        protected: (
          await describe(await withRequests(inState('protected')), true)
        ).sort(byDate('since', -1)),
        removed: (await describe(await withRequests(removedIds), true)).sort(
          byDate('since', -1)
        ),
      };
    }

    return res.status(200).json(response);
  } catch (e) {
    logger.error('Failed to load cleanup status', {
      label: 'Library Cleanup',
      errorMessage: e.message,
    });
    return next({ status: 500, message: 'Failed to load cleanup status.' });
  }
});

export default cleanupRoutes;
