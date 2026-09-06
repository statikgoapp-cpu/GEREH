import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { copyFile, mkdir, rm, readFile } from "fs/promises";

// For desktop packaging stability, keep third-party deps external.
// This avoids partial bundling chains that can trigger missing-module
// crashes inside app.asar (e.g. call-bind-apply-helpers).
const allowlist: string[] = [];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  await esbuild({
    entryPoints: ["server/image-worker.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/image-worker.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });

  await mkdir("dist", { recursive: true });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
