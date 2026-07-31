const { Arch } = require('electron-builder')
const fs = require('fs')
const path = require('path')
const { packages, allBinaryPlatforms, platformToArch, keepPackages } = require('./platform-packages')

// Prune platform prebuilt package directories for this build. `rootDir` is always a
// `node_modules` directory; `isTopLevel` is true only for the app's own node_modules.
//
// Two things happen here:
// 1. Platform packages for OTHER platforms/architectures are removed (belt-and-braces
//    after before-pack's `files` filter).
// 2. Nested copies of platform packages are ALWAYS removed. Electron-builder resolves
//    pnpm symlinks into real files, so one shared package materializes twice: at the
//    top level (node_modules/@scope/pkg) and inside the dependent's own node_modules
//    (node_modules/@scope/dep/node_modules/@scope/pkg). Node resolves the package from
//    the top level, so the nested copy is pure duplicate bytes in the installer.
const prunePlatformPackages = (rootDir, keep, isTopLevel) => {
  if (!fs.existsSync(rootDir)) return
  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const entryPath = path.join(rootDir, entry.name)

    if (entry.name.startsWith('@')) {
      const scopeEntries = fs.readdirSync(entryPath, { withFileTypes: true })
      for (const scopeEntry of scopeEntries) {
        if (!scopeEntry.isDirectory()) continue
        const fullName = `${entry.name}/${scopeEntry.name}`
        const scopeEntryPath = path.join(entryPath, scopeEntry.name)
        if (packages.includes(fullName)) {
          // Top level: keep only this build's package. Nested: always remove the duplicate.
          if (!isTopLevel || !keep.includes(fullName)) {
            fs.rmSync(scopeEntryPath, { recursive: true, force: true })
          }
        } else if (fs.existsSync(path.join(scopeEntryPath, 'node_modules'))) {
          prunePlatformPackages(path.join(scopeEntryPath, 'node_modules'), keep, false)
        }
      }
      continue
    }

    if (packages.includes(entry.name)) {
      if (!isTopLevel || !keep.includes(entry.name)) {
        fs.rmSync(entryPath, { recursive: true, force: true })
      }
    } else if (fs.existsSync(path.join(entryPath, 'node_modules'))) {
      prunePlatformPackages(path.join(entryPath, 'node_modules'), keep, false)
    }
  }
}

exports.default = async function (context) {
  const platform = context.packager.platform.name
  if (platform === 'windows') {
    fs.rmSync(path.join(context.appOutDir, 'LICENSE.electron.txt'), { force: true })
    fs.rmSync(path.join(context.appOutDir, 'LICENSES.chromium.html'), { force: true })
  }

  const osKey = platformToArch[platform]
  if (!osKey) return
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const keep = keepPackages(osKey, arch)

  const resourcesDir =
    platform === 'mac'
      ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
      : path.join(context.appOutDir, 'resources')

  // Remove unpacked native binaries for other platforms/architectures and any nested
  // duplicates of the kept ones.
  prunePlatformPackages(path.join(resourcesDir, 'app.asar.unpacked', 'node_modules'), keep, true)

  // Remove bundled CLI binaries downloaded for other platforms (download-binaries.js).
  const currentKey = `${osKey}-${arch}`
  const binariesRoot = path.join(resourcesDir, 'binaries')
  if (fs.existsSync(binariesRoot)) {
    for (const platformKey of allBinaryPlatforms) {
      if (platformKey === currentKey) continue
      fs.rmSync(path.join(binariesRoot, platformKey), { recursive: true, force: true })
    }
  }
}
