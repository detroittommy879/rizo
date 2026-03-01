this works:

npm run tauri build -- --debug  --> creates a working .exe
pnpm tauri build --debug        --> pnpm equivalent (no extra -- needed)

pnpm run tauri dev   --> dev mode with hot reload
pnpm tauri build --debug  --> debug .exe (faster, no installer)
pnpm tauri build       --> release build + installer bundle
