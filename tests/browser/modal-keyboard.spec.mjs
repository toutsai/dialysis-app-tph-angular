import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ts = require('../../angular-client/node_modules/typescript');
const source = readFileSync(new URL('../../angular-client/src/app/core/directives/modal-focus.directive.ts', import.meta.url), 'utf8')
  .replace(/^import .*;\r?$/gm, '').replace('export class ModalFocusDirective', 'class ModalFocusDirective');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, experimentalDecorators: true,
} }).outputText;

// Exercise the real directive methods against Chromium's native focus/top layer.
// Angular injection/lifecycle are supplied here; application integration is tested in the workflow specs.
async function mountHarness(page, markup) {
  await page.setContent(markup);
  await page.addScriptTag({ content: `
    const DOCUMENT = Symbol(), ElementRef = Symbol();
    let injectedHost;
    const inject = token => token === DOCUMENT ? document : { nativeElement: injectedHost };
    const Directive = () => value => value, Input = () => () => {}, Output = () => () => {};
    class EventEmitter { count = 0; emit() { this.count++; } }
    ${compiled}
    window.focusInstances = new Map();
    window.mountFocus = id => {
      injectedHost = document.getElementById(id);
      const instance = new ModalFocusDirective();
      focusInstances.set(id, instance); instance.ngAfterViewInit();
    };
    window.unmountFocus = id => {
      focusInstances.get(id).ngOnDestroy(); focusInstances.delete(id);
      document.getElementById(id).remove();
    };
  ` });
}

test('modal Tab cycle excludes hidden/disabled controls, blocks busy Escape and restores focus', async ({ page }) => {
  await mountHarness(page, `<button id="trigger">編輯</button><section id="editor">
    <button id="first" autofocus>姓名</button><button disabled>不可選</button>
    <button hidden>隱藏</button><div inert><button>背景</button></div>
    <button id="last">儲存</button></section><button id="outside">外部</button>`);
  await page.locator('#trigger').focus();
  await page.evaluate(() => window.mountFocus('editor'));
  await expect(page.locator('#first')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#last')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#first')).toBeFocused();
  await page.locator('#outside').focus();
  await expect(page.locator('#first')).toBeFocused();
  await page.evaluate(() => { window.focusInstances.get('editor').modalEscapeDisabled = true; });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.focusInstances.get('editor').modalEscape.count)).toBe(0);
  await page.evaluate(() => { window.focusInstances.get('editor').modalEscapeDisabled = false; });
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.focusInstances.get('editor').modalEscape.count)).toBe(1);
  await page.evaluate(() => window.unmountFocus('editor'));
  await expect(page.locator('#trigger')).toBeFocused();
});

test('confirmation above a native dialog owns the top layer and returns to the parent control', async ({ page }) => {
  await mountHarness(page, `<button id="trigger">開啟</button>
    <dialog id="parent"><button id="child-trigger">刪除</button><button>關閉</button></dialog>
    <dialog id="confirm"><button id="cancel" autofocus>取消</button><button id="confirm-save">確認</button></dialog>`);
  await page.locator('#trigger').focus();
  await page.evaluate(() => { document.getElementById('parent').showModal(); });
  await page.locator('#child-trigger').focus();
  await page.evaluate(() => window.mountFocus('confirm'));
  await expect(page.locator('#cancel')).toBeFocused();
  expect(await page.locator('#confirm').evaluate(element => element.matches(':modal'))).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#confirm-save')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#cancel')).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.focusInstances.get('confirm').modalEscape.count)).toBe(1);
  expect(await page.locator('#parent').evaluate(element => element.open)).toBe(true);
  await page.evaluate(() => window.unmountFocus('confirm'));
  await expect(page.locator('#child-trigger')).toBeFocused();
  expect(await page.locator('#parent').evaluate(element => element.matches(':modal'))).toBe(true);
});

test('nested custom editors return focus in order without escaping to the page', async ({ page }) => {
  await mountHarness(page, `<button id="trigger">開啟</button>
    <section id="parent"><button id="child-trigger">子視窗</button><button>完成</button>
      <section id="child"><button id="child-first">選擇</button><button id="child-last">關閉</button></section>
    </section>`);
  await page.locator('#trigger').focus();
  await page.evaluate(() => window.mountFocus('parent'));
  await page.locator('#child-trigger').focus();
  await page.evaluate(() => window.mountFocus('child'));
  await expect(page.locator('#child-first')).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#child-last')).toBeFocused();
  await page.evaluate(() => window.unmountFocus('child'));
  await expect(page.locator('#child-trigger')).toBeFocused();
  await page.evaluate(() => window.unmountFocus('parent'));
  await expect(page.locator('#trigger')).toBeFocused();
});
