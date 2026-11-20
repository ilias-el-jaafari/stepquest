import type { BBox, LatLon } from '../geo/geo.ts'

/** Bundled offline area: Benicalap, Valencia (about 3.2 × 3.2 km). */
export const DEMO_AREA: { name: string; center: LatLon; bbox: BBox; defaultStart: LatLon; defaultEnd: LatLon } = {
  name: 'Benicalap, València',
  center: { lat: 39.4935, lon: -0.392 },
  bbox: { south: 39.479, west: -0.4105, north: 39.508, east: -0.3735 },
  defaultStart: { lat: 39.4935, lon: -0.392 },
  // Near the Turia gardens' north edge, about 2 km south-east.
  defaultEnd: { lat: 39.4825, lon: -0.3800 },
}

/** Overpass QL for an area (live mode). The fixture was built from an equivalent query over DEMO_AREA.bbox. */
export function overpassQuery(b: BBox, timeoutS = 60): string {
  const box = `${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)}`
  return `[out:json][timeout:${timeoutS}];
(
  way["highway"](${box});
  way["building"](${box});
  way["leisure"~"park|garden|pitch|playground|dog_park|common|recreation_ground"](${box});
  way["landuse"~"grass|recreation_ground|meadow|farmland|orchard|forest|village_green|allotments|cemetery|reservoir|basin"](${box});
  way["natural"~"water|wood|scrub|grassland|heath"](${box});
  way["waterway"](${box});
  way["water"](${box});
);
out geom qt;`
}
