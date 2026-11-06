# BNA reference data

| File | Contents | Turnarounds source |
| --- | --- | --- |
| `airport.json` | Nashville International Airport identifiers, airport reference point, and the `America/Chicago` time zone | `turnarounds/hardware/registry/bna/create-airport.json` at `fdaf649795a92379ed1bc8ba4546c4fe953227b3` |
| `gates.geojson` | 52 gate points from the BNA operator survey dated August 11, 2026 | `gates` array in `turnarounds/hardware/registry/bna/bna-osm-assets.json` at `deef21e300d12842b62df43ed89fcbd05e7e3f7e` |
| `runways.geojson` | Four schematic lines connecting each runway pair’s thresholds | `BNA_RUNWAY_SOURCES` in `turnarounds/hardware/registry/bna/generate-bna-registry.ts` at `f9f2b2eb6e1f6ee9512b72ec265e3ae78ceec73e` |

All positions use decimal degrees in `[longitude, latitude]` order. Keep `properties.code` as the key for joining model inputs to gate points. Runway features use `properties.pair` as their key.

The source file has a historical name. Its `gates` array contains the operator survey, which superseded the earlier OpenStreetMap gate snapshot. The survey has 10 gates in B, 25 in C, 11 in D, and 6 in T Gates. The source inventories the C4 through C11 satellite gates under C. Gate records represent point locations. The survey supplies no gate footprints. The separately sourced OpenStreetMap apron is outside this dataset.

The airport reference point and runway thresholds come from the FAA AIP as recorded in Turnarounds. The runway lines provide schematic map context and carry no runway surface, routing, or availability information. [FAA AIP for Tennessee airports](https://www.faa.gov/air_traffic/publications/atpubs/aip_html/part3_ad_2.0_tennessee.html)

If you receive an updated Turnarounds registry file, use the included importer from the template root. It copies gate codes, coordinates, concourses, and source text to GeoJSON and writes the result to standard output. Review the new file before replacing `data/gates.geojson`, then record the new survey date and source revision here.

```sh
node scripts/import-gates.mjs /path/to/bna-osm-assets.json > gates-updated.geojson
```
