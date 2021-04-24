import { ExtendedRequestOptions, requestJson as byRequestJson, requestText as byRequestText } from 'by-request';
import { format } from 'url';
import { isString, toBoolean } from '@tubular/util';
import { timeStamp } from './awcs-util';

interface CachedJson {
  content?: any;
  maxAgeInSeconds: number;
  time: number;
}

const cache = new Map<string, CachedJson>();
const pendingRequests = new Map<string, Promise<any>>();
const log = toBoolean(process.env.AWC_LOG_CACHE_ACTIVITY);

function filterUrl(url: string): string {
  return url.replace(/(?<=\?key=)\w+(?=&)/, '...').replace(/(?<=\/forecast\/)[0-9A-F]+(?=\/)/i, '...')
    .replace(/(?<=&id=)\w+(?=[& ])/, '...');
}

export function purgeCache(urlMatcher: string | RegExp): void {
  Array.from(cache.keys()).forEach(key => {
    if (urlMatcher instanceof RegExp) {
      if (urlMatcher.test(key)) {
        cache.delete(key);

        if (log)
          console.info(timeStamp(), 'cleared from cache:', filterUrl(key));
      }
    }
    else if (key.includes(urlMatcher)) {
      cache.delete(key);

      if (log)
        console.info(timeStamp(), 'cleared from cache:', filterUrl(key));
    }
  });
}

export async function requestJson(maxAgeInSeconds: number,
    urlOrOptions: string | URL, options?: ExtendedRequestOptions): Promise<any> {
  return requestContent(maxAgeInSeconds, true, undefined, urlOrOptions, options);
}

export async function requestText(maxAgeInSeconds: number,
    url: string, options: ExtendedRequestOptions, encoding?: string): Promise<string> {
  return requestContent(maxAgeInSeconds, false, encoding, url, options);
}

function requestContent(maxAgeInSeconds: number, asJson: boolean, encoding: string,
    urlOrOptions: string | URL, options?: ExtendedRequestOptions): Promise<any> {
  const now = Date.now() / 1000;
  const key = (isString(urlOrOptions) ? urlOrOptions : format(urlOrOptions));

  // Purge outdated cache items
  Array.from(cache.keys()).forEach(key => {
    const item = cache.get(key);

    if (item.time + item.maxAgeInSeconds < now) {
      cache.delete(key);

      if (log)
        console.info(timeStamp(), 'aged out of cache:', filterUrl(key));
    }
  });

  if (pendingRequests.has(key))
    return pendingRequests.get(key);
  else if (cache.has(key)) {
    if (log)
      console.info(timeStamp(), 'from cache:', filterUrl(key));

    return Promise.resolve(cache.get(key).content);
  }

  if (log)
    console.info(timeStamp(), 'fresh request:', filterUrl(key));

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
