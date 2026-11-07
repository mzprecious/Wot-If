const ALLOWED_SYMBOLS = new Set([
  "ACCESSCORP.XNSA",
  "GTCO.XNSA",
  "MTNN.XNSA",
  "ZENITHBANK.XNSA",
  "DANGCEM.XNSA",
  "NGXGROUP.XNSA"
]);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);

    if (url.pathname !== "/api/eodhd") {
      return env.ASSETS.fetch(request);
    }

    const symbol = String(url.searchParams.get("symbol") || "").toUpperCase();
    const year = Number(url.searchParams.get("year"));
    const currentYear = new Date().getUTCFullYear();

    if (!ALLOWED_SYMBOLS.has(symbol)) {
      return json({ error: "Unsupported stock symbol" }, 400);
    }

    if (!Number.isInteger(year) || year < 2010 || year > currentYear) {
      return json({ error: "Unsupported year" }, 400);
    }

    if (!env.EODHD_API_TOKEN) {
      return json({ error: "EODHD_API_TOKEN is not configured" }, 500);
    }

    const cache = caches.default;
    const cacheKey = new Request(`${url.origin}/api/eodhd?symbol=${symbol}&year=${year}`);
    const cachedResponse = await cache.match(cacheKey);

    if (cachedResponse) {
      return withCors(cachedResponse);
    }

    const today = new Date().toISOString().slice(0, 10);
    const params = new URLSearchParams({
      from: `${year}-01-01`,
      to: today,
      period: "d",
      api_token: env.EODHD_API_TOKEN,
      fmt: "json"
    });
    const eodhdUrl = `https://eodhd.com/api/eod/${encodeURIComponent(symbol)}?${params.toString()}`;
    const eodhdResponse = await fetch(eodhdUrl, {
      headers: {
        Accept: "application/json"
      }
    });

    if (!eodhdResponse.ok) {
      return json({ error: "EODHD request failed" }, eodhdResponse.status);
    }

    const rows = await eodhdResponse.json();

    if (!Array.isArray(rows) || rows.length === 0) {
      return json({ error: "No prices found" }, 404);
    }

    const firstRow = rows.find((row) => toNumber(row.close) > 0);
    const lastRow = [...rows].reverse().find((row) => toNumber(row.close) > 0);

    if (!firstRow || !lastRow) {
      return json({ error: "No usable close prices found" }, 404);
    }

    const response = json({
      symbol,
      year,
      buyPrice: toNumber(firstRow.close),
      buyDate: firstRow.date || `${year}-01-01`,
      todayPrice: toNumber(lastRow.close),
      todayDate: lastRow.date || today,
      source: "EODHD"
    }, 200, {
      "Cache-Control": "public, max-age=43200"
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function withCors(response) {
  const next = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([key, value]) => {
    next.headers.set(key, value);
  });
  next.headers.set("X-Wot-If-Cache", "HIT");
  return next;
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
      ...headers
    }
  });
}
