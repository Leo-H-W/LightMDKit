/**
 * 按 checklist.md 逐项校验现代模式的表格行为。
 *
 *   node server.js                      # 先让 http://localhost:3456 跑起来
 *   node scripts/checklist-check.mjs    # 再跑这个（全项通过退出码 0）
 *
 * 依赖 playwright（本仓库是「免安装」项目，没把它写进依赖）。查找顺序：
 *   1. 本仓库 node_modules 里的 playwright / playwright-core
 *   2. 环境变量 PLAYWRIGHT_PATH 指向的路径
 *   3. 本机其它项目里已装的（换机器时用 PLAYWRIGHT_PATH 指过去即可）
 * 自己装的话用 playwright-core：不带浏览器，配合系统 Chrome 跑，几十 MB。
 *
 * 浏览器优先用系统 Chrome（channel: 'chrome'），避免与 ms-playwright 的版本对不上。
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

// ---------- 用例数据 ----------

const TABLE = [
  '| A | B | C |',
  '|---|---|---|',
  '| a1 | b1 | c1 |',
  '| a<br>b | 1 | 2 |',
  '| m1<br><br>m2 | n | o |',
  '| 空<br><br><br>行 | e | f |',
  '| x<br/>y | p<br />q | r |',
].join('\n');

const TABTABLE = [
  '| A | B | C |',
  '|---|---|---|',
  '| a1 | b1 | c1 |',
  '| a2 | b2 | c2 |',
  '| a3 | b3 | c3 |',
].join('\n');

// ---------- 跑测试 ----------

let pass = 0, fail = 0;
const failures = [];
const errors = [];

function check(id, name, ok, detail = '') {
  if (ok) { pass++; console.log(`OK   ${id}  ${name}`); }
  else {
    fail++; failures.push(`${id} ${name}`);
    console.log(`FAIL ${id}  ${name}${detail ? '  — ' + detail : ''}`);
  }
}

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(e.message));

// 1) 打开应用并切到现代模式。
// 必须先「打开一个文件」：没有文件时编辑区是隐藏的，CodeMirror 不渲染任何行，
// 量不到几何。这里走应用自己的拖入通道（写 IndexedDB + ?drop=），拿到的是
// 内存 blob、没有文件句柄，所以自动保存不会碰到磁盘上的真文件。
await page.goto(BASE, { waitUntil: 'load' });
{
  const dropId = 'checklist-' + Date.now();
  await page.evaluate(async ({ id, content }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('lightmdkit', 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains('drops')) r.result.createObjectStore('drops');
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('drops', 'readwrite');
      tx.objectStore('drops').put({
        fileName: 'checklist.md', filePath: null, fileHandle: null,
        fileBlob: new Blob([content], { type: 'text/markdown' }), folderHandle: null, ts: Date.now(),
      }, id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, { id: dropId, content: TABLE });
  await page.goto(`${BASE}/?drop=${encodeURIComponent(dropId)}`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
}
if ((await page.textContent('#btn-mode')).trim() === '现代模式') {
  await page.click('#btn-mode');
  await page.waitForTimeout(1000);
}
const CM = 'document.querySelector(".CodeMirror").CodeMirror';
const mode = await page.evaluate(() => {
  const c = document.querySelector('.CodeMirror');
  return c && c.CodeMirror ? (c.className.includes('live-preview') ? 'modern' : 'other') : 'none';
});
if (mode !== 'modern') {
  console.error('进不了现代模式（CodeMirror 未就绪），先检查页面');
  await browser.close();
  process.exit(1);
}

// 2) 把内容放进编辑器。
// setValue 会让已有标注失效，而「内容签名未变就跳过重建」会让表格再也画不出来；
// app 自己在 setValue 前会调 resetLivePreviewMarks（私有函数，外部调不到），
// 所以这里先置空一次、等一次防抖把签名清掉，再写目标内容。
const setDoc = async (content, cursor) => {
  await page.evaluate(`(() => { const c = ${CM}; c.setValue(''); })()`);
  await page.waitForTimeout(450);
  await page.evaluate(`(() => {
    const c = ${CM};
    c.setValue(${JSON.stringify(content)});
    ${cursor ? `c.setCursor(${JSON.stringify(cursor)});` : ''}
    c.focus();
  })()`);
  await page.waitForTimeout(800);
};
const getLine = (i) => page.evaluate(`(() => ${CM}.getLine(${i}))()`);
const getDoc = () => page.evaluate(`(() => ${CM}.getValue())()`);
const getCursor = () => page.evaluate(`(() => { const p = ${CM}.getCursor(); return p.line + ':' + p.ch; })()`);
const press = async (key, times = 1) => {
  for (let i = 0; i < times; i++) { await page.keyboard.press(key); await page.waitForTimeout(120); }
  await page.waitForTimeout(350);
};
const setCursorAt = async (line, ch) => {
  await page.evaluate(`(() => { const c = ${CM}; c.setCursor({ line: ${line}, ch: ${ch} }); c.focus(); })()`);
  await page.waitForTimeout(150);
};
// 光标挪到某格内容末尾（该格右管道符处）
const setCursorCellEnd = async (line, cellIdx) => {
  await page.evaluate(`(() => {
    const c = ${CM};
    const text = c.getLine(${line});
    const pipes = [];
    for (let i = 0; i < text.length; i++) if (text[i] === '|' && text[i - 1] !== '\\\\') pipes.push(i);
    c.setCursor({ line: ${line}, ch: pipes[${cellIdx} + 1] });
    c.focus();
  })()`);
  await page.waitForTimeout(150);
};
// 结构化几何：行高 + 每个格盒子的列/段/矩形
const rows = () => page.evaluate(() => [...document.querySelectorAll('.CodeMirror-line')]
  .filter((l) => l.querySelector('.cm-tbl-cell'))
  .map((l) => {
    const r = l.getBoundingClientRect();
    return {
      // 行里还挂着「…」行菜单的 widget，那点文字不算源码，比对前先剔掉
      text: (() => {
        const clone = l.cloneNode(true);
        clone.querySelectorAll('.CodeMirror-widget').forEach((w) => w.remove());
        return clone.textContent;
      })(),
      h: Math.round(r.height),
      mline: l.className.includes('cm-tbl-mline'),
      boxes: [...l.querySelectorAll('.cm-tbl-cell')].map((b) => {
        const br = b.getBoundingClientRect();
        const cls = b.className;
        const colM = cls.match(/cm-tbl-c(\d+)/);
        const segM = cls.match(/cm-tbl-seg(\d+)/);
        return {
          col: colM ? Number(colM[1]) : -1,
          seg: segM ? Number(segM[1]) : -1,
          full: cls.includes('cm-tbl-full'),
          x: Math.round(br.x), y: Math.round(br.y), w: Math.round(br.width), h: Math.round(br.height),
        };
      }),
    };
  }));

// ---------- R1–R3：换行渲染 ----------
await setDoc(TABLE);
{
  const R = await rows();
  const rowOf = (frag) => R.find((r) => r.text.includes(frag));
  check('R1', '两行格子行高 = 74px', rowOf('a<br>b')?.h === 74, `实际 ${rowOf('a<br>b')?.h}`);
  check('R2', '四个 <br>（含空行）行高 = 149px', rowOf('空')?.h === 149, `实际 ${rowOf('空')?.h}`);
  const segY = rowOf('m1').boxes.filter((b) => b.col === 0).sort((a, b) => a.seg - b.seg).map((b) => b.y);
  check('R2', '各段依次相差 37px（空行占整行）',
    segY.length === 3 && segY[1] - segY[0] === 37 && segY[2] - segY[1] === 37, `y = ${segY.join(',')}`);
  const plainX = rowOf('a1').boxes.filter((b) => b.seg === -1).map((b) => b.x).sort((a, b) => a - b);
  const multiX = rowOf('a<br>b').boxes.filter((b) => b.seg === 0).map((b) => b.x).sort((a, b) => a - b);
  check('R3', '多行行的列与普通行对齐', JSON.stringify(plainX) === JSON.stringify(multiX),
    `普通 ${plainX} / 多行 ${multiX}`);
  const fulls = rowOf('a<br>b').boxes.filter((b) => b.full);
  check('R3', '同行单行格撑满整行高（74px）', fulls.length === 2 && fulls.every((b) => b.h === 74),
    fulls.map((b) => `${b.x}:${b.h}`).join(' | '));
}

// ---------- R4：点击落点与光标 ----------
{
  const pt = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.CodeMirror-line')].find((x) => x.textContent.includes('m1'));
    const b = l.querySelector('.cm-tbl-seg2.cm-tbl-cell');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  check('R4', '点击第三段落到对应字符（4:13）', (await getCursor()) === '4:13', await getCursor());
  const caret = await page.evaluate(`(() => {
    const c = document.querySelector('.CodeMirror-cursor');
    const s = document.querySelector('.cm-tbl-seg2.cm-tbl-cell');
    if (!c || !s) return null;
    const a = c.getBoundingClientRect(), b = s.getBoundingClientRect();
    return { inSeg: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, h: Math.round(a.height) };
  })()`);
  check('R4', '光标画在所在段内（高度 < 37px）', !!caret && caret.inSeg && caret.h < 37, JSON.stringify(caret));
}

// ---------- R5：Ctrl+Enter / 删回单行 ----------
{
  await setDoc(TABLE);
  await setCursorAt(3, 2);
  await press('Control+Enter');
  const line = await getLine(3);
  const grew = (await rows()).find((r) => r.text === line);
  check('R5', 'Ctrl+Enter 后该行变三行高 112px', grew?.h === 112, `${JSON.stringify(line)} -> ${grew?.h}`);
  await setDoc(TABLE);
  await page.evaluate(`(() => {
    const c = ${CM};
    const t = c.getLine(3);
    const i = t.indexOf('<br>');
    c.replaceRange('', { line: 3, ch: i }, { line: 3, ch: i + 4 });
  })()`);
  await page.waitForTimeout(600);
  const back = (await rows()).find((r) => r.text.includes('ab'));
  check('R5', '删掉最后一个 <br> 退回单行渲染', back?.h === 37 && !back?.mline,
    back ? `h=${back.h} mline=${back.mline}` : '没找到该行');
}

// ---------- D1：<br> 整段删 ----------
{
  const cases = [
    ['<br> 之后 Backspace', 3, 7, 'Backspace', '| ab | 1 | 2 |'],
    ['<br> 之前 Delete', 3, 3, 'Delete', '| ab | 1 | 2 |'],
    ['<br> 中间 Backspace', 3, 5, 'Backspace', '| ab | 1 | 2 |'],
    ['<br> 中间 Delete', 3, 5, 'Delete', '| ab | 1 | 2 |'],
    ['<br> 之后 Delete 只删一个字符', 3, 7, 'Delete', '| a<br> | 1 | 2 |'],
    ['<br> 之前 Backspace 只删一个字符', 3, 3, 'Backspace', '| <br>b | 1 | 2 |'],
    ['<br/> 中间 Backspace', 6, 5, 'Backspace', '| xy | p<br />q | r |'],
    ['<br /> 在后 Backspace', 6, 8, 'Backspace', '| xy | p<br />q | r |'],
  ];
  for (const [name, line, ch, key, expect] of cases) {
    await setDoc(TABLE);
    await setCursorAt(line, ch);
    await press(key);
    const got = await getLine(line);
    check('D1', name, got === expect, got === expect ? '' : `实得 ${JSON.stringify(got)}`);
  }
}

// ---------- D2：不动骨架 ----------
{
  let eaten = 0;
  const lines = TABLE.split('\n');
  for (let line = 0; line < lines.length; line++) {
    const text = lines[line];
    for (const key of ['Delete', 'Backspace']) {
      for (let ch = 0; ch <= text.length; ch++) {
        await page.evaluate(`(() => { const c = ${CM}; c.setValue(''); })()`);
        await page.evaluate(`(() => { const c = ${CM}; c.setValue(${JSON.stringify(TABLE)}); c.setCursor({ line: ${line}, ch: ${ch} }); c.focus(); })()`);
        await page.waitForTimeout(45);
        await page.keyboard.press(key);
        await page.waitForTimeout(95);
        const after = await getLine(line);
        if ((text.match(/\|/g) || []).length !== (after.match(/\|/g) || []).length) eaten++;
      }
    }
  }
  check('D2', '穷举所有光标位置：管道符一个都没被吃掉', eaten === 0, `${eaten} 处`);
  await setDoc(TABLE);
  await setCursorCellEnd(2, 0);
  await press('Delete', 8);
  check('D2', '格末连按 8 次 Delete：内容一字未动', (await getLine(2)) === '| a1 | b1 | c1 |', await getLine(2));
}

// ---------- D3/D4：非表格与表格外 ----------
{
  await setDoc('||');
  await setCursorAt(0, 2);
  await press('Backspace', 2);
  check('D3', '单独一行 || 能被 Backspace 删掉', (await getDoc()) === '', JSON.stringify(await getDoc()));
  const outside = '正文 a<br>b 段落';
  await setDoc(outside);
  await setCursorAt(0, outside.length);          // 行尾，往回删
  await press('Backspace');
  const outsideAfter = await getDoc();
  check('D4', '表格外的 <br> 逐字删（只少一个字符，<br> 完好）',
    outsideAfter.length === outside.length - 1 && outsideAfter.includes('<br>'),
    JSON.stringify(outsideAfter));
}

// ---------- K1–K5：Tab / Enter ----------
{
  const reset = () => setDoc(TABTABLE);
  const cellEnd = async (line, idx) => setCursorCellEnd(line, idx);

  await reset();
  await cellEnd(3, 2);
  await press('Tab');
  let L = (await getDoc()).split('\n');
  check('K1', '本行最后一格按 Tab：新行紧跟本行之后',
    L[4]?.trim() === '|   |   |   |' && L[5]?.includes('a3') && L.length === 6, JSON.stringify(L.slice(2, 6)));
  await reset();
  await cellEnd(4, 2);
  await press('Tab');
  L = (await getDoc()).split('\n');
  check('K1', '最后一行按 Tab：新行加在末尾', L.length === 6 && L[5].trim() === '|   |   |   |', JSON.stringify(L.slice(4)));
  await reset();
  await cellEnd(2, 2);
  await press('Tab');
  L = (await getDoc()).split('\n');
  check('K1', '第一行数据行按 Tab：插在它后面', L[3].trim() === '|   |   |   |' && L[4].includes('a2'), JSON.stringify(L.slice(2, 5)));

  await reset();
  await setCursorAt(2, 3);
  const before = await getDoc();
  await press('Tab');
  check('K2', '非最后一格按 Tab：不新增行', (await getDoc()) === before, `${(await getDoc()).split('\n').length} 行`);
  check('K2', '非最后一格按 Tab：光标右移到下一格（2:7）', (await getCursor()) === '2:7', await getCursor());

  await reset();
  await cellEnd(0, 2);
  await press('Tab');
  L = (await getDoc()).split('\n');
  check('K3', '表头行按 Tab：插在分隔行之后，结构不散',
    L[0].includes('A') && L[1].startsWith('|---') && L[2].trim() === '|   |   |   |' && L[3].includes('a1'),
    JSON.stringify(L.slice(0, 4)));

  await reset();
  await setCursorAt(2, 3);
  await press('Enter');
  check('K4', 'Enter 跳到下一行同一格（3:2）', (await getCursor()) === '3:2', await getCursor());
  await setCursorAt(4, 3);
  await press('Enter');
  L = (await getDoc()).split('\n');
  check('K4', 'Enter 在最后一行：末尾插一行并跳过去', L.length === 6 && (await getCursor()) === '5:4',
    `${L.length} 行，光标 ${await getCursor()}`);

  await setDoc('正文');
  await setCursorAt(0, 0);
  const n0 = (await getDoc()).split('\n').length;
  await press('Tab');
  check('K5', '表格外 Tab 不插行（走默认缩进）', (await getDoc()).split('\n').length === n0, JSON.stringify(await getDoc()));
}

// ---------- M1–M5：数据行右侧的「…」行菜单 ----------
{
  const MENUTABLE = [
    '| A | B | C |',
    '|---|---|---|',
    '| a1 | b1 | c1 |',
    '| m1<br>m2 | b2 | c2 |',
    '| a3 | b3 | c3 |',
  ].join('\n');
  const buttons = () => page.evaluate(() => [...document.querySelectorAll('.cm-tbl-menu-btn')].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), opacity: getComputedStyle(b).opacity };
  }));
  const btnOfRow = (frag) => page.evaluate(`(() => {
    const l = [...document.querySelectorAll('.CodeMirror-line')].find((x) => x.textContent.includes(${JSON.stringify(frag)}));
    if (!l) return null;
    const b = l.querySelector('.cm-tbl-menu-btn');
    const cells = l.querySelectorAll('.cm-tbl-cell');
    if (!b || !cells.length) return null;
    const br = b.getBoundingClientRect(), cr = cells[cells.length - 1].getBoundingClientRect();
    return { x: Math.round(br.x), right: Math.round(cr.right), outside: br.x >= cr.right,
             opacity: getComputedStyle(b).opacity };
  })()`);

  await setDoc(MENUTABLE);
  const bs = await buttons();
  check('M3', '按钮数量 = 数据行数（3），表头与分隔行没有', bs.length === 3, `${bs.length} 个`);
  await setCursorAt(2, 3);                     // 光标落在第 3 行（a1 行）
  await page.waitForTimeout(250);
  const op = (await buttons()).map((b) => b.opacity);
  check('M1', '光标所在行按钮显形，其余行不显示', op[0] === '1' && op[1] === '0' && op[2] === '0', op.join(','));
  const normal = await btnOfRow('a1');
  check('M1', '按钮在最后一格之外（表格右侧）', normal?.outside === true, JSON.stringify(normal));
  const multi = await btnOfRow('m1');
  check('M4', '含 <br> 的多行行也有按钮，且在最后一格右侧', multi?.outside === true, JSON.stringify(multi));

  // 点按钮 -> 菜单；点菜单项 -> 删行
  const caretBefore = await getCursor();
  const pt = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.CodeMirror-line')].find((x) => x.textContent.includes('a1'));
    const r = l.querySelector('.cm-tbl-menu-btn').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(300);
  const menu = await page.evaluate(() => {
    const m = document.querySelector('.cm-tbl-rowmenu');
    return m ? [...m.querySelectorAll('button')].map((b) => b.textContent) : null;
  });
  check('M2', '点「…」弹出菜单，含「删除本行」', !!menu && menu.includes('删除本行'), JSON.stringify(menu));
  check('M5', '点按钮不会把光标挪走', (await getCursor()) === caretBefore, `${caretBefore} -> ${await getCursor()}`);
  await page.click('.cm-tbl-rowmenu-item');
  await page.waitForTimeout(600);
  const afterDel = (await getDoc()).split('\n');
  check('M2', '删除后该行消失、表格列数与其余行不变',
    afterDel.length === 4 && !afterDel.some((l) => l.includes('a1')) &&
    afterDel[2].includes('m1') && afterDel[3].includes('a3') &&
    (afterDel[0].match(/\|/g) || []).length === 4,
    JSON.stringify(afterDel));
  check('M5', '删除后菜单自动收起', (await page.evaluate(() => !document.querySelector('.cm-tbl-rowmenu'))));

  // Esc 收起
  await setDoc(MENUTABLE);
  await setCursorAt(2, 3);
  await page.waitForTimeout(200);
  const pt2 = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.CodeMirror-line')].find((x) => x.textContent.includes('a1'));
    const r = l.querySelector('.cm-tbl-menu-btn').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(pt2.x, pt2.y);
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() => !!document.querySelector('.cm-tbl-rowmenu'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  const closedByEsc = await page.evaluate(() => !document.querySelector('.cm-tbl-rowmenu'));
  check('M5', '按 Esc 收起菜单', opened && closedByEsc, `打开=${opened} Esc后关闭=${closedByEsc}`);
  // 点别处收起
  await page.mouse.click(pt2.x, pt2.y);
  await page.waitForTimeout(250);
  await page.mouse.click(1000, 600);           // 表格外的空白处
  await page.waitForTimeout(300);
  check('M5', '点菜单外收起菜单', await page.evaluate(() => !document.querySelector('.cm-tbl-rowmenu')));
}

// ---------- B1：普通表格基线 ----------
{
  await setDoc(TABTABLE);
  const R = await rows();
  const okH = R.every((r) => r.h === 37);
  check('B1', '普通表格每行 37px', okH, R.map((r) => r.h).join(','));
  const cols = R[2]?.boxes.map((b) => b.x);
  check('B1', '普通表格列位稳定（3 列且递增）',
    cols?.length === 3 && cols[0] < cols[1] && cols[1] < cols[2], JSON.stringify(cols));
  // 点击第 2 格中心：落点必须落在该格的字符区间内（不写死具体列号，随内容变）
  const cellRange = await page.evaluate(`(() => {
    const t = ${CM}.getLine(3);
    const pipes = [];
    for (let i = 0; i < t.length; i++) if (t[i] === '|' && t[i - 1] !== '\\\\') pipes.push(i);
    return { start: pipes[1] + 1, end: pipes[2] };
  })()`);
  const pt = await page.evaluate(() => {
    const l = [...document.querySelectorAll('.CodeMirror-line')].find((x) => x.textContent.includes('b2'));
    const b = l.querySelector('.cm-tbl-c1.cm-tbl-cell');
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(200);
  const [clickLine, clickCh] = (await getCursor()).split(':').map(Number);
  check('B1', '普通表格点击第 2 格：落点在该格字符区间内',
    clickLine === 3 && clickCh >= cellRange.start && clickCh <= cellRange.end,
    `${await getCursor()}（格区间 ${cellRange.start}..${cellRange.end}）`);
}

await browser.close();

console.log(`\nchecklist 结果：${pass} 项通过 / ${fail} 项失败`);
if (failures.length) console.log('未通过：\n  - ' + failures.join('\n  - '));
if (errors.length) console.log('页面 JS 报错：' + errors.join(' | '));
process.exit(fail || errors.length ? 1 : 0);
