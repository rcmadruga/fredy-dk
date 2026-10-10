# Ideas (undecided)

**Nothing in this file is decided or planned.** These are brainstorm notes from 2026-10-10, kept so
they are not lost. An idea moves into a real plan only after the user picks it and its open questions
are answered.

---

## Reviewed in some detail

### A day in this home

For each listing, a timeline of a real weekday, built from real journeys: leave 07:42, work 08:15,
pick-up 16:30, groceries 17:05, gym. A one-line summary could go on the roulette card ("4 h 10 min
travel per weekday").

- **Tech:** Transitous (already used for travel times) chained over several legs. Places come from
  the OpenStreetMap place types travel times already use. 5–8 routing calls per listing per day
  profile, so only filtered listings, swept in the background and cached.
- **Open:**
  - one shared household day or one per person (and does a child count)?
  - fixed times, or "arrive by" worked backwards?
  - the travel mode per leg?
  - a weekend profile?
  - should total travel time feed the score's Work group?

### Sun and light

Hours of direct sun per facade or terrace in June, March and December, plus what shades it.

- **Tech:** Danish Height Model surface data and building footprints from Dataforsyningen (free,
  needs a token), the sun's path computed locally, ray-cast over a small grid, cached. Germany would
  need other data (state LiDAR).
- **Hard part:** we know the building, not the flat. The floor and window orientation are usually
  unknown; sometimes Boligsiden or the advert text gives the floor ("3. sal").
- **Open:**
  - is a building-level answer useful at all?
  - terrace only, or every facade?
  - which months?
  - a score metric ("light")?
  - register for a Dataforsyningen token?

### Floor-plan reading

A vision model reads the floor-plan image (Boligsiden's `floorPlanImages`, stored as `floorPlanUrl`)
into rooms with estimated sizes. That answers "does our 3 m sofa fit" and "is there an office room".

- **Tech:** a local vision model on the Ollama machine (Qwen2.5-VL or Llama 3.2 Vision class), JSON
  output checked against a schema. Sizes are read from printed m² labels where present, else from
  scale. Runs once per listing, in the background.
- **Open:**
  - GPU on the Ollama machine (CPU means minutes per image)?
  - a furniture list?
  - the office-room threshold in m²?
  - rentals too (they rarely have plans)?
  - a score metric ("layout fit")?

### Photo forensics

A vision model reviews the advert's photos and flags concerns, never a verdict:
- no bathroom photo
- wide-angle exaggeration
- virtually staged furniture
- photos removed or changed between a listing and its relisting

- **Tech:** the same vision model classifies each photo (room type, staging, lens distortion); missing
  room types are checked per listing. Perceptual hashes stored per listing make relistings comparable.
  20–40 photos per listing, so filtered listings only. Natural home: extra signals in the scam
  detection.
- **Open:**
  - which listings to cover (all, or only watched or high-score)?
  - which flags matter?
  - do flags lower the Deal score or stay informational?
  - store photo hashes?

**Shared by the last two:** they need the Ollama link that the roulette plan introduces, and the
machine's GPU/VRAM decides whether they are practical.

---

## Mentioned, not reviewed

- **"Gone in N days" predictor:** learn time-to-gone from the alive-checker history; an urgency tag
  on new listings, especially rentals.
- **Negotiation intel:** realtor ratings and sales percentages (Boligsiden), days on market,
  drops and relists, giving "this realtor's listings drop ~4 % after 60 days".
- **Health check for owners' associations (ejerforening):** the LLM reads the association's accounts (a PDF upload)
  for debt, reserves and planned major works.
- **What's coming nearby:** Danish local plans (Plandata.dk) for new construction, roads and metro
  near the listing. Notes from a later discussion:
  - **Example, Odense (illustrative, plan numbers invented):** a card "within 1 km" listing a local
    plan proposal for 120 flats 180 m away with its consultation deadline, an adopted school extension
    650 m away, and a business-zoned framework 900 m away. Each row is turned into "what it means for
    you" (shade, traffic, construction years).
  - **Example, Nordsjælland, 3400 Hillerød (illustrative, unverified):** a large district-plan
    proposal ~400 m away (homes, school, shops), the hospital and station already built nearby, and a
    state road project (Hillerød motorway extension) in planning. The point: here the card is about
    what is coming soon, and it needs state infrastructure projects as a second source next to the
    kommune plans.
  - **Volume:** Plandata held over 35,000 local plans and about 50,000 municipal plan frameworks as
    of 2021. Only current proposals and recent adoptions matter.
  - **Caching:** as a map layer, scoped to the kommuner the user's jobs search (Nordsjælland is about
    10 kommuner, a few thousand polygons), filtered and simplified, stored as FlatGeobuf (already a
    dependency, spatially indexed) under `/db` with the other regional caches. One cache feeds both the
    map layer and the per-listing "near this point" card. Refreshed weekly by date through Plandata's
    WFS/REST service; the weekly diff enables "new proposal near a watched listing" alerts.
  - **To verify first:** Plandata's endpoint, rate limits and licence.
- **Back-testing filters:** replay a job's history to show what given settings would have caught and
  what became of those homes.

## Moonshots

- **Fredy's own valuation model:** a price model per area, trained on the earlier-sale records
  Boligsiden sends for every address (dates, prices, areas, BBR facts, energy label, position). Each
  listing gets "fair price ~X kr. (±Y %)", a feature that sits right beside the asking price.
- **A network of Fredy instances:** self-hosted instances share anonymised facts with each other, never
  listings or users: how fast homes go, actual rents paid, sale outcomes, scam reports. Opt-in,
  peer-to-peer or through a tiny relay, with privacy by aggregation.
- **A 3D walk-through before the viewing:** reconstruct the home from the advert's photos and floor
  plan (Gaussian splatting or a floor-plan-to-3D model), and walk through it in the browser. Place your
  own furniture at true scale, from the furniture list in floor-plan reading.
- **Fair-rent check (DK):** much Danish rental housing built before 1992 is rent-regulated (cost-based
  or value-based rent, and the Huslejenævn rent tribunals). From the building year (BBR), the
  kommune's regulation status and the rent per m², flag rentals that are likely above the legal
  level, with what that means for a claim or a negotiation.
- **Viewing companion:** at a viewing, the phone records voice notes and photos; the local LLM
  transcribes them into the buying checklist ("damp smell in the basement", "windows from 1990") and
  attaches them to the listing, so viewings can be compared side by side afterwards.
- **Life after the purchase:** Fredy keeps working once you've bought: watches Danish mortgage-bond
  prices for a conversion that pays (omlægning), reminds you of the property-tax notices, and tracks
  what similar homes nearby sell for, so you know your own home's value.
- **The neighbourhood through time:** Dataforsyningen's historical aerial photos (orthophotos by
  year) as a time slider on the map. See how the area changed, what was built, and where water
  stood in wet years.
