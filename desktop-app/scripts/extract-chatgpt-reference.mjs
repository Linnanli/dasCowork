/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { execFileSync, spawnSync } from 'node:child_process'
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { extractAll, listPackage } = require('@electron/asar')
const prettier = require('prettier')

const desktopRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(desktopRoot, '..')
const options = parseArguments(process.argv.slice(2))

if (options.help) {
  printHelp()
  process.exit(0)
}

const appPath = resolve(options.appPath ?? '/Applications/ChatGPT.app')
const contentsPath = join(appPath, 'Contents')
const resourcesPath = join(contentsPath, 'Resources')
const asarPath = join(resourcesPath, 'app.asar')
const infoPlistPath = join(contentsPath, 'Info.plist')

assertReadable(asarPath)
assertReadable(infoPlistPath)

const appVersion = readPlistValue(infoPlistPath, 'CFBundleShortVersionString')
const buildNumber = readPlistValue(infoPlistPath, 'CFBundleVersion')
const bundleIdentifier = readPlistValue(infoPlistPath, 'CFBundleIdentifier')
const outputPath = resolve(
  options.outputPath ??
    join(repoRoot, 'reference-projects', `codex-electron-${appVersion}-beautified`)
)

assertSafeOutputPath(outputPath, appPath)
prepareOutputDirectory(outputPath, options.force)

console.log(`Extracting ${asarPath}`)
extractAll(asarPath, outputPath)

if (!options.skipFormat) {
  console.log(`Beautifying extracted code with Prettier ${prettier.version}`)
  runPrettier(outputPath)
}

console.log('Writing analysis metadata')
writeAnalysisMetadata({
  appPath,
  appVersion,
  asarPath,
  buildNumber,
  bundleIdentifier,
  infoPlistPath,
  outputPath,
  skipFormat: options.skipFormat
})

console.log(`Reference project ready: ${outputPath}`)

