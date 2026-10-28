import ExternalAPI from '@server/api/externalapi';
import { ApiErrorCode } from '@server/constants/error';
import type { Library, PlexSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { ApiError } from '@server/types/error';

interface PlexStatusResponse {
  MediaContainer: {
    machineIdentifier: string;
    friendlyName: string;
  };
}

export interface PlexLibraryItem {
  ratingKey: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  title: string;
  guid: string;
  parentGuid?: string;
  grandparentGuid?: string;
  addedAt: number;
  updatedAt: number;
  Guid?: {
    id: string;
  }[];
  type: 'movie' | 'show' | 'season' | 'episode';
  Media: Media[];
}

interface PlexLibraryResponse {
  MediaContainer: {
    totalSize: number;
    Metadata: PlexLibraryItem[];
  };
}

export interface PlexLibrary {
  type: 'show' | 'movie';
  key: string;
  title: string;
  agent: string;
}

interface PlexLibrariesResponse {
  MediaContainer: {
    Directory: PlexLibrary[];
  };
}

export interface PlexMetadata {
  ratingKey: string;
  parentRatingKey?: string;
  guid: string;
  type: 'movie' | 'show' | 'season';
  title: string;
  Guid: {
    id: string;
  }[];
  Children?: {
    size: 12;
    Metadata: PlexMetadata[];
  };
  index: number;
  parentIndex?: number;
  leafCount: number;
  viewedLeafCount: number;
  addedAt: number;
  updatedAt: number;
  Media: Media[];
}

interface Media {
  id: number;
  duration: number;
  bitrate: number;
  width: number;
  height: number;
  aspectRatio: number;
  audioChannels: number;
  audioCodec: string;
  videoCodec: string;
  videoResolution: string;
  container: string;
  videoFrameRate: string;
  videoProfile: string;
}

interface PlexMetadataResponse {
  MediaContainer: {
    Metadata: PlexMetadata[];
  };
}

class PlexAPI extends ExternalAPI {
  constructor({
    plexToken,
    plexSettings,
    timeout,
  }: {
    plexToken?: string | null;
    plexSettings?: PlexSettings;
    timeout?: number;
  }) {
    const settings = getSettings();
    const settingsPlex = plexSettings ?? settings.plex;

    const protocol = settingsPlex.useSsl ? 'https' : 'http';
    const baseUrl = `${protocol}://${settingsPlex.ip}:${settingsPlex.port}`;

    super(
      baseUrl,
      {},
      {
        timeout,
        headers: {
          'X-Plex-Token': plexToken ?? '',
          'X-Plex-Client-Identifier': settings.clientId,
          'X-Plex-Product': 'Seerr',
          'X-Plex-Device-Name': 'Seerr',
          'X-Plex-Platform': 'Seerr',
        },
      }
    );
  }

  public async getStatus(): Promise<PlexStatusResponse> {
    return await this.get('/');
  }

  public async getLibraries(): Promise<PlexLibrary[]> {
    const response = await this.get<PlexLibrariesResponse>('/library/sections');

    return response.MediaContainer.Directory;
  }

  public async syncLibraries(): Promise<void> {
    const settings = getSettings();

    try {
      const libraries = await this.getLibraries();

      const newLibraries: Library[] = libraries
        // Remove libraries that are not movie or show
        .filter(
          (library) => library.type === 'movie' || library.type === 'show'
        )
        // Remove libraries that do not have a metadata agent set (usually personal video libraries)
        .filter((library) => library.agent !== 'com.plexapp.agents.none')
        .map((library) => {
          const existing = settings.plex.libraries.find(
            (l) => l.id === library.key
          );

          return {
            id: library.key,
            name: library.title,
            enabled: existing?.enabled ?? false,
            type: library.type,
            lastScan: existing?.lastScan,
          };
        });

      settings.plex.libraries = newLibraries;
    } catch (e) {
      logger.error('Failed to fetch Plex libraries', {
        label: 'Plex API',
        message: e.message,
      });

      if (!e.response) {
        throw new ApiError(502, ApiErrorCode.ConnectionError);
      }

      throw new ApiError(e.response.status, ApiErrorCode.Unknown);
    }

    await settings.save();
  }

  public async getLibraryContents(
    id: string,
    { offset = 0, size = 50 }: { offset?: number; size?: number } = {}
  ): Promise<{ totalSize: number; items: PlexLibraryItem[] }> {
    const response = await this.get<PlexLibraryResponse>(
      `/library/sections/${id}/all?includeGuids=1`,
      {
        headers: {
          'X-Plex-Container-Start': `${offset}`,
          'X-Plex-Container-Size': `${size}`,
        },
      }
    );

    return {
      totalSize: response.MediaContainer.totalSize,
      items: response.MediaContainer.Metadata ?? [],
    };
  }

  public async getMetadata(
    key: string,
    options: { includeChildren?: boolean } = {}
  ): Promise<PlexMetadata> {
    const response = await this.get<PlexMetadataResponse>(
      `/library/metadata/${key}${
        options.includeChildren ? '?includeChildren=1' : ''
      }`
    );

    return response.MediaContainer.Metadata[0];
  }

  public async getChildrenMetadata(key: string): Promise<PlexMetadata[]> {
    const response = await this.get<PlexMetadataResponse>(
      `/library/metadata/${key}/children`
    );

    return response.MediaContainer.Metadata;
  }

  /** Rating keys of the items in a library that carry a label. */
  public async getLabeledKeys(
    sectionId: string,
    label: string
  ): Promise<Set<string>> {
    const labels = (
      await this.axios.get<{
        MediaContainer: { Directory?: { key: string; title: string }[] };
      }>(`/library/sections/${sectionId}/label`)
    ).data.MediaContainer.Directory;
    const match = labels?.find(
      (l) => l.title.toLowerCase() === label.toLowerCase()
    );
    if (!match) return new Set();
    const items = (
      await this.axios.get<PlexLibraryResponse>(
        `/library/sections/${sectionId}/all?label=${match.key}`
      )
    ).data.MediaContainer.Metadata;
    return new Set((items ?? []).map((i) => String(i.ratingKey)));
  }

  /**
   * Makes a manual collection hold exactly `ratingKeys`, creating it if
   * needed. An empty list empties it but keeps it.
   */
  public async setCollectionItems({
    sectionId,
    type,
    title,
    summary,
    ratingKeys,
  }: {
    sectionId: string;
    type: 'movie' | 'show';
    title: string;
    summary: string;
    ratingKeys: string[];
  }): Promise<void> {
    const { machineIdentifier } = (await this.getStatus()).MediaContainer;
    const uri = (keys: string[]) =>
      `server://${machineIdentifier}/com.plexapp.plugins.library/library/metadata/${keys.join(',')}`;
    const collections = (
      await this.axios.get<{
        MediaContainer: { Metadata?: { ratingKey: string; title: string }[] };
      }>(`/library/sections/${sectionId}/collections`)
    ).data.MediaContainer.Metadata;
    let collection = collections?.find((c) => c.title === title);

    if (!collection) {
      if (!ratingKeys.length) return;
      collection = (
        await this.axios.post<{
          MediaContainer: { Metadata: { ratingKey: string; title: string }[] };
        }>('/library/collections', null, {
          params: {
            type: type === 'movie' ? 1 : 2,
            title,
            smart: 0,
            sectionId,
            uri: uri(ratingKeys),
          },
        })
      ).data.MediaContainer.Metadata[0];
      // Show it on Home for everyone, like a recommendation row.
      await this.axios
        .post(`/hubs/sections/${sectionId}/manage`, null, {
          params: {
            metadataItemId: collection.ratingKey,
            promotedToRecommended: 1,
            promotedToOwnHome: 1,
            promotedToSharedHome: 1,
          },
        })
        .catch(() => undefined);
    } else {
      const current =
        (
          await this.axios.get<PlexLibraryResponse>(
            `/library/collections/${collection.ratingKey}/children`
          )
        ).data.MediaContainer.Metadata?.map((m) => String(m.ratingKey)) ?? [];
      for (const key of current.filter((k) => !ratingKeys.includes(k))) {
        await this.axios.delete(
          `/library/collections/${collection.ratingKey}/items/${key}`
        );
      }
      const missing = ratingKeys.filter((k) => !current.includes(k));
      if (missing.length) {
        await this.axios.put(
          `/library/collections/${collection.ratingKey}/items`,
          null,
          { params: { uri: uri(missing) } }
        );
      }
    }

    await this.axios.put(`/library/sections/${sectionId}/all`, null, {
      params: {
        type: 18,
        id: collection.ratingKey,
        'summary.value': summary,
        'summary.locked': 1,
      },
    });
  }

  public async getRecentlyAdded(
    id: string,
    options: { addedAt: number } = {
      addedAt: Date.now() - 1000 * 60 * 60,
    },
    mediaType: 'movie' | 'show'
  ): Promise<PlexLibraryItem[]> {
    const response = await this.get<PlexLibraryResponse>(
      `/library/sections/${id}/all?type=${mediaType === 'show' ? '4' : '1'}${
        // Shows are queried as episodes, whose guids the scanner never reads.
        mediaType === 'movie' ? '&includeGuids=1' : ''
      }&sort=addedAt%3Adesc&addedAt>>=${Math.floor(options.addedAt / 1000)}`,
      {
        headers: {
          'X-Plex-Container-Start': '0',
          'X-Plex-Container-Size': '500',
        },
      }
    );

    return response.MediaContainer.Metadata;
  }
}

export default PlexAPI;
