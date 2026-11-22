// 極簡路由器：支援 :param 與 * 尾段，足夠本專案使用。

function compile(pattern) {
  const keys = [];
  const source = pattern
    .replace(/\/:([A-Za-z0-9_]+)/g, (_, key) => {
      keys.push(key);
      return '/([^/]+)';
    })
    .replace(/\*/g, '.*');
  return { regex: new RegExp(`^${source}/?$`), keys };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, options = {}) {
    const { regex, keys } = compile(pattern);
    this.routes.push({ method, regex, keys, handler, options });
    return this;
  }

  get(pattern, handler, options) {
    return this.add('GET', pattern, handler, options);
  }

  post(pattern, handler, options) {
    return this.add('POST', pattern, handler, options);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const found = route.regex.exec(pathname);
      if (!found) continue;
      const params = {};
      route.keys.forEach((key, index) => {
        params[key] = decodeURIComponent(found[index + 1] ?? '');
      });
      return { route, params };
    }
    return null;
  }
}
