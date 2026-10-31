// 来源③：调用电脑上的豆包 app 进行 AI 原创生图。
// 豆包桌面版没有官方本地 API（私有 IPC 端口无文档），因此走 Windows UI 自动化：
// 激活豆包 → 打开「图像生成」→ 输入描述 → 点击生成 → 轮询下载目录取新图。
// 重要：该 driver 需豆包已登录；未登录环境无法真机验证，故提供 dry-run 与独立自检，
// 真机校准点已在代码中显式标注（CALIBRATE）。
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { ensureDir, sleep, nowIso, listFilesRecursive, isImageFile } from '../lib/util.mjs';

const DEFAULT_EXE = 'D:\\豆包\\Doubao\\app\\Doubao.exe';

// 生成驱动豆包的 PowerShell（.NET UI Automation + 键盘输入）
// 设计为可独立运行：node 侧只负责调用与取图，UI 动作集中在此脚本。
function buildPsScript({ exePath, promptText }) {
  const safePrompt = promptText.replace(/'/g, "''");
  return `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$exe = '${exePath}'
if (-not (Test-Path -LiteralPath $exe)) { throw "豆包 exe 不存在: $exe" }
# 启动或激活
$proc = Get-Process -Name Doubao -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $proc) { Start-Process -FilePath $exe | Out-Null; Start-Sleep -Seconds 6 }
$root = [System.Windows.Automation.AutomationElement]::RootElement
# 按类名/名称找豆包窗口（CALIBRATE: 窗口 Name 可能随版本变化）
$winCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Window)
$win = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $winCond) |
  Where-Object { $_.Current.Name -match '豆包' } | Select-Object -First 1
if (-not $win) { throw '未找到豆包窗口（请确认已登录且窗口未最小化到托盘）' }
$win.SetFocus()
Start-Sleep -Milliseconds 800
# 在窗口内按 Name 找「图像生成」并点击（CALIBRATE: 名称/层级）
function Find-By-Name($el, $name) {
  $c = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $name)
  return $el.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
}
$imgBtn = Find-By-Name $win '图像生成'
if ($imgBtn) {
  $inv = $imgBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $inv.Invoke()
} else {
  throw '未找到「图像生成」入口（CALIBRATE: 需要按实际 UI 调整定位）'
}
Start-Sleep -Seconds 2
# 输入描述：找文档控件，写入文字
$docCond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Document)
$doc = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $docCond)
if (-not $doc) {
  $editCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
  $doc = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCond)
}
if (-not $doc) { throw '未找到生图描述输入框（CALIBRATE）' }
$doc.SetFocus()
$val = $doc.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
$val.SetValue('${safePrompt}')
Start-Sleep -Milliseconds 500
# 点击生成按钮（CALIBRATE: 按钮 Name）
$gen = Find-By-Name $win '生成'
if ($gen) {
  $gp = $gen.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $gp.Invoke()
} else {
  throw '未找到「生成」按钮（CALIBRATE: 需要按实际 UI 调整定位）'
}
Write-Output 'SUBMITTED'
`;
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    const ps = spawn('pwsh', ['-NoProfile', '-Command', script]);
    let out = '';
    let err = '';
    ps.stdout.on('data', (c) => { out += c; });
    ps.stderr.on('data', (c) => { err += c; });
    ps.on('error', reject);
    ps.on('exit', (code) => (code === 0 ? resolve(out.trim()) : reject(new Error(err || `exit ${code}`))));
  });
}

// 找下载目录中在 startedAtMs 之后新增的图片
function findNewImage(downloadDir, startedAtMs) {
  const files = listFilesRecursive(downloadDir).filter(isImageFile);
  const fresh = files
    .filter((f) => statSync(f).mtimeMs >= startedAtMs - 2000)
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return fresh[0] || null;
}

/**
 * 调豆包生成原创表情
 * @param {object} opts { config, prompt, emotion, workDir, dryRun }
 */
export async function generateWithDoubao({
  config = {}, prompt, emotion = 'daily', workDir, dryRun = false,
}) {
  const exePath = config.exePath || DEFAULT_EXE;
  const downloadDir = config.downloadDir || join(homedir(), 'Downloads');
  const timeoutSec = config.timeoutSec || 180;
  const startedAtMs = Date.now();

  if (dryRun) {
    return {
      dryRun: true, exePath, downloadDir, prompt, emotion,
      steps: ['激活豆包', '打开图像生成', '输入描述', '点击生成', '轮询取图'],
      note: 'dry-run 未真实操作豆包；真机需先登录',
      createdAt: nowIso(),
    };
  }

  ensureDir(workDir);
  if (!existsSync(exePath)) throw new Error(`豆包 exe 不存在：${exePath}`);

  const ps = buildPsScript({ exePath, promptText: prompt });
  const submit = await runPowerShell(ps);
  if (!submit.includes('SUBMITTED')) throw new Error('豆包生图提交失败');

  // 轮询下载目录等待新图
  const deadline = Date.now() + timeoutSec * 1000;
  let image = null;
  while (Date.now() < deadline) {
    image = findNewImage(downloadDir, startedAtMs);
    if (image) break;
    await sleep(3000);
  }
  if (!image) throw new Error(`等待豆包出图超时（${timeoutSec}s）`);
  return { path: image, prompt, emotion, source: 'doubao', createdAt: nowIso() };
}

// 入库：source=doubao，默认 pending（AI 生成需审核后才能发）
export function ingestDoubaoImage(store, generated, extraTags = []) {
  return store.ingestImage({
    imagePath: generated.path, source: 'doubao', emotion: generated.emotion,
    tags: [...extraTags, 'ai-original'], keywords: [generated.prompt],
    caption: generated.prompt, autoApprove: false,
  });
}
