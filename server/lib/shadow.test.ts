import RadarrAPI from '@server/api/servarr/radarr';
import { ShadowModeError } from '@server/lib/shadow';
import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

class TestRadarrAPI extends RadarrAPI {
  public sent: string[] = [];

  public constructor() {
    super({ url: 'http://radarr:7878/api/v3', apiKey: 'test' });
    const adapter: AxiosAdapter = async (config) => {
      this.sent.push(`${config.method?.toUpperCase()} ${config.url}`);
      return {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config: config as InternalAxiosRequestConfig,
        request: {},
      } as AxiosResponse;
    };
    this.axios.defaults.adapter = adapter;
  }

  public write() {
    return this.axios.delete('/movie/1', { params: { deleteFiles: true } });
  }
}

describe('shadow mode', () => {
  afterEach(() => {
    delete process.env.SHADOW_MODE;
  });

  it('lets writes through when off', async () => {
    const radarr = new TestRadarrAPI();
    await radarr.write();
    assert.deepEqual(radarr.sent, ['DELETE /movie/1']);
  });

  it('blocks writes to Radarr when on, and never sends them', async () => {
    process.env.SHADOW_MODE = 'true';
    const radarr = new TestRadarrAPI();
    await assert.rejects(radarr.write(), ShadowModeError);
    // searchMovie logs failures instead of throwing; it must still not send.
    await radarr.searchMovie(1).catch(() => undefined);
    assert.deepEqual(radarr.sent, []);
  });

  it('still allows reads when on', async () => {
    process.env.SHADOW_MODE = 'true';
    const radarr = new TestRadarrAPI();
    await radarr.getMovies();
    assert.deepEqual(radarr.sent, ['GET /movie']);
  });
});
