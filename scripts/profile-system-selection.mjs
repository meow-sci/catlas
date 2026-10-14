// Run against a local dev server: node scripts/profile-system-selection.mjs [report.json]
import { chromium } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const browser = await chromium.launch({
  headless: true,
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => {
    window.selectionProfile = { gpu: {}, longTasks: [], timers: [], bodies: {}, frameGaps: [] };
    const stats = window.selectionProfile;
    for (const name of ["createTexture", "deleteTexture", "createBuffer", "deleteBuffer"]) {
      const original = WebGL2RenderingContext.prototype[name];
      WebGL2RenderingContext.prototype[name] = function (...args) {
        stats.gpu[name] = (stats.gpu[name] ?? 0) + 1;
        return original.apply(this, args);
      };
    }
    new PerformanceObserver((list) => {
      stats.longTasks.push(...list.getEntries().map(({ duration }) => duration));
    }).observe({ type: "longtask", buffered: false });
    const setTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay, ...args) {
      if (typeof fn !== "function") return setTimeout(fn, delay, ...args);
      return setTimeout(() => {
        const start = performance.now();
        try {
          fn(...args);
        } finally {
          const duration = performance.now() - start;
          if (duration > 10) stats.timers.push({ delay, duration });
        }
      }, delay);
    };
    window.__THREE_DEVTOOLS__ = {
      dispatchEvent(event) {
        const renderer = event.detail;
        if (!renderer?.isWebGLRenderer) return;
        const render = renderer.render.bind(renderer);
        let lastFrame = 0;
        renderer.render = (scene, camera) => {
          const now = performance.now();
          if (lastFrame) stats.frameGaps.push(now - lastFrame);
          lastFrame = now;
          render(scene, camera);
          stats.bodies = Object.fromEntries(
            scene.children
              .filter((body) => body.userData.overview)
              .map((body) => [body.userData.bodyId, body.uuid]),
          );
        };
      },
    };
  });
  await page.goto(process.env.PROFILE_URL ?? "http://127.0.0.1:5173");
  await page.getByRole("button", { name: "System", exact: true }).click();
  await page.waitForTimeout(1500);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 1000 });
  const reports = [];
  for (const realScale of [false, true]) {
    if (realScale) {
      await page.getByRole("button", { name: "View options", exact: true }).click();
      await page.getByRole("switch", { name: "Real scale" }).check();
      await page.getByRole("button", { name: "Close dialog" }).click();
      await page.waitForTimeout(1500);
    }
    for (const body of ["Mars", "Jupiter", "Luna"]) {
      const before = await page.evaluate(() => {
        const stats = window.selectionProfile;
        const previous = { gpu: { ...stats.gpu }, bodies: { ...stats.bodies } };
        stats.longTasks = [];
        stats.timers = [];
        stats.frameGaps = [];
        return previous;
      });
      await cdp.send("Profiler.start");
      await page.locator(".body-row").filter({ hasText: body }).click();
      await page.waitForTimeout(700);
      const { profile } = await cdp.send("Profiler.stop");
      const after = await page.evaluate(() => window.selectionProfile);
      const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
      const cpu = {};
      for (let i = 0; i < profile.samples.length; i++) {
        const frame = nodes.get(profile.samples[i]);
        if (!frame?.url.includes("/src/")) continue;
        const name = `${frame.functionName || "(anonymous)"} (${frame.url.split("/src/")[1].split("?")[0]})`;
        cpu[name] = (cpu[name] ?? 0) + profile.timeDeltas[i] / 1000;
      }
      reports.push({
        scale: realScale ? "real" : "compressed",
        body,
        replacedBodies: Object.keys(before.bodies).filter(
          (id) => before.bodies[id] !== after.bodies[id],
        ).length,
        gpuCalls: Object.fromEntries(
          Object.keys(after.gpu).map((key) => [key, after.gpu[key] - (before.gpu[key] ?? 0)]),
        ),
        longTasksMs: after.longTasks.map((ms) => Number(ms.toFixed(1))),
        slowTimers: after.timers.map(({ delay, duration }) => ({
          delayMs: delay,
          durationMs: Number(duration.toFixed(1)),
        })),
        maxFrameGapMs: Number(Math.max(0, ...after.frameGaps).toFixed(1)),
        cpuSelfMs: Object.fromEntries(
          Object.entries(cpu)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([name, ms]) => [name, Number(ms.toFixed(1))]),
        ),
      });
    }
  }
  const text = JSON.stringify(
    {
      browser: await browser.version(),
      renderer: "Chromium SwiftShader; timings are local measurements, not hardware GPU benchmarks",
      reports,
    },
    null,
    2,
  );
  if (process.argv[2]) await writeFile(process.argv[2], text + "\n");
  console.log(text);
} finally {
  await browser.close();
}
