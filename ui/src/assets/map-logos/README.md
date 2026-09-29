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
| `meny.png` | Meny | `File:MENY logo.png` | Public domain (simple text logo), trademarked |

"Trademarked" is Commons' own warning: the copyright is free, the trademarks still belong to the
companies. They are shown here only to identify the store on the map.

## Missing on purpose

**Netto** has no logo file. Commons holds only the German Netto Marken-Discount logo, which is a
different company; a logo drawn from memory would be worse than none. Add `netto.svg` or `netto.png`
here and it is used automatically. Kvickly, Irma and SuperBrugsen are covered by the Coop logo.
