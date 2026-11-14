// JuanSkip - Plugin de marcas de tiempo e intros para Kino
// Fuentes: AniSkip (Anime) y TheIntroDB (Series y Películas)

const THEINTRODB_API = "https://api.theintrodb.org/v4/media";
const ANISKIP_API = "https://api.aniskip.com/v2/skip-times";
const ANILIST_API = "https://graphql.anilist.co";

function isEnabled(key, defaultValue = true) {
  try {
    if (typeof kino !== "undefined" && kino && kino.config && typeof kino.config.get === "function") {
      const val = kino.config.get(key);
      if (typeof val === "boolean") return val;
    }
  } catch (_) {}
  return defaultValue;
}

// 1. Obtener marcas de tiempo desde TheIntroDB
async function fetchTheIntroDB(params) {
  const { isEpisode, imdbId, tmdbId, tvdbId, season, episode, durationMs } = params;
  const searchParams = [];

  if (imdbId && /^tt\d{5,10}$/.test(imdbId)) {
    searchParams.push("imdb_id=" + encodeURIComponent(imdbId));
  } else if (tmdbId && Number.isInteger(Number(tmdbId)) && Number(tmdbId) > 0) {
    searchParams.push("tmdb_id=" + encodeURIComponent(tmdbId));
  } else if (tvdbId && Number.isInteger(Number(tvdbId)) && Number(tvdbId) > 0) {
    searchParams.push("tvdb_id=" + encodeURIComponent(tvdbId));
  } else {
    return [];
  }

  if (isEpisode) {
    if (typeof season === "number") searchParams.push("season=" + encodeURIComponent(season));
    if (typeof episode === "number") searchParams.push("episode=" + encodeURIComponent(episode));
  }

  const url = THEINTRODB_API + "?" + searchParams.join("&");
  const res = await kino.fetch(url, { headers: { Accept: "application/json" } });
  if (!res || !res.ok) return [];

  const data = await res.json();
  if (!data || typeof data !== "object") return [];

  const segments = [];
  const typeMap = {
    intro: "intro",
    recap: "recap",
    credits: "credits",
    preview: "preview",
  };

  for (const [key, kinoType] of Object.entries(typeMap)) {
    const list = data[key];
    if (!Array.isArray(list)) continue;

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const rawStart = item.start_ms;
      const rawEnd = item.end_ms;

      const startMs = rawStart != null && Number.isFinite(Number(rawStart)) ? Math.round(Number(rawStart)) : 0;
      let endMs = rawEnd != null && Number.isFinite(Number(rawEnd)) ? Math.round(Number(rawEnd)) : null;

      if (endMs === null) {
        if (durationMs && durationMs > startMs) {
          endMs = Math.round(durationMs);
        } else {
          // Estimación para créditos finales si el API no especifica fin
          endMs = startMs + 90000;
        }
      }

      if (startMs >= 0 && endMs - startMs >= 1000) {
        segments.push({
          type: kinoType,
          startMs,
          endMs,
        });
      }
    }
  }

  return segments;
}

// 2. Resolver MyAnimeList ID mediante AniList GraphQL si no viene en los metadatos
async function resolveMalId(anilistId, showTitle) {
  try {
    let query = "";
    let variables = {};

    if (anilistId && Number.isInteger(Number(anilistId))) {
      query = "query ($id: Int) { Media(id: $id, type: ANIME) { idMal } }";
      variables = { id: Number(anilistId) };
    } else if (showTitle && typeof showTitle === "string" && showTitle.trim().length > 1) {
      query = "query ($search: String) { Media(search: $search, type: ANIME) { idMal } }";
      variables = { search: showTitle.trim() };
    } else {
      return null;
    }

    const res = await kino.fetch(ANILIST_API, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!res || !res.ok) return null;
    const body = await res.json();
    return body?.data?.Media?.idMal || null;
  } catch (_) {
    return null;
  }
}

// 3. Obtener marcas de tiempo desde AniSkip
async function fetchAniSkip(params) {
  const { malId, anilistId, showTitle, episode, durationMs } = params;
  if (!episode || typeof episode !== "number" || episode <= 0) return [];

  let finalMalId = malId;
  if (!finalMalId && (anilistId || showTitle)) {
    finalMalId = await resolveMalId(anilistId, showTitle);
  }

  if (!finalMalId) return [];

  const episodeLength = durationMs && durationMs > 0 ? Math.round(durationMs / 1000) : 0;
  const url = `${ANISKIP_API}/${encodeURIComponent(finalMalId)}/${encodeURIComponent(episode)}?types=op&types=ed&types=mixed-op&types=mixed-ed&types=recap&episodeLength=${episodeLength}`;

  const res = await kino.fetch(url, { headers: { Accept: "application/json" } });
  if (!res || !res.ok) return [];

  const data = await res.json();
  if (!data || !data.found || !Array.isArray(data.results)) return [];

  const segments = [];
  for (const item of data.results) {
    if (!item || !item.interval) continue;
    const { startTime, endTime } = item.interval;
    if (typeof startTime !== "number" || typeof endTime !== "number") continue;

    const startMs = Math.round(startTime * 1000);
    const endMs = Math.round(endTime * 1000);

    if (startMs < 0 || endMs - startMs < 1000) continue;

    let type = null;
    if (item.skipType === "op" || item.skipType === "mixed-op") {
      type = "intro";
    } else if (item.skipType === "ed" || item.skipType === "mixed-ed") {
      // Un outro realista debe estar en la segunda mitad del episodio o al menos tras 3 minutos
      if (startMs > 180000 || (durationMs && startMs > durationMs * 0.4)) {
        type = "outro";
      }
    } else if (item.skipType === "recap") {
      type = "recap";
    }

    if (type) {
      segments.push({ type, startMs, endMs });
    }
  }

  return segments;
}

