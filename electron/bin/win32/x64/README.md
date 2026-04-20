Place `mactelnet.exe` here for Windows x64 builds.

Expected path:

- `electron/bin/win32/x64/mactelnet.exe`

You can stage it automatically on Windows with:

```powershell
npm run mactelnet:stage:win -- -BinaryPath "C:\path\to\mactelnet.exe"
```

After that, build the Electron app with:

```powershell
npm run electron:build:win
```

For a portable build:

```powershell
npm run electron:build:win:portable
```
