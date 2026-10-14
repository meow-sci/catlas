# System-view selection performance

Measured and corrected 2026-10-11. Selecting a body in System view caused a noticeable pause even though its authored data had not changed.

## Cause

`Viewport.tsx` included `selected` in the dependencies of its scene-construction effect. Every selection therefore scheduled the entire construction callback after 100 ms. That callback removed every scene object, disposed its geometry/material/textures, and regenerated all bodies and orbit lines.

For the default Sol system, each selection rebuilt ten bodies (one star and nine worlds). `textureFor()` calls `sampleSurface()` for every pixel of a 384 × 192 map on every world: **663,552 procedural texture samples per click**, plus terrain vertex displacement. Ocean transparency and rings were also recreated. CPU sampling showed palette evaluation, fractal noise, surface sampling, and crater evaluation dominating the callback. Palette evaluation itself copies/sorts color stops and parses colors per sample; that remains a cost of actual content generation, but selection should never invoke it.

The disposal/recreation also caused GPU resource churn; it was not simply a React inspector-render cost or an orbit-highlight material update.

## Measurements

Chromium 151.0.7922.34, headless SwiftShader, local Vite development server, 1440 × 1000 viewport. Each run selected Mars, Jupiter, and Luna in both compressed and Real scale modes. CDP CPU sampling, the PerformanceObserver long-task API, renderer object identities, and WebGL allocation hooks were collected. The same script/settings were used before and after the correction.

| Per selection, six measured selections  |            Before |       After |
| --------------------------------------- | ----------------: | ----------: |
| Bodies replaced                         |                10 |           0 |
| Textures created / deleted              |           11 / 11 |       0 / 0 |
| GPU buffers created / deleted           |           85 / 85 |       0 / 0 |
| Synchronous scene-construction callback |    382.8–391.9 ms | No callback |
| Main-thread tasks over 50 ms            | At least one each |        None |

The original 100 ms debounce was additional to callback time. These timings are local CPU observations, not hardware-GPU benchmarks or a promised end-to-end click latency. Frame-gap measurements also include profiler and software-renderer overhead: the first post-fix window still recorded a 418.6 ms frame gap without a corresponding JavaScript long task or resource rebuild. No claim about overall frame rate follows from those gaps.

Recorded summaries: [before](system-selection-before.json), [after](system-selection-after.json).

After the terrain/cloud fidelity upgrade, a [fresh six-selection profile](fidelity-selection-profile.json) retained zero replaced body meshes, zero texture/buffer creates or deletes, and no JavaScript long tasks in either scale mode. These checks establish resource reuse despite the richer shaders, not identical GPU rendering cost.

To repeat against the current code, start `npm run dev` in one terminal and run:

```sh
node scripts/profile-system-selection.mjs /tmp/system-selection.json
```

`PROFILE_URL` can override `http://127.0.0.1:5173`. The script launches and closes its own browser, uses a fresh project context, and does not change exported content. It measures the current implementation; the before-summary preserves the earlier implementation's measurements.

## Correction and regression coverage

System-view scene generation depends on authored system data and rendering options. Selected-body data remains a dependency only in Body/Rocks views, where selecting another body genuinely changes the generated preview. System-view selection now updates existing orbit-line colors in a separate effect, while the camera continues following the selection. Delayed scene construction reads the latest selection so fast clicks do not leave stale highlighting.

Camera browser regressions now compare object, geometry, material, and texture identities across selections in both scale modes, wait past the former debounce window, and verify the correct orbit color and camera focus. They also edit a body's radius to verify that actual authored changes still rebuild the preview and retain highlighting. This tests resource reuse directly rather than relying on timing thresholds that vary by machine.
