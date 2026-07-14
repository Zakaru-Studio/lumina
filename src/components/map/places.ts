/**
 * A compact, bundled gazetteer of major world cities for the map's background
 * labels. Fully offline (no tiles, no geocoding service) and tiny — a few
 * kilobytes — so it costs nothing at runtime beyond a one-time projection.
 *
 * Each entry is `[name, lon, lat, minK]` where `minK` is the smallest map zoom
 * factor at which the label may appear, so the world view stays uncluttered and
 * detail fills in as you zoom. Coordinates are the city centre in degrees
 * (`lon` east-positive, `lat` north-positive). Regions/countries are labelled
 * separately from the bundled Natural Earth country shapes (see `geo.ts`).
 */

/** A city label source record (unprojected). */
export interface City {
  name: string;
  lon: number;
  lat: number;
  /** Minimum zoom factor `k` at which the label becomes eligible. */
  minK: number;
}

// [name, lon, lat, minK] — grouped by region for easier auditing. Tiers:
//   2  = global-scale cities (appear as soon as you leave the world view)
//   4  = major capitals / metros
//   8  = secondary cities
const RAW: [string, number, number, number][] = [
  // North America
  ["New York", -74.01, 40.71, 2],
  ["Los Angeles", -118.24, 34.05, 2],
  ["Mexico City", -99.13, 19.43, 2],
  ["Chicago", -87.63, 41.88, 2],
  ["Toronto", -79.38, 43.65, 2],
  ["San Francisco", -122.42, 37.77, 4],
  ["Washington", -77.04, 38.91, 4],
  ["Miami", -80.19, 25.76, 4],
  ["Houston", -95.37, 29.76, 4],
  ["Seattle", -122.33, 47.61, 4],
  ["Vancouver", -123.12, 49.28, 4],
  ["Montréal", -73.57, 45.5, 4],
  ["Boston", -71.06, 42.36, 8],
  ["Atlanta", -84.39, 33.75, 8],
  ["Dallas", -96.8, 32.78, 8],
  ["Denver", -104.99, 39.74, 8],
  ["Phoenix", -112.07, 33.45, 8],
  ["Philadelphia", -75.16, 39.95, 8],
  ["San Diego", -117.16, 32.72, 8],
  ["Calgary", -114.07, 51.05, 8],
  ["Guadalajara", -103.35, 20.66, 8],
  ["Monterrey", -100.32, 25.69, 8],
  ["Havana", -82.38, 23.11, 8],
  ["Panamá", -79.52, 8.98, 8],
  ["Guatemala City", -90.51, 14.63, 8],

  // South America
  ["São Paulo", -46.63, -23.55, 2],
  ["Buenos Aires", -58.38, -34.6, 2],
  ["Rio de Janeiro", -43.2, -22.91, 2],
  ["Lima", -77.04, -12.05, 4],
  ["Bogotá", -74.07, 4.71, 4],
  ["Santiago", -70.65, -33.45, 4],
  ["Brasília", -47.93, -15.78, 8],
  ["Caracas", -66.9, 10.49, 8],
  ["Medellín", -75.56, 6.25, 8],
  ["Quito", -78.52, -0.18, 8],
  ["Montevideo", -56.16, -34.9, 8],
  ["Salvador", -38.51, -12.97, 8],
  ["Fortaleza", -38.54, -3.73, 8],

  // Europe
  ["London", -0.13, 51.51, 2],
  ["Paris", 2.35, 48.86, 2],
  ["Moscow", 37.62, 55.75, 2],
  ["Madrid", -3.7, 40.42, 2],
  ["Berlin", 13.4, 52.52, 2],
  ["Rome", 12.5, 41.9, 2],
  ["Istanbul", 28.98, 41.01, 2],
  ["Amsterdam", 4.9, 52.37, 4],
  ["Barcelona", 2.17, 41.39, 4],
  ["Milan", 9.19, 45.46, 4],
  ["Vienna", 16.37, 48.21, 4],
  ["Brussels", 4.35, 50.85, 4],
  ["Munich", 11.58, 48.14, 4],
  ["Lisbon", -9.14, 38.72, 4],
  ["Warsaw", 21.01, 52.23, 4],
  ["Kyiv", 30.52, 50.45, 4],
  ["Prague", 14.42, 50.09, 4],
  ["Stockholm", 18.07, 59.33, 4],
  ["Dublin", -6.26, 53.35, 4],
  ["Athens", 23.73, 37.98, 4],
  ["Zürich", 8.54, 47.37, 8],
  ["Copenhagen", 12.57, 55.68, 8],
  ["Oslo", 10.75, 59.91, 8],
  ["Helsinki", 24.94, 60.17, 8],
  ["Budapest", 19.04, 47.5, 8],
  ["Bucharest", 26.1, 44.43, 8],
  ["Saint Petersburg", 30.34, 59.93, 8],
  ["Frankfurt", 8.68, 50.11, 8],
  ["Hamburg", 10.0, 53.55, 8],
  ["Manchester", -2.24, 53.48, 8],
  ["Lyon", 4.83, 45.76, 8],
  ["Marseille", 5.37, 43.3, 8],
  ["Naples", 14.27, 40.85, 8],
  ["Porto", -8.61, 41.15, 8],
  ["Kraków", 19.94, 50.06, 8],
  ["Belgrade", 20.46, 44.79, 8],

  // Africa
  ["Cairo", 31.24, 30.04, 2],
  ["Lagos", 3.38, 6.52, 2],
  ["Johannesburg", 28.05, -26.2, 2],
  ["Nairobi", 36.82, -1.29, 4],
  ["Casablanca", -7.59, 33.57, 4],
  ["Cape Town", 18.42, -33.92, 4],
  ["Addis Ababa", 38.74, 9.03, 4],
  ["Accra", -0.19, 5.6, 8],
  ["Kinshasa", 15.27, -4.44, 8],
  ["Luanda", 13.23, -8.84, 8],
  ["Dar es Salaam", 39.28, -6.79, 8],
  ["Khartoum", 32.53, 15.5, 8],
  ["Algiers", 3.06, 36.75, 8],
  ["Tunis", 10.18, 36.81, 8],
  ["Dakar", -17.44, 14.72, 8],
  ["Abidjan", -4.02, 5.36, 8],

  // Middle East & Central Asia
  ["Dubai", 55.27, 25.2, 2],
  ["Riyadh", 46.72, 24.63, 4],
  ["Tehran", 51.39, 35.69, 4],
  ["Tel Aviv", 34.78, 32.08, 4],
  ["Baghdad", 44.36, 33.31, 8],
  ["Doha", 51.53, 25.29, 8],
  ["Abu Dhabi", 54.37, 24.45, 8],
  ["Jeddah", 39.2, 21.49, 8],
  ["Ankara", 32.85, 39.93, 8],
  ["Amman", 35.93, 31.95, 8],
  ["Kuwait City", 47.98, 29.38, 8],
  ["Tashkent", 69.24, 41.31, 8],
  ["Almaty", 76.95, 43.24, 8],

  // South & Southeast Asia
  ["Delhi", 77.1, 28.7, 2],
  ["Mumbai", 72.88, 19.08, 2],
  ["Singapore", 103.82, 1.35, 2],
  ["Bangkok", 100.5, 13.76, 2],
  ["Jakarta", 106.85, -6.21, 2],
  ["Karachi", 67.01, 24.86, 4],
  ["Dhaka", 90.41, 23.81, 4],
  ["Bengaluru", 77.59, 12.97, 4],
  ["Kolkata", 88.36, 22.57, 4],
  ["Manila", 120.98, 14.6, 4],
  ["Kuala Lumpur", 101.69, 3.14, 4],
  ["Chennai", 80.27, 13.08, 8],
  ["Hyderabad", 78.47, 17.38, 8],
  ["Lahore", 74.34, 31.55, 8],
  ["Ho Chi Minh City", 106.66, 10.82, 8],
  ["Hanoi", 105.83, 21.03, 8],
  ["Yangon", 96.2, 16.87, 8],

  // East Asia
  ["Tokyo", 139.69, 35.68, 2],
  ["Shanghai", 121.47, 31.23, 2],
  ["Beijing", 116.41, 39.9, 2],
  ["Hong Kong", 114.17, 22.32, 2],
  ["Seoul", 126.98, 37.57, 2],
  ["Osaka", 135.5, 34.69, 4],
  ["Guangzhou", 113.26, 23.13, 4],
  ["Shenzhen", 114.06, 22.54, 4],
  ["Taipei", 121.56, 25.03, 4],
  ["Chengdu", 104.07, 30.57, 8],
  ["Chongqing", 106.55, 29.56, 8],
  ["Wuhan", 114.31, 30.59, 8],
  ["Xi'an", 108.94, 34.34, 8],
  ["Tianjin", 117.2, 39.13, 8],
  ["Nagoya", 136.91, 35.18, 8],
  ["Busan", 129.08, 35.18, 8],
  ["Sapporo", 141.35, 43.06, 8],

  // Oceania
  ["Sydney", 151.21, -33.87, 2],
  ["Melbourne", 144.96, -37.81, 4],
  ["Auckland", 174.76, -36.85, 4],
  ["Brisbane", 153.03, -27.47, 8],
  ["Perth", 115.86, -31.95, 8],
];

/** The bundled city gazetteer, sorted so more-prominent cities win label slots. */
export const CITIES: City[] = RAW.map(([name, lon, lat, minK]) => ({ name, lon, lat, minK })).sort(
  (a, b) => a.minK - b.minK,
);
