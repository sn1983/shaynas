import { request } from './http.js';

/**
 * Downloads the on-air XML. A cache-busting parameter is added by default: the
 * feed sits on blob storage behind a CDN, and a cached copy would mean missing
 * the song that is playing right now.
 */
export async function fetchFeed(url, { nocache = true, ...options } = {}) {
  const target = new URL(url);
  if (nocache) target.searchParams.set('_', String(Date.now()));
  const response = await request(target, {
    headers: {
      accept: 'application/xml, text/xml, */*',
      'cache-control': 'no-cache',
      'user-agent': 'glglz-artist-watch/1.0 (+https://github.com/)',
    },
    ...options,
  });
  return response.text();
}
