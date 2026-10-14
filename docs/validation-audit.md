# Validation audit

Audited 2026-10-11 against the current Orbit Foundry source and research notes. This records application-level checks and source comparisons; it is not a KSA game smoke test.

**Native test and follow-up:** the user reported a startup crash with the original defaults plus Luna rings. The source trace and regenerated exports identify a zero-byte ocean-culling allocation caused by the absence of any in-use ocean mesh. Ocean authoring now exports an actual default Earth ocean with the generated mesh reference; the warning popup explains the startup requirement for entirely dry collections. Old projects preserve their dry content on import. The original checks missed this native initialization invariant; see the [full diagnosis and correction](research/ocean-buffer-startup-crash.md). The user subsequently confirmed the baseline was working. The additional fidelity features described below have not been exercised in the native game.

## Detailed stock models, ground cover and GLB imports

Final verification passed **92 unit tests across 15 files**, the TypeScript/Vite production build, and **28 Chromium journeys** across the integrated run and a corrected test rerun. The final canopy publication also passed all 14 stock-specific checks again. One aggregate geometry audit exceeded the old five-second test timeout after the library grew to 125 meshes; its timeout is now 20 seconds without reducing coverage. The import-budget browser test was corrected to use the app's loaded module URLs after development-server live updates, then passed on that same server; runtime behavior and assertions were unchanged.

The final embedded registry is **33,852,071 bytes**, and production JavaScript is approximately **34.97 MB minified / 20.86 MB gzip**. Vite reports a bundle-size advisory. This is the cost of embedding the detailed library for self-contained operation; geometry decoding remains lazy and material caching is bounded. The editable scoped Blender source is 38,037,306 bytes and includes packed preview maps.

The expanded original library contains 25 models and 125 native LOD meshes. The checks cover packed geometry decoding, measured metre bounds, finite unit normals, outward closed components, open foliage face orientation, nondegenerate UV tangent frames, atlas tile boundaries and complete mesh/material/texture references. Stock models use 512px surface maps; foliage silhouettes and ground-cover thickness maps have independent channel checks. The grass research and native foliage flags are documented in [ground-cover research](research/ground-cover.md).

Dense grass previews use up to 4,096 clumps, with an adaptive detail level and a 600,000-triangle ceiling. Browser testing exposed an initially empty 20 m patch because it was centered inside launch-site vegetation clearance. The initial patch now starts beside the pad; a regression test verifies both the exclusion and the nearby populated patch. Four ground-cover specimens have 48–62 triangles in their farthest LOD. Larger stock objects keep a smaller instance cap.

Imported GLBs preserve multiple materials, embedded images, transformed geometry and source alpha thresholds. Tests verify native per-material vertex compaction, project roundtrips, browser previews, undo/redo and native archive closure. IndexedDB tests cover saved data beyond localStorage's quota, storage failure with downloadable recovery, delayed writes and fallback precedence. Collection-wide budget tests reject oversized imports and duplicates without replacing the current project; delayed imports cannot overwrite a different selected model or reopened collection. See [imported model contracts and limits](research/imported-clutter.md).

The [production offline smoke check](research/stock-production-smoke.json) cold-loaded the built app at `/foundry/`, then disconnected the browser from the network, selected meadow grass, imported a textured two-material GLB and exported the collection. The archive contained 564 entries / 5,143,095 bytes with no missing texture/model paths, external requests, failed responses or browser errors. This verifies offline editing/export after loading, not an offline cold-start guarantee.

The editable Blender scene and source generators are in [stock library research](research/stock-assets.md). Browser close-ups of all 25 models and eight physical ground-cover patches are recorded under `docs/screenshots/stock-detail/`, with zero captured page/WebGL errors. The 5 m meadow preview drew 316 clumps against approximately 319 eligible; the 20 m sample drew 2,465 clumps with a disclosed sampling cap. All eight ground-cover previews stayed below 600,000 triangles. These assets and the new imported/foliage export paths still require an in-game visual check; the source and browser checks do not establish a native rendering match.

## Earlier fidelity upgrade acceptance

