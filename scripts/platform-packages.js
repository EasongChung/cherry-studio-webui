// Single source of truth for the platform-specific prebuilt packages that must be
// filtered at pack time. The app installs the full cross-platform set via pnpm's
// `supportedArchitectures` (npm installs every optionalDependency too), so without
// filtering the installer would bundle native binaries for every OS/arch.
//
// Used by before-pack.js (exclude from the copy via electron-builder `files`) and
// after-pack.js (belt-and-braces cleanup of anything that slipped through, incl.
// nested pnpm symlink copies).
//
// If you want to add new prebuilt binary packages with different architectures,
// add them here (mirror the entries from pnpm-lock.yaml).

const packages = [
  '@anthropic-ai/claude-agent-sdk-darwin-arm64',
  '@anthropic-ai/claude-agent-sdk-darwin-x64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64',
  '@anthropic-ai/claude-agent-sdk-linux-arm64-musl',
  '@anthropic-ai/claude-agent-sdk-linux-x64',
  '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
  '@anthropic-ai/claude-agent-sdk-win32-arm64',
  '@anthropic-ai/claude-agent-sdk-win32-x64',
  '@img/sharp-darwin-arm64',
  '@img/sharp-darwin-x64',
  '@img/sharp-libvips-darwin-arm64',
  '@img/sharp-libvips-darwin-x64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-libvips-linuxmusl-arm64',
  '@img/sharp-libvips-linux-x64',
  '@img/sharp-libvips-linuxmusl-x64',
  '@img/sharp-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-linuxmusl-arm64',
  '@img/sharp-linuxmusl-x64',
  '@img/sharp-win32-arm64',
  '@img/sharp-win32-x64',
  '@napi-rs/system-ocr-darwin-arm64',
  '@napi-rs/system-ocr-darwin-x64',
  '@napi-rs/system-ocr-win32-arm64-msvc',
  '@napi-rs/system-ocr-win32-x64-msvc',
  '@napi-rs/canvas-linux-x64-gnu',
  '@napi-rs/canvas-linux-x64-musl',
  '@napi-rs/canvas-linux-arm64-gnu',
  '@napi-rs/canvas-linux-arm64-musl',
  '@napi-rs/canvas-darwin-x64',
  '@napi-rs/canvas-darwin-arm64',
  '@napi-rs/canvas-win32-x64-msvc',
  '@napi-rs/canvas-win32-arm64-msvc',
  // sqlite-vec prebuilt extensions (vec0.dylib/.so/.dll), from the @aiany/sqlite-vec fork
  // which adds a windows-arm64 build (upstream ships none). Note the package names use
  // `windows`, not `win32` — see platformTokens below for why the keep-filter must match both.
  '@aiany/sqlite-vec-darwin-arm64',
  '@aiany/sqlite-vec-darwin-x64',
  '@aiany/sqlite-vec-linux-arm64',
  '@aiany/sqlite-vec-linux-x64',
  '@aiany/sqlite-vec-windows-arm64',
  '@aiany/sqlite-vec-windows-x64'
]

// Bundled binary platform folders downloaded by scripts/download-binaries.js.
const allBinaryPlatforms = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']

const platformToArch = {
  mac: 'darwin',
  windows: 'win32',
  linux: 'linux',
  linuxmusl: 'linuxmusl'
}

// Most native packages encode Electron's platform key (win32) in their name, but some
// (e.g. sqlite-vec) use the npm `windows` convention. Match either so a win32 build keeps
// sqlite-vec-windows-x64 instead of wrongly excluding it.
const keepPackages = (platform, arch) => {
  const platformTokens = platform === 'win32' ? ['win32', 'windows'] : [platform]
  return packages.filter((p) => p.includes(arch) && platformTokens.some((t) => p.includes(t)))
}

// Platform packages that must NOT be shipped for this build.
const packagesToExclude = (platform, arch) => {
  const keep = keepPackages(platform, arch)
  return packages.filter((p) => !keep.includes(p))
}

// Bundled binary platform folders that must NOT be shipped for this build.
const binaryPlatformsToExclude = (platform, arch) => {
  const current = `${platform}-${arch}`
  return allBinaryPlatforms.filter((p) => p !== current)
}

module.exports = {
  packages,
  allBinaryPlatforms,
  platformToArch,
  keepPackages,
  packagesToExclude,
  binaryPlatformsToExclude
}
