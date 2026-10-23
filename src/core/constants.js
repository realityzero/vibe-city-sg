export const WATER_LEVEL = -1.4;
export const LAT0 = 1.287, LON0 = 103.849;
export const KX = 111292.0, KZ = 110574;
/** lat/lon -> world [x, z] (x east, z south) */
export const project = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];
export const WORLD = { xmin: -3005, xmax: 3005, zmin: -2101, zmax: 2101 };