// Normalización, unificación de recaps con intros y eliminación de solapamientos
function cleanSegments(list, durationMs) {
  const validTypes = ["intro", "outro", "recap", "credits", "preview"];
  const whole = (v) => typeof v === "number" && Number.isInteger(v);
  const knownDuration = Number.isInteger(durationMs) && durationMs > 0;

  const valid = [];
  for (const seg of list) {
    if (!seg || typeof seg !== "object") continue;
    if (!validTypes.includes(seg.type)) continue;
    if (!whole(seg.startMs) || !whole(seg.endMs)) continue;
    if (seg.startMs < 0) continue;

    let end = seg.endMs;
    if (knownDuration) {
      if (seg.startMs >= durationMs) continue;
      end = Math.min(end, durationMs);
    }

    if (end - seg.startMs < 1000) continue;
    valid.push({ type: seg.type, startMs: seg.startMs, endMs: end });
  }

  // Soporte para saltar resumen/recap ("Previamente en..."):
  // Como Kino solo activa el botón "Saltar intro" para segments de tipo "intro",
  // si el episodio tiene un recap al inicio:
  const intros = valid.filter((s) => s.type === "intro");
  const earlyRecap = valid.find(
    (s) => s.type === "recap" && s.startMs < 180000 && s.endMs > s.startMs
  );

  if (earlyRecap) {
    if (intros.length === 0) {
      // Si la serie no tiene intro registrada pero sí recap, promoverlo a intro para activar el botón
      valid.push({ type: "intro", startMs: earlyRecap.startMs, endMs: earlyRecap.endMs });
    } else {
      // Si la intro empieza justo al terminar el recap (o casi contigua), expandir la intro
      const firstIntro = intros.sort((a, b) => a.startMs - b.startMs)[0];
      if (firstIntro.startMs >= earlyRecap.startMs && firstIntro.startMs <= earlyRecap.endMs + 5000) {
        firstIntro.startMs = earlyRecap.startMs;
      }
    }
  }

  // Ordenar cronológicamente por inicio
  valid.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  // Evitar solapamientos del mismo tipo y limitar a 10 segmentos
  const kept = [];
  for (const seg of valid) {
    const overlaps = kept.some(
      (k) => k.type === seg.type && seg.startMs < k.endMs && k.startMs < seg.endMs
    );
    if (overlaps) continue;
    kept.push(seg);
    if (kept.length >= 10) break;
  }

  return kept;
}

// Exportación principal para Kino
export async function segments(query) {
  if (!query || typeof query !== "object") return [];

  const isEpisode = query.kind === "episode" || (typeof query.season === "number" && typeof query.episode === "number");
  const showIds = query.show?.ids || {};
  const queryIds = query.ids || {};

  const imdbId = queryIds.imdb || showIds.imdb || (typeof query.imdbId === "string" ? query.imdbId : null);
  const tmdbId = queryIds.tmdb || showIds.tmdb || (typeof query.tmdbId === "number" ? query.tmdbId : null);
  const tvdbId = queryIds.tvdb || showIds.tvdb;
  const malId = queryIds.mal || showIds.mal;
  const anilistId = queryIds.anilist || showIds.anilist;
  let showTitle = query.show?.title || query.title || null;
  const durationMs = query.durationMs && Number.isInteger(query.durationMs) && query.durationMs > 0 ? query.durationMs : null;

  const season = typeof query.season === "number" ? query.season : null;
  const episode = typeof query.episode === "number" ? query.episode : null;

  // Si no tenemos título pero sí TMDB ID y es una serie, consultar kino.tmdb para facilitar la búsqueda en AniSkip
  if (!showTitle && !malId && !anilistId && tmdbId && isEpisode) {
    if (typeof kino !== "undefined" && kino && typeof kino.tmdb === "function") {
      try {
        const tmdbData = await kino.tmdb("/tv/" + encodeURIComponent(tmdbId));
        if (tmdbData && (tmdbData.original_name || tmdbData.name)) {
          showTitle = tmdbData.original_name || tmdbData.name;
        }
      } catch (_) {}
    }
  }

  const enableTheIntroDB = isEnabled("enable_theintrodb", true);
  const enableAniSkip = isEnabled("enable_aniskip", true);

  const fetchTasks = [];

  // AniSkip si es un episodio y está habilitado
  if (isEpisode && enableAniSkip && (malId || anilistId || showTitle)) {
    fetchTasks.push(
      fetchAniSkip({ malId, anilistId, showTitle, episode, durationMs }).catch(() => [])
    );
  }

  // TheIntroDB si está habilitado y tenemos algún identificador
  if (enableTheIntroDB && (imdbId || tmdbId || tvdbId)) {
    fetchTasks.push(
      fetchTheIntroDB({ isEpisode, imdbId, tmdbId, tvdbId, season, episode, durationMs }).catch(() => [])
    );
  }

  if (fetchTasks.length === 0) return [];

  const results = await Promise.all(fetchTasks);
  const combined = results.flat();

  return cleanSegments(combined, durationMs);
}
