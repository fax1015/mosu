# mosu!

we have gosu! and tosu! so why not mosu! (for mappers)

`mosu!` is a Tauri app for scanning and tracking osu! beatmaps. It supports both the classic Songs folder flow and osu!lazer's hashed storage layout.

## prerequisites

- Node.js
- Rust toolchain (`rustup` + `cargo`)
- Windows x64

## development

Install dependencies with:

```powershell
npm install
```

The repo includes a local .NET SDK at `.tools/dotnet`, so the npm scripts can publish the sidecar before running Tauri commands.

## commands

- `npm run publish-sidecar` - publish the Realm resolver sidecar to `src-tauri/sidecar/realm-resolver/publish`
- `npm run dev` - sync version, publish the sidecar, and run `tauri dev`
- `npm run dev:fresh` - sync version, publish the sidecar, and run the fresh dev flow
- `npm run build` - sync version, clean targets, publish the sidecar, and build release bundles
- `npm run package` - publish the sidecar and build release bundles

## osu!lazer notes

When scanning lazer content, select the osu!lazer data directory that contains `client.realm`. `mosu!` uses the sidecar to resolve hashed assets back to usable audio and background paths.
