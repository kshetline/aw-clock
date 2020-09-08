import { ExtendedRequestOptions, requestJson as byRequestJson, requestText as byRequestText } from 'by-request';
import { format } from 'url';

interface CachedJson {
  content?: any;
  maxAgeInSeconds: number;
  time: number;
}

const cache = new Map<string, CachedJson>();
const pendingRequests = new Map<string, Promise<any>>();

export function purgeCache(urlMatcher: string | RegExp): void {
  Array.from(cache.keys()).forEach(key => {
    if (urlMatcher instanceof RegExp) {
      if (urlMatcher.test(key))
        cache.delete(key);
    }
    else if (key.includes(urlMatcher))
      cache.delete(key);
  });
}

export function requestJson(maxAgeInSeconds: number,
    urlOrOptions: string | ExtendedRequestOptions, options?: ExtendedRequestOptions): Promise<any> {
  return requestContent(maxAgeInSeconds, true, undefined, urlOrOptions, options);
}

export function requestText(maxAgeInSeconds: number,
    url: string, options: ExtendedRequestOptions, encoding?: string): Promise<string> {
  return requestContent(maxAgeInSeconds, false, encoding, url, options);
}

function requestContent(maxAgeInSeconds: number, asJson: boolean, encoding: string,
    urlOrOptions: string | ExtendedRequestOptions, options?: ExtendedRequestOptions): Promise<any> {
  const now = Date.now() / 1000;
  const key = (typeof urlOrOptions === 'string' ? urlOrOptions : format(urlOrOptions));

  // Purge outdated cache items
  Array.from(cache.keys()).forEach(key => {
    const item = cache.get(key);

    if (item.time + item.maxAgeInSeconds < now)
      cache.delete(key);
  });

  if (pendingRequests.has(key))
    return pendingRequests.get(key);
  else if (cache.has(key))
    return Promise.resolve(cache.get(key).content);

  const promise = asJson ? byRequestJson(urlOrOptions, options) : byRequestText(urlOrOptions as string, options, encoding);

  cache.set(key, { maxAgeInSeconds, time: now });
  pendingRequests.set(key, promise);

  promise.then(content => {
    pendingRequests.delete(key);
    cache.get(key).content = content;
  }).catch(() => {
    pendingRequests.delete(key);
    cache.delete(key);
  });

  return promise;
}
