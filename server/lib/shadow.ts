import logger from '@server/logger';
import type { InternalAxiosRequestConfig } from 'axios';

/**
 * Shadow mode runs a second instance next to a production one, against the
 * same Radarr, Sonarr and Plex, without changing anything outside its own
 * database. It is set with SHADOW_MODE=true and can't be changed at runtime.
 *
 * While it is on:
 * - Radarr, Sonarr and Plex clients refuse every request except GET and HEAD.
 * - No notifications or emails are sent.
 * - Plex watchlist sync doesn't run (it would create requests).
 * - Library cleanup never runs live, whatever its configured mode.
 */
export const isShadowMode = (): boolean =>
  ['true', '1'].includes((process.env.SHADOW_MODE ?? '').toLowerCase());

export class ShadowModeError extends Error {
  public constructor(method: string, url: string) {
    super(`Shadow mode: blocked ${method} ${url}`);
    this.name = 'ShadowModeError';
  }
}

const READ_METHODS = ['get', 'head'];

/** Axios request interceptor that refuses writes in shadow mode. */
export const shadowReadOnlyInterceptor = (
  config: InternalAxiosRequestConfig
): InternalAxiosRequestConfig => {
  const method = (config.method ?? 'get').toLowerCase();
  if (!isShadowMode() || READ_METHODS.includes(method)) {
    return config;
  }
  const url = `${config.baseURL ?? ''}${config.url ?? ''}`.replace(
    /([?&]apikey=)[^&]*/i,
    '$1***'
  );
  // Arr commands (searches) are all POST /command; name the command.
  const command =
    config.data && typeof config.data === 'object' && 'name' in config.data
      ? ` (${String(config.data.name)})`
      : '';
  logger.warn(`Would ${method.toUpperCase()} ${url}${command}`, {
    label: 'Shadow Mode',
  });
  throw new ShadowModeError(method.toUpperCase(), url);
};
