Place the **native** Windows `mactelnet.exe` here (haakonnessjoen [MAC-Telnet](https://github.com/haakonnessjoen/MAC-Telnet), built with MSYS2).

Expected path:

- `electron/bin/win32/x64/mactelnet.exe`

Build locally (requires MSYS2 + toolchain, see `scripts/build-mactelnet-c-win.ps1`):

```powershell
npm run mactelnet:build:win -- -StageToElectronBin
```

Or copy a pre-built binary:

```powershell
npm run mactelnet:stage:win -- -BinaryPath "C:\path\to\mactelnet.exe"
```

Override: env `NVI_MACTELNET_PATH`.

Then:

```powershell
npm run electron:build:win
```
