/**
 * 校验自动保存的时机（对应 checklist.md 的 A1–A5）。
 *
 *   node server.js                     # 先让 http://localhost:3456 跑起来
 *   node scripts/autosave-check.mjs    # 全项通过退出码 0
 *
 * 做法：在页面里把 window.showDirectoryPicker 换成一个假目录，文件句柄的
 * createWritable() 只记录「什么时候写了什么」，不落盘 —— 这样能精确观察
 * 自动保存的时机与内容，而不会真的动到磁盘上的文件。
 *
 * 依赖 playwright（本仓库是「免安装」项目，没把它写进依赖），查找顺序：
 * 本仓库 node_modules → 环境变量 PLAYWRIGHT_PATH → 本机其它项目里已装的；
 * 浏览器优先用系统 Chrome，避免与 ms-playwright 的版本对不上。
 */
import { createRequire } from 'node:module';

const BASE = process.env.LMDK_URL || 'http://localhost:3456';
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const tries = [
    'playwright',
    'playwright-core',
    process.env.PLAYWRIGHT_PATH,
    'D:/Work/leo-docs-store-svn/test/openocta/ui/node_modules/playwright',
  ].filter(Boolean);
  for (const name of tries) {
    try { return require(name); } catch { /* 继续找下一个 */ }
  }
  throw new Error('没找到 playwright：用 PLAYWRIGHT_PATH=<路径> 指定，或 npm i -D playwright-core');
}

async function launchChromium() {
  const { chromium } = loadPlaywright();
  const attempts = [
    { channel: 'chrome' },
    {},
    { executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' },
  ];
  let lastErr;
  for (const opt of attempts) {
    try {
      return await chromium.launch({ headless: true, ...opt });
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

let pass = 0, fail = 0;
const failures = [];
function check(id, name, ok, detail = '') {
  if (ok) { pass++; console.log(`OK   ${id}  ${name}`); }
  else {
    fail++; failures.push(`${id} ${name}`);
    console.log(`FAIL ${id}  ${name}${detail ? '  — ' + detail : ''}`);
  }
}
function summary() {
  console.log(`\n结果：${pass} 项通过 / ${fail} 项失败`);
  if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
  return fail;
}

const INIT_DOC = [
  '|行业|名字|哈哈|',
  '|---|---|---|',
  '|制造业|信锐|哈哈|',
  '|衡阳 |你好|哈哈|',
].join('\n');


const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.addInitScript((init) => {
  window.__writes = [];
  const state = { content: init };
  const fileHandle = {
    kind: 'file', name: 't.md',
    async getFile() { return new File([state.content], 't.md', { type: 'text/markdown' }); },
    async createWritable() {
      return {
        async write(data) {
          const text = String(data);
          window.__writes.push({ at: performance.now(), text });
          state.content = text;
        },
        async close() {},
      };
    },
  };
  const dirHandle = {
    kind: 'directory', name: '假目录',
    async *entries() { yield ['t.md', fileHandle]; },
    async queryPermission() { return 'granted'; },
    async requestPermission() { return 'granted'; },
  };
  window.showDirectoryPicker = async () => dirHandle;
}, INIT_DOC);

await page.goto(BASE, { waitUntil: 'load' });
await page.click('#btn-load-folder');          // 走应用自己的加载流程（系统弹窗已被替换）
await page.waitForTimeout(1200);
if ((await page.textContent('#btn-mode')).trim() === '现代模式') {
  await page.click('#btn-mode');
  await page.waitForTimeout(1000);
}
const CM = 'document.querySelector(".CodeMirror").CodeMirror';
const mode = await page.evaluate(() => {
  const c = document.querySelector('.CodeMirror');
  return c && c.className.includes('live-preview') ? 'modern' : 'other';
});
if (mode !== 'modern') {
  console.error('没进到现代模式，先检查页面');
  await browser.close();
  process.exit(1);
}

const writes = () => page.evaluate(() => window.__writes.map((w) => ({ t: Math.round(w.at), text: w.text })));
const type = async (s, gap = 120) => {
  await page.evaluate(`(() => ${CM}.focus())()`);
  for (const ch of s) { await page.keyboard.type(ch); await page.waitForTimeout(gap); }
  return page.evaluate(() => performance.now());
};

// A1：没有改动就不该有任何写入（旧实现是每 3 秒无条件整篇重写）
await page.waitForTimeout(8000);
let w = await writes();
check('A1', '无改动时 8 秒内零写入', w.length === 0, `${w.length} 次`);

// A2：改一次 → 静止 5 秒才写，且只写一次
const t0 = await type('X');
await page.waitForTimeout(3000);
w = await writes();
check('A2', '改动后 3 秒内不写（等静止）', w.length === 0, `${w.length} 次`);
await page.waitForTimeout(3500);
w = await writes();
check('A2', '静止约 5 秒后写恰好一次', w.length === 1, `${w.length} 次`);
check('A3', '写进去的是改动后的内容', !!w[0] && w[0].text.includes('X'),
  w[0] ? `写于 +${Math.round(w[0].t - t0)}ms` : '没有写入');

// A4：连续改多次 → 只在最后一次之后写一次
const before = w.length;
await type('ABC');
await page.waitForTimeout(6500);
w = await writes();
check('A4', '连续改动只在静止后写一次', w.length === before + 1, `${w.length - before} 次`);

// A4b：改了又改回去 → 不写
const beforeRevert = w.length;
const saved = await page.evaluate(`(() => ${CM}.getValue())()`);
await type('Z');
await page.evaluate(`(() => { const c = ${CM}; c.setValue(${JSON.stringify(saved)}); })()`);
await page.waitForTimeout(6500);
w = await writes();
check('A4', '改了又改回去 → 不写', w.length === beforeRevert, `${w.length - beforeRevert} 次`);

// A5：带着未保存的改动切走 → 兜底保存，不丢内容
const beforeSwitch = w.length;
await type('Q');
await page.click('#btn-mode');
await page.waitForTimeout(1500);
w = await writes();
check('A5', '切模式时兜底保存一次', w.length === beforeSwitch + 1, `${w.length - beforeSwitch} 次`);
check('A5', '兜底保存的内容含最后一次改动', !!w[w.length - 1] && w[w.length - 1].text.includes('Q'), '');

console.log('写入时间线：' + (await writes()).map((x, i) => `#${i + 1} +${x.t}ms(${x.text.length}字节)`).join('  '));
const failed = summary();
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