Final integrated verification passed: **68 unit tests across 13 files**, the TypeScript/Vite production build, and **all 18 Chromium tests** in 46 seconds, without retries. Browser coverage includes stock asset authoring/export, native weather and site resources, pointer placement/cancellation, physical scatter and zero-density behavior, and the earlier ocean, simulation, camera and scene-reuse regressions. Separate final screenshot captures reported zero page or console errors.

The stock JSON import includes an explicit JSON module attribute so direct Node imports used by Playwright work as well as Vite. The embedded original model library makes the production JavaScript approximately **7.58 MB minified / 1.315 MB gzip**, producing Vite's bundle-size advisory; no external runtime asset service is introduced.

Native contract checks now cover normalized biome IDs and blended controls, Y-up/native Z-up geography, height-derived tangent normals, independent ground/slope materials, five distinct clutter LODs, cloud mask/detail/profile/flow channels, launch-pad mesh/material/collision links, and looping PCM sound assets. Import tests cover missing-field migration, malformed new fields, case-insensitive ID collisions and memory preflight.

The original Blender library is checked across eight models and five LODs: finite data, physical bounds, nondegenerate palette UVs, unit normals and outward component winding. This review caught inward-wound orb foliage and inverted thin components after decimation; the source generator now corrects both. The library was additionally created and inspected in live Blender, then authored through the browser with zero page/console errors. See [stock sources and gallery](research/stock-assets.md).

The upgraded atmosphere preview and Jupiter belts were inspected in Chromium; an earlier woven belt artifact was traced to the gas color sampler and corrected. The current [cloud preview](screenshots/clouds.png) uses original broad belts and seeded storms. Browser previews remain approximate.

The [updated selection profile](research/fidelity-selection-profile.json) retains zero replaced bodies and zero GPU texture/buffer allocations across six body selections in both scale modes. There were no selection-triggered JavaScript long tasks. Software-rendered frame gaps include warmup/profiler overhead and are not a native GPU frame-rate claim.

The [512px Earth export measurement](research/fidelity-export-512.json) generated 42 assets / 57,777,282 bytes in 3,649ms. There were 177 timer ticks and a maximum 78ms timer gap with preview GPU work excluded. Row-budgeted generation, sequential bodies and a conservative 384 MiB preflight bound large exports; asset counts and time depend on authored content.

The following sections preserve historical checks and findings from earlier revisions. Current feature contracts and limits are in the [fidelity matrix](research/fidelity-upgrade-plan.md), [terrain research](research/surface-fidelity.md), [atmosphere research](research/atmosphere-fidelity.md), [location research](research/surface-locations.md), and [audio research](research/environment-audio.md).

## Original automated checks

- `npm test` passed: 3 test files, 11 tests.
- `npm run build` passed: TypeScript project build and Vite production build. The final build transformed 1,799 modules and emitted `dist/index.html`, one JavaScript bundle, and one CSS bundle.
- `npm run test:browser` passed: three Chromium journeys exercise repeated undo/redo, artistic edits, identifier/parent updates, moons, binary stars, simulation, save/reload/import, ZIP export, malformed imports, invalid input, narrow layouts, blank collections, and system deletion.

## Ocean and simulation follow-up

The follow-up adds model/XML regression coverage for authored oceans, legacy imports, dry collection warnings, and starter plus Luna rings. Native tests check the ocean’s reference to a registered, nonempty generated mesh collection and its required height map, rather than merely checking for an arbitrary `<Ocean>` tag. A separate .NET 10 serializer reproduction established that XML-supplied ocean density becomes NaN in this build; the exporter omits it to preserve the working constructor default.

Real-scale orbital helpers use a common physical scale for body radii, paths, root offsets, and rings. Unit checks compare physical ratios, shared body/path positions, binary barycentric distances, camera bounds, and long-horizon Kepler solving. Browser checks exercise authored ocean save/import/export, collection warnings, legacy projects, the Real scale toggle, and adjustable simulation range/endpoints.

Follow-up verification passed: **24 unit tests in 4 files**, the TypeScript/Vite production build, and **8 Chromium journeys** (the original 3 plus 5 ocean/simulation tests). The new tests also listen for WebGL/shader console errors. Screenshot checks at 390px and 620px found no horizontal overflow and kept the export and simulation-limit controls reachable; supplemental screenshots produced no page errors or console errors. `docs/screenshots/ocean.png` and `real-scale.png` record the revised views. These remain browser/source checks, not a native game test.

