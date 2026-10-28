import RadarrAPI from '@server/api/servarr/radarr';
import SonarrAPI from '@server/api/servarr/sonarr';
import { MediaType } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { User } from '@server/entity/User';
import { Permission } from '@server/lib/permissions';
import type {
  IssueReplacement,
  ReplacementResult,
} from '@server/lib/replacement/types';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export class ReplacementError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Admins, and users an admin trusts with it, skip the approval step. */
export const canAutoApprove = (user: User) =>
  user.hasPermission(Permission.ADMIN) ||
  !!user.settings?.autoApproveReplacements;

const pickServer = <
  T extends { id: number; isDefault: boolean; is4k: boolean },
>(
  servers: T[],
  serviceId?: number | null
) =>
  servers.find((s) => !s.is4k && s.id === serviceId) ??
  servers.find((s) => !s.is4k && s.isDefault);

/**
 * Deletes the movie's file (or the season's or episode's files), blocklists
 * the releases they came from and searches for another one. Deleting first
 * matters: with the old file still there, the arr would turn down anything
 * that isn't an upgrade on it.
 */
export const replaceFiles = async (
  issue: Issue
): Promise<ReplacementResult> => {
  const media = issue.media;
  const result: ReplacementResult = {
    blocklisted: [],
    deletedFiles: 0,
    notBlocklisted: 0,
  };

  if (media.mediaType === MediaType.MOVIE) {
    const server = pickServer(getSettings().radarr, media.serviceId);
    if (!server) throw new ReplacementError(500, 'No Radarr server is set up.');
    const radarr = new RadarrAPI({
      apiKey: server.apiKey,
      url: RadarrAPI.buildUrl(server, '/api/v3'),
    });
    const [movie] = await radarr.getLibraryMoviesByTmdbId(media.tmdbId);
    if (!movie?.id) {
      throw new ReplacementError(404, 'This movie is not in Radarr.');
    }
    const file = movie.movieFile;
    if (file) {
      const history = await radarr.getMovieHistory(movie.id);
      const imported = history.find(
        (h) =>
          h.eventType === 'downloadFolderImported' &&
          h.data?.fileId === String(file.id)
      );
      const grab = imported?.downloadId
        ? history.find(
            (h) =>
              h.eventType === 'grabbed' && h.downloadId === imported.downloadId
          )
        : undefined;
      await radarr.deleteMovieFile(file.id);
      result.deletedFiles++;
      if (grab) {
        await radarr.markHistoryFailed(grab.id);
        result.blocklisted.push(grab.sourceTitle);
      } else {
        result.notBlocklisted++;
      }
    }
    await radarr.monitorAndSearch(movie.id);
  } else {
    const seasonNumber = issue.problemSeason;
    if (!seasonNumber) {
      throw new ReplacementError(400, 'Pick the season to replace.');
    }
    const server = pickServer(getSettings().sonarr, media.serviceId);
    if (!server) throw new ReplacementError(500, 'No Sonarr server is set up.');
    if (!media.tvdbId) throw new ReplacementError(400, 'No TVDB ID.');
    const sonarr = new SonarrAPI({
      apiKey: server.apiKey,
      url: SonarrAPI.buildUrl(server, '/api/v3'),
    });
    const [series] = await sonarr.getLibrarySeriesByTvdbId(media.tvdbId);
    if (!series?.id) {
      throw new ReplacementError(404, 'This series is not in Sonarr.');
    }
    const episodes = (await sonarr.getEpisodes(series.id)).filter(
      (e) =>
        e.seasonNumber === seasonNumber &&
        (!issue.problemEpisode || e.episodeNumber === issue.problemEpisode)
    );
    if (!episodes.length) {
      throw new ReplacementError(404, 'Sonarr has no such episodes.');
    }
    const fileIds = [
      ...new Set(
        episodes.filter((e) => e.episodeFileId > 0).map((e) => e.episodeFileId)
      ),
    ];
    const history = await sonarr.getSeriesHistory(series.id, seasonNumber);
    // A season pack is one download for many files: blocklist it once.
    const downloadIds = new Set<string>();
    for (const fileId of fileIds) {
      const imported = history.find(
        (h) =>
          h.eventType === 'downloadFolderImported' &&
          h.data?.fileId === String(fileId)
      );
      if (imported?.downloadId) downloadIds.add(imported.downloadId);
      else result.notBlocklisted++;
    }
    for (const fileId of fileIds) {
      await sonarr.deleteEpisodeFile(fileId);
      result.deletedFiles++;
    }
    for (const downloadId of downloadIds) {
      const grab = history.find(
        (h) => h.eventType === 'grabbed' && h.downloadId === downloadId
      );
      if (grab) {
        await sonarr.markHistoryFailed(grab.id);
        result.blocklisted.push(grab.sourceTitle);
      } else {
        result.notBlocklisted++;
      }
    }
    const episodeIds = episodes.map((e) => e.id);
    await sonarr.monitorEpisodes(episodeIds);
    if (issue.problemEpisode) {
      await sonarr.searchEpisodes(episodeIds);
    } else {
      await sonarr.searchSeason(series.id, seasonNumber);
    }
  }

  logger.info('Replaced files', {
    label: 'File Replacement',
    issueId: issue.id,
    mediaId: media.id,
    ...result,
  });
  return result;
};

/** Runs the replacement and records how it went on the issue. */
export const runReplacement = async (
  issue: Issue,
  decidedBy: User,
  autoApproved: boolean
): Promise<IssueReplacement> => {
  const base: IssueReplacement = {
    ...(issue.replacement ?? { requestedAt: new Date().toISOString() }),
    status: 'completed',
    decidedAt: new Date().toISOString(),
    decidedBy: { id: decidedBy.id, displayName: decidedBy.displayName },
    autoApproved,
  };
  try {
    return { ...base, ...(await replaceFiles(issue)), error: undefined };
  } catch (e) {
    logger.error('Failed to replace files', {
      label: 'File Replacement',
      issueId: issue.id,
      errorMessage: e.message,
    });
    return {
      ...base,
      status: 'failed',
      error:
        e instanceof ReplacementError
          ? e.message
          : `Radarr/Sonarr returned an error: ${e.message}`,
    };
  }
};
