// Mapbox — tiles, geocoding, and address autocomplete (decided 2026-07-05;
// see CLAUDE.md thread #9). Like the Supabase anon key, the default PUBLIC
// token is safe to ship in the client — it can only do what public tokens do.
// Never put a secret (sk.*) token here.
export const MAPBOX_TOKEN = 'MAPBOX_TOKEN_PLACEHOLDER'; // ← founder's pk.* token

export interface GeoPoint { lat: number; lng: number }

export interface GeoSuggestion {
  label: string;   // human-readable place name ("Conifer, Colorado, United States")
  lat: number;
  lng: number;
}

/** Forward-geocode with autocomplete (Mapbox Geocoding v6). Returns [] on any
 *  failure — the composer's location field degrades to plain text. */
export async function geocodeSuggest(q: string): Promise<GeoSuggestion[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  try {
    const url = 'https://api.mapbox.com/search/geocode/v6/forward'
      + `?q=${encodeURIComponent(query)}`
      + '&autocomplete=true&limit=5'
      + `&access_token=${MAPBOX_TOKEN}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn('geocodeSuggest:', res.status); return []; }
    const json = await res.json() as {
      features?: {
        properties?: { full_address?: string; name?: string; place_formatted?: string };
        geometry?: { coordinates?: [number, number] };
      }[];
    };
    return (json.features ?? [])
      .map((f) => {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const name = f.properties?.full_address
          ?? [f.properties?.name, f.properties?.place_formatted].filter(Boolean).join(', ');
        return lat != null && lng != null && name ? { label: name, lat, lng } : null;
      })
      .filter((s): s is GeoSuggestion => !!s);
  } catch (e) {
    console.warn('geocodeSuggest:', e);
    return [];
  }
}