function parseArguments(args) {
  const parsed = {
    appPath: undefined,
    force: false,
    help: false,
    outputPath: undefined,
    skipFormat: false
  }

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--force') {
      parsed.force = true
      continue
    }
    if (argument === '--help' || argument === '-h') {
      parsed.help = true
      continue
    }
    if (argument === '--skip-format') {
      parsed.skipFormat = true
      continue
    }
    if (argument === '--app' || argument === '--output') {
      const value = args[index + 1]
      if (!value) throw new Error(`${argument} requires a path`)
      if (argument === '--app') parsed.appPath = value
      if (argument === '--output') parsed.outputPath = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${argument}`)
  }

  return parsed
}

function printHelp() {
  console.log(`Usage: npm run reference:chatgpt -- [options]

Options:
  --app <path>       Electron .app bundle (default: /Applications/ChatGPT.app)
  --output <path>    Output directory (default: reference-projects/codex-electron-<version>-beautified)
  --force            Replace an existing output directory
  --skip-format      Extract without running Prettier
  -h, --help         Show this help`)
}

function assertReadable(path) {
  try {
    accessSync(path, constants.R_OK)
  } catch {
    throw new Error(`Required readable file not found: ${path}`)
  }
}

function readPlistValue(plistPath, key) {
  return execFileSync('plutil', ['-extract', key, 'raw', '-o', '-', plistPath], {
    encoding: 'utf8'
  }).trim()
}

function assertSafeOutputPath(path, sourceAppPath) {
  const forbiddenPaths = new Set([
    '/',
    resolve('.'),
    resolve(repoRoot),
    resolve(desktopRoot),
    resolve(sourceAppPath),
    resolve(dirname(sourceAppPath))
  ])
  if (forbiddenPaths.has(path) || basename(path).length < 3) {
    throw new Error(`Refusing unsafe output path: ${path}`)
  }
}

function prepareOutputDirectory(path, force) {
  if (existsSync(path) && !force) {
    throw new Error(`Output already exists: ${path}. Use --force to replace it.`)
  }
  if (existsSync(path)) rmSync(path, { force: true, recursive: true })
  mkdirSync(path, { recursive: true })
}

function runPrettier(path) {
  const executable = join(
    desktopRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'prettier.cmd' : 'prettier'
  )
  if (!existsSync(executable)) {
    throw new Error(`Prettier is not installed. Run npm --prefix desktop-app install first.`)
  }

  const formatRoots = ['.vite', 'webview', 'native-menu-locales']
    .map((name) => join(path, name))
    .filter(existsSync)
  const supportedExtensions = new Set(['.cjs', '.css', '.html', '.js', '.json', '.mjs'])
  const files = formatRoots
    .flatMap(walkFiles)
    .filter((filePath) => supportedExtensions.has(extname(filePath).toLowerCase()))
  const packageJsonPath = join(path, 'package.json')
  if (existsSync(packageJsonPath)) files.push(packageJsonPath)

  for (let index = 0; index < files.length; index += 50) {
    const batch = files.slice(index, index + 50)
    const result = spawnSync(
      executable,
      ['--write', '--ignore-path', '/dev/null', '--log-level', 'warn', ...batch],
      { cwd: repoRoot, stdio: 'inherit' }
    )
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

function writeAnalysisMetadata({
  appPath,
  appVersion,
  asarPath,
  buildNumber,
  bundleIdentifier,
  infoPlistPath,
  outputPath,
  skipFormat
}) {
  const analysisPath = join(outputPath, '_analysis')
  mkdirSync(analysisPath, { recursive: true })

  const asarFiles = listPackage(asarPath).sort()
  writeFileSync(join(analysisPath, 'asar-files.txt'), `${asarFiles.join('\n')}\n`)

  const plistJson = execFileSync('plutil', ['-convert', 'json', '-o', '-', infoPlistPath], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })
  writeFileSync(
    join(analysisPath, 'Info.json'),
    `${JSON.stringify(JSON.parse(plistJson), null, 2)}\n`
  )

  const inventory = collectInventory(outputPath, analysisPath)
  const manifest = {
    source: {
      appPath,
      appVersion,
      buildNumber,
      bundleIdentifier,
      asarPath,
      asarBytes: statSync(asarPath).size,
      asarSha256: sha256(asarPath)
    },
    reconstruction: {
      extractedWith: `@electron/asar ${require('@electron/asar/package.json').version}`,
      formatted: !skipFormat,
      prettierVersion: prettier.version,
      sourceMapsPresent: (inventory.extensions['.map'] ?? 0) > 0
    },
    inventory
  }
  writeFileSync(join(analysisPath, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  const readme = `# ChatGPT Electron ${appVersion} 分析参考

这个目录来自本机 \`${appPath}\` 的 \`Contents/Resources/app.asar\`。它是发布包的解包与排版结果，不是原始 TypeScript/React 源码。

## 建议入口

- Electron 启动入口：\`${readPackageMain(outputPath)}\`
- 主进程与 preload：\`.vite/build/\`
- 页面入口：\`webview/index.html\`
- 页面代码与样式：\`webview/assets/\`
- 文件清单与版本信息：\`_analysis/\`

## 还原边界

- JavaScript/CSS/HTML/JSON 只做了 Prettier 排版，没有恢复原变量名、模块名、类型和注释。
- 发布包没有携带 source map，因此不能可靠还原成原始源码目录。
- \`.node\`、Mach-O、WASM、字体和图片保持二进制原样，只能另行使用对应工具分析。
- App 外置的 \`plugins/\`、\`skills/\`、\`codex\` 和 \`cua_node/\` 不属于 app.asar，未复制到本目录。
- 该目录位于仓库已忽略的 \`reference-projects/\` 下，适合本地行为分析，不应作为可构建源码或对外分发物。

## 重新生成

在仓库根目录运行：

\`npm --prefix desktop-app run reference:chatgpt -- --force\`
`
  writeFileSync(join(analysisPath, 'README.md'), readme)
}

function collectInventory(rootPath, excludedPath) {
  const extensions = {}
  let bytes = 0
  let files = 0

  for (const path of walkFiles(rootPath)) {
    if (path.startsWith(`${excludedPath}/`)) continue
    const fileStat = statSync(path)
    const extension = extname(path).toLowerCase() || '[no extension]'
    extensions[extension] = (extensions[extension] ?? 0) + 1
    bytes += fileStat.size
    files += 1
  }

  return {
    bytes,
    files,
    extensions: Object.fromEntries(
      Object.entries(extensions).sort((left, right) => right[1] - left[1])
    )
  }
}

function walkFiles(rootPath) {
  const files = []
  const pending = [rootPath]

  while (pending.length > 0) {
    const currentPath = pending.pop()
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = join(currentPath, entry.name)
      if (entry.isDirectory()) pending.push(entryPath)
      if (entry.isFile()) files.push(entryPath)
    }
  }

  return files
}

function sha256(path) {
  return execFileSync('shasum', ['-a', '256', path], {
    encoding: 'utf8',
    env: { ...process.env, LC_ALL: 'C' }
  }).split(/\s+/)[0]
}

function readPackageMain(outputPath) {
  const packageJsonPath = join(outputPath, 'package.json')
  if (!existsSync(packageJsonPath)) return '[package.json missing]'
  return (
    JSON.parse(require('node:fs').readFileSync(packageJsonPath, 'utf8')).main ?? '[main missing]'
  )
}