The subsequent selected-body camera correction passed the production build, all 24 unit tests, and **all 10 Chromium journeys**. Two new camera tests inspect actual rendered body/camera transforms via Three's devtools observation hook, checking that the selected planet/moon stays at screen center after selection, time scrubbing, playback, time/camera reset, resizing, and switching views, in both compressed and real scale. They also verify that scrubbing preserves camera distance and direction relative to the body and that no browser/console errors occur.

The selection-performance correction also passed the production build, all 24 unit tests, and all 10 Chromium journeys. Camera tests now assert that selecting another body preserves scene object, geometry, material, and texture identities while changing orbit highlighting; authored radius edits still regenerate content. A separate six-selection CPU/WebGL profile confirmed removal of the approximately 383–392 ms full-scene rebuild and all selection-triggered texture/buffer allocations. See the [measurement report and reproducible profiler](research/system-selection-performance.md) for before/after data and timing limits.

## Baseline source-verified findings

- `src/lib/export.ts` writes all editor system tabs as body trees in one `<System>` document, uses generated `PlanetMeshes.xml` and `Assets.xml`, and places generated files under the paths referenced by the XML. It checks the `Path` references in the system and asset XML against the generated file map before packaging. This matches the combined-system and archive-closure descriptions in `docs/research/game-format.md`, `docs/research/assets.md`, and `docs/research/runtime-loader-audit.md`.
- `src/lib/assets.ts` emits six-face KTX2 cubemaps with mip levels for surface maps, R16 height maps for rocky bodies, PNG terrain/ring/material maps, and a generated GLB for clutter or rings. The face order, channel values, path names, and conditional asset generation match the descriptions in `docs/research/assets.md`. The asset tests parse KTX2 output and check distinct R16 faces, PNG dimensions/data, GLB headers and mesh names.
- `src/lib/types.ts` includes authored atmosphere values and per-body display names. Temperature, molar mass, and surface gravity derive the exported physical scale height. Adiabatic index remains project metadata, and the glow color is preview-only; native visual rendering uses scattering coefficients. Native body XML uses generated IDs without a body display-name field. The generated README documents these distinctions.
- No HTTP(S) URL, CDN reference, `fetch`, WebSocket, EventSource, or XMLHttpRequest appears in `src`, `public`, `index.html`, the package manifest, or Vite config. `public` is empty, and the production output contains only the app HTML, JavaScript, and CSS. No Core texture or model files are copied into the app's runtime assets; the generated KSA textures and model are created by `src/lib/assets.ts` during export. Research documentation refers to Core files as evidence, not as runtime dependencies.

## Independent browser and production checks

A separate Chromium audit passed eleven checks with zero page errors: repeated undo, ring controls, advancing orbital time, adding a system/binary/atmospheric world, saving four systems, downloaded ZIP path closure, autosave restoration, and desktop/phone document-width checks. It found the StrictMode history duplication issue and verified its correction. The browser-generated test archive contained 216 entries and no missing XML paths.

The production bundle was cold-loaded through a temporary static server at `/foundry/`, verifying relative URLs for subdirectory hosting. All responses succeeded and no external HTTP requests were attempted. After the browser context was switched completely offline, editing a surface seed and exporting the starter collection still succeeded. The downloaded ZIP was 709,395 bytes at draft resolution, with zero page errors. This proves operation after loading, not an offline cold-start guarantee.

Screenshots under `docs/screenshots/` record the final desktop, rings, generated rock, and phone previews. They show the approximate browser renderer, not the native KSA renderer.

## Native-game verification boundary

The checks above verify TypeScript compilation, unit tests, XML syntax/path closure in the tests, and the structure of generated KTX2/PNG/GLB data. They do not verify that KSA build `2026.10.10.5554` successfully deserializes and loads a complete generated mod, or that native rendering, physics, clutter placement, rings, and atmospheres behave as intended. Those remain source-based expectations pending a game smoke test. The research notes and generated README already state this boundary; this audit found no source/documentation mismatch that changes it.
