import { $ } from 'bun';
import { mkdirSync, rmSync } from 'node:fs';
import { description, version } from './package.json';

rmSync('./out', { recursive: true, force: true });
mkdirSync('./out', { recursive: true });

const allPlatforms: Record<string, Bun.CompileBuildOptions> = {
  windows: {
    target: 'bun-windows-x64',
    outfile: `wilayah-${version}.exe`,
    windows: {
      copyright: `© ${new Date().getFullYear()} Vermaysha`,
      description: description,
      title: 'WILAYAH - Wilayah Indonesia',
      version: version,
      icon: './icon.ico',
    },
  },
  linux: { target: 'bun-linux-x64', outfile: `wilayah-linux-${version}` },
  // macos: { target: 'bun-darwin-arm64', outfile: `wilayah-macos-${version}` },
  'linux-arm64': {
    target: 'bun-linux-arm64',
    outfile: `wilayah-linux-arm64-musl-${version}`,
  },
};

// Get target platform from command line argument
const targetArg = Bun.argv[2];
const platforms: Bun.CompileBuildOptions[] =
  targetArg && allPlatforms[targetArg]
    ? [allPlatforms[targetArg]]
    : Object.values(allPlatforms);

const gitVersion = await $`git describe --tags --always`.text().catch(() => 'unknown');
const buildTime = new Date().toISOString();
const gitCommit = await $`git rev-parse HEAD`.text().catch(() => 'unknown');

for (const platform of platforms) {
  const startTime = Date.now();
  await Bun.build({
    entrypoints: ['./src/index.ts'],
    outdir: './out',
    compile: platform,
    minify: true,
    target: 'bun',
    env: 'inline',
    define: {
      BUILD_VERSION: JSON.stringify(gitVersion.trim()),
      APP_VERSION: JSON.stringify(version),
      BUILD_TIME: JSON.stringify(buildTime),
      GIT_COMMIT: JSON.stringify(gitCommit.trim()),
      'Bun.env.NODE_ENV': JSON.stringify('production'),
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
  });

  const endTime = Date.now();
  console.log(
    `Built for ${platform.target} in ${(endTime - startTime) / 1000} seconds.`,
  );
}
