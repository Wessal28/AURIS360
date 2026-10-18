# Environmental emissions factor provenance

Reference: [DESNZ 2026 greenhouse-gas conversion factors](https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-2026), revised flat file published 31 July 2026. Verified against the official workbook on 18 October 2026.

Workbook: https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx

SHA-256: `a9a455ab396dae226d510c7be6233748416d490c41a5d20f3dc7a0c45feecd5e`

All rows below are from **Factors by Category → Scope 1 → Fuels**, total **kg CO2e**, excluding well-to-tank and other upstream emissions.

| Application type | Exact source fuel | Source row ID | Unit | Value |
|---|---|---|---|---:|
| diesel | Diesel (100% mineral diesel) | 1_101_1012_8_1 | litres | 2.66155 |
| petrol | Petrol (100% mineral petrol) | 1_101_1018_8_1 | litres | 2.35372 |
| lpg | LPG | 1_100_1003_8_1 | litres | 1.55713 |
| natural_gas | Natural gas (100% mineral blend) | 1_100_1005_1_1 | cubic metres | 2.04987 |
| heavy_fuel_oil | Fuel oil | 1_101_1013_8_1 | litres | 3.17492 |

These are UK reference assumptions, not a statement that they are approved for a particular company's fuel grade or location. A user must select the source and confirm applicability. New records default to no estimate. Electricity has no implicit UK-grid default; supplier/local factors require a value, source, year/version, evidence URL and explicit confirmation. A zero factor is accepted only when explicitly supplied with that evidence, rather than treating a missing value as zero.

Each saved estimate retains its factor, unit, source, source version, scope, evidence URL and applicability confirmation. Historic unverified estimates are preserved when opened and saved unchanged. Changing their activity inputs requires selecting a sourced factor or explicitly omitting the estimate. Dashboard/export coverage must disclose records with missing or unconfirmed factors.

The calculation is activity quantity × factor, rounded to two decimal places in kg CO2e. The database checks the same arithmetic and validates the fixed reference values when the DESNZ source is claimed.
