import * as esbuild from "esbuild";

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "info",
  });

  const webview = await esbuild.context({
    entryPoints: ["src/webview/webviewMain.ts"],
    bundle: true,
    format: "iife",
    platform: "browser",
    minify: production,
    sourcemap: false,
    outfile: "media/deepwikiWebview.js",
    logLevel: "info",
  });

  if (watch) {
    await Promise.all([ctx.watch(), webview.watch()]);
    console.log("Watching for changes...");
  } else {
    await Promise.all([ctx.rebuild(), webview.rebuild()]);
    await Promise.all([ctx.dispose(), webview.dispose()]);
  }

  // Bundle highlight.js for webview
  await esbuild.build({
    entryPoints: ["node_modules/highlight.js/lib/common.js"],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "hljs",
    outfile: "media/highlight.min.js",
    logLevel: "info",
  });

  // Bundle marked for webview (the webview has no module loader)
  await esbuild.build({
    entryPoints: ["node_modules/marked/lib/marked.esm.js"],
    bundle: true,
    minify: true,
    format: "iife",
    globalName: "marked",
    outfile: "media/marked.min.js",
    logLevel: "info",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
