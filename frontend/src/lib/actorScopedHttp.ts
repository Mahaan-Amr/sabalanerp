import { AxiosHeaders, type AxiosInstance, type AxiosRequestConfig } from 'axios';

export type RequestClient = Pick<AxiosInstance, 'get' | 'post' | 'put' | 'patch' | 'delete'>;

const scopeChanged = () => Object.assign(new Error('نشست این صفحه تغییر کرده است.'), { code: 'AUTH_CONTEXT_CHANGED' });

/** Keep requests from retained UI callbacks attached to their original actor. */
export function bindActorRequests(client: RequestClient, userId: string, readGeneration: () => number | undefined): RequestClient {
  const configFor = (config?: AxiosRequestConfig): AxiosRequestConfig => ({
    ...config,
    headers: config?.headers instanceof AxiosHeaders
      ? config.headers.concat({ 'x-sabalan-expected-user': userId })
      : { ...config?.headers, 'x-sabalan-expected-user': userId },
  });
  const run = async <T>(request: () => Promise<T>) => {
    const generation = readGeneration();
    if (generation === undefined) throw scopeChanged();
    const assertCurrent = () => {
      if (generation !== readGeneration()) throw scopeChanged();
    };
    const response = await request().catch(error => {
      assertCurrent();
      throw error;
    });
    assertCurrent();
    return response;
  };
  return {
    get: (url, config) => run(() => client.get(url, configFor(config))),
    post: (url, data, config) => run(() => client.post(url, data, configFor(config))),
    put: (url, data, config) => run(() => client.put(url, data, configFor(config))),
    patch: (url, data, config) => run(() => client.patch(url, data, configFor(config))),
    delete: (url, config) => run(() => client.delete(url, configFor(config))),
  };
}
