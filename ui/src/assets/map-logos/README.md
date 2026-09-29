# Chain logos on the supermarket map

Each file is named after the chain id it belongs to (`lib/services/regionalData/groceryChains.js`).
`ui/src/components/map/groceryIcons.js` picks up whatever `<chain id>.svg` / `.png` is in this folder,
so a logo is added by dropping a file here; a chain without one gets a coloured badge with a cart.

| File | Chain | Wikimedia Commons file | Licence on Commons |
|---|---|---|---|
| `rema.svg` | Rema 1000 | `File:Rema 1000 logo.svg` | Public domain (simple text logo), trademarked |
| `foetex.svg` | Føtex | `File:Føtex logo.svg` | Public domain (simple text logo), trademarked |
| `bilka.svg` | Bilka | `File:Bilka (Unternehmen) logo.svg` | Public domain (simple text logo), trademarked |
| `coop.svg` | Coop (Brugsen, Kvickly, Irma, 365discount) | `File:Coop Danmark logo.svg` | Public domain (simple text logo), trademarked |
| `lidl.svg` | Lidl | `File:Lidl logo.svg` | CC0 |
| `aldi.svg` | Aldi | `File:AldiWorldwideLogo.svg` | Public domain, trademarked |
| `netto.svg` | Netto | `File:NettoLogo2019-Font-S.svg` (the logo Wikidata lists for the Danish chain; credited there to www.netto.dk) | Public domain, no trademark flag on Commons |
| `meny.png` | Meny | `File:MENY logo.png` | Public domain (simple text logo), trademarked |

"Trademarked" is Commons' own warning: the copyright is free, the trademarks still belong to the
companies. They are shown here only to identify the store on the map.

## Notes

Netto's black wordmark sits on Netto's yellow rather than on white (`tile` in `groceryFilters.js`);
the yellow is the fill of the same logo's coloured variant (`NettoLogo2019-Font-G.svg`).

The German Netto Marken-Discount logo is a different company and is not used; a test guards that.
Kvickly, Irma and SuperBrugsen are covered by the Coop logo. A chain gets its own logo by dropping
`<chain id>.svg` or `.png` here; one without a file gets a coloured badge with a cart.
