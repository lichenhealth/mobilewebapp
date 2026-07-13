// Mapbox — tiles, geocoding, and address autocomplete (decided 2026-07-05;
// see CLAUDE.md thread #9). Like the Supabase anon key, the default PUBLIC
// token is safe to ship in the client — it can only do what public tokens do.
// Never put a secret (sk.*) token here.
export const MAPBOX_TOKEN = 'pk.eyJ1IjoibGljaGVuaGVhbHRoIiwiYSI6ImNtcmNmcmZndjAzaXMyem9rcWk3MXE2dzgifQ.sV8h6aqBw8HeCTTfBOVblQ';

export interface GeoPoint { lat: number; lng: number }

export interface GeoSuggestion {
  label: string;       // full place name ("320 Rustlers Rd, Bailey, Colorado 80421, United States")
  lat: number;
  lng: number;
  areaLabel?: string;  // town-level part ("Bailey, Colorado 80421, United States") — the 'area' privacy tier
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
      .map((f): GeoSuggestion | null => {
        const [lng, lat] = f.geometry?.coordinates ?? [];
        const name = f.properties?.full_address
          ?? [f.properties?.name, f.properties?.place_formatted].filter(Boolean).join(', ');
        return lat != null && lng != null && name
          ? { label: name, lat, lng, areaLabel: f.properties?.place_formatted }
          : null;
      })
      .filter((s): s is GeoSuggestion => !!s);
  } catch (e) {
    console.warn('geocodeSuggest:', e);
    return [];
  }
}
