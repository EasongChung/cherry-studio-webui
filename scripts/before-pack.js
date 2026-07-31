const { Arch } = require('electron-builder')
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const { platformToArch, keepPackages, packagesToExclude, binaryPlatformsToExclude } = require('./platform-packages')

// Cross-arch prebuilt packages come from supportedArchitectures in pnpm-workspace.yaml —
// pnpm ignores that setting once node_modules exists, so it can't be flipped per pack pass.
// Anything kept for this arch but never installed is a native module the app would fail to
// load at runtime, so stop here instead of shipping it. musl builds are excluded: pnpm
// installs them only on a musl host, and releases are built on glibc.
const assertPrebuiltPackages = (platform, arch) => {
  const missingPackages = keepPackages(platform, arch)
    .filter((p) => !p.includes('musl'))
    .filter((p) => !fs.existsSync(path.join(__dirname, '..', 'node_modules', p)))
  if (missingPackages.length > 0) {
    throw new Error(
      `Missing prebuilt packages for ${platform}-${arch}: ${missingPackages.join(', ')}\n` +
        `Run \`rm -rf node_modules && pnpm install\` — pnpm only reads supportedArchitectures ` +
        `on a fresh install, so plain \`pnpm install\` (even --force) will not fix it.`
    )
  }
}
exports.assertPrebuiltPackages = assertPrebuiltPackages

exports.default = async function (context) {
  const arch = context.arch === Arch.arm64 ? 'arm64' : 'x64'
  const platformName = context.packager.platform.name
  const platform = platformToArch[platformName]

  assertPrebuiltPackages(platform, arch)

  console.log(`Downloading bundled binaries for ${platform}-${arch}...`)
  execSync(`node "${path.join(__dirname, 'download-binaries.js')}" ${platform} ${arch}`, { stdio: 'inherit' })
  // Fail the build rather than ship a half-empty resources/binaries/<platform>.
  require('./download-binaries').verifyBundledBinaries(platform, arch)

  // Electron-builder consumes `config.files` at copy time (getFileMatchers), so the
  // supported way to filter files is to append the exclude patterns directly to the
  // array. The previous `config.files[0].filter = ...` hack silently did nothing —
  // FileMatcher only exposes a `patterns` field. Patterns must use `**/node_modules/...`
  // so they also match the nested copies that pnpm's symlink layout materializes
  // (e.g. claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64).
  const excludePackages = async (packagesToExclude) => {
    context.packager.config.files = [...(context.packager.config.files ?? []), ...packagesToExclude]
  }

  const arm64ExcludePackages = packagesToExclude(platform, 'arm64').map((p) => '!**/node_modules/' + p + '/**')
  const x64ExcludePackages = packagesToExclude(platform, 'x64').map((p) => '!**/node_modules/' + p + '/**')

  const excludeBundledBinaryFilters = binaryPlatformsToExclude(platform, arch).map(
    (p) => '!resources/binaries/' + p + '/**'
  )

  if (context.arch === Arch.arm64) {
    await excludePackages([...arm64ExcludePackages, ...excludeBundledBinaryFilters])
  } else {
    await excludePackages([...x64ExcludePackages, ...excludeBundledBinaryFilters])
  }
}
