# Third-party notices

LocalVault uses the following redistributed components. The corresponding license texts are included in `licenses/`. Package versions and integrity hashes are pinned in NuGet and npm lock files.

| Component | Version | License / source |
| --- | --- | --- |
| .NET / WPF runtime | 10.0.13 (self-contained Windows x64) | MIT and third-party notices; https://github.com/dotnet/runtime and https://github.com/dotnet/wpf |
| Sodium.Core | 1.4.1 | MIT; © 2026 Adam Caudill, Trond Arne Bråthen & Contributors; https://github.com/ektrah/libsodium-core |
| libsodium native library | 1.0.22 | ISC; Copyright (c) 2013-2026 Frank Denis; https://github.com/jedisct1/libsodium |
| zxcvbn-core | 7.0.92 | MIT; Copyright (c) 2012 Dropbox, Inc. and 2020-2021 Tony Richards; https://github.com/trichards57/zxcvbn-cs |
| Microsoft WebView2 SDK | 1.0.4258.31 | Microsoft license and notices; `licenses/WebView2-LICENSE.txt`, `licenses/WebView2-NOTICE.txt` |
| React / React DOM | 19.3.1 | MIT; `licenses/frontend/react`, `licenses/frontend/react-dom` |
| Radix UI | 1.8.1 | MIT; `licenses/frontend/radix-ui` and transitive component folders |
| Lucide React | 1.58.0 | ISC; `licenses/frontend/lucide-react` |
| Geist / Geist Mono | 5.3.0 | SIL Open Font License 1.1; `licenses/frontend/_fontsource-variable_geist*` |
| webextension-polyfill | 0.12.0 | MPL-2.0; Mozilla; https://github.com/mozilla/webextension-polyfill |

The browser bundles include webextension-polyfill. Its corresponding source is obtainable from the versioned npm package and Mozilla repository; the exact installed package is pinned in `extensions/package-lock.json`. LocalVault does not modify that library. The zxcvbn-core license is included in `licenses/zxcvbn-core-MIT.txt`. TypeScript, esbuild, jsdom, Vitest, Testing Library, user-event and WiX are build/test tools and are not bundled into the application runtime.

Frontend dependency versions and their license texts are listed in [licenses/frontend/COMPONENTS.md](licenses/frontend/COMPONENTS.md), including class-variance-authority, clsx, tailwind-merge, Floating UI, and React/Radix transitive dependencies. The list includes locked production dependencies; tree shaking can exclude some of their code from the final bundle.
