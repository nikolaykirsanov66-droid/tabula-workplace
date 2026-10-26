"use strict";

// Connection settings are public. Credentials stay in this browser tab and
// are stored separately for each API origin.
window.TabulaConnection = (() => {
  let origin = "", error = "";
  try {
    const config = window.TABULA_PUBLIC_CONFIG;
    if (!config || typeof config !== "object" || typeof config.apiBase !== "string") throw new Error();
    const configured = config.apiBase;
    if (configured !== configured.trim() || /[\\\s?#]/.test(configured)) throw new Error();
    if (!configured && /(?:^|\.)github\.io$/i.test(window.location.hostname)) throw new Error();
    const parsed = new URL(configured || window.location.origin);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        parsed.search || parsed.hash || parsed.pathname !== "/" ||
        (configured && parsed.protocol !== 'https:')) throw new Error();
    origin = parsed.origin;
  } catch (_) {
    error = "Адрес сервиса задан неверно. Проверьте настройки подключения.";
  }
  function requireOrigin() { if (error || !origin) throw new Error(error); return origin; }
  function tokenKey() {
    const base = requireOrigin();
    return base === window.location.origin ? "tabula_harness_token" : "tabula_harness_token:" + base;
  }
  function getToken() { try { return sessionStorage.getItem(tokenKey()) || ""; } catch (_) { return ""; } }
  function saveToken(token) { sessionStorage.setItem(tokenKey(), token); }
  function clearToken() { try { sessionStorage.removeItem(tokenKey()); } catch (_) {} }
  function apiUrl(path) {
    if (typeof path !== 'string' || !path.startsWith('/v1/') || /[\\\x00-\x20\x7f]/.test(path))
      throw new Error("Неверный адрес запроса к сервису.");
    const base = requireOrigin(), target = new URL(path, base);
    if (target.origin !== base || !target.pathname.startsWith('/v1/') || target.hash)
      throw new Error("Неверный адрес запроса к сервису.");
    return target.href;
  }
  function request(path, token, options = {}) {
    // Resolve and validate before adding Authorization. Never follow a redirect
    // with credentials, including a redirect supplied by the API itself.
    const target = apiUrl(path);
    const {json, blob, ...fetchOptions} = options;
    const headers = new Headers(fetchOptions.headers || {});
    headers.set('Authorization', 'Bearer ' + token);
    if (json !== undefined) { headers.set('Content-Type', 'application/json'); fetchOptions.body = JSON.stringify(json); }
    return fetch(target, {...fetchOptions, headers, redirect: 'error', credentials: 'omit'}).catch(failure => {
      if (failure && failure.name === 'TypeError') {
        throw new Error('Не удалось связаться с сервером. Проверьте подключение Harness и повторите запрос.');
      }
      throw failure;
    });
  }
  return Object.freeze({apiUrl, request, getToken, saveToken, clearToken});
})();
