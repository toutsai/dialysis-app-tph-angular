import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(new URL('../angular-client/package.json', import.meta.url));
const ts = require('typescript');
const base = '../angular-client/src/app/features/daily-log/daily-log.component';
const source = ts.createSourceFile('daily', readFileSync(new URL(base + '.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
const names = ['showAutocomplete', 'selectPatient', 'handleConfirm', 'handleWardNumberConfirm', 'handleVascularRejectConfirm', 'onNotesUpdated'];
const methods = source.statements.find(ts.isClassDeclaration).members.filter(member => names.includes(member.name?.getText(source))).map(member => member.getText(source)).join('\n');
const out = {};
new Function('exports', ts.transpileModule(`export class Fixture { ${methods} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)(out);

test('pending load or restore prevents overlay callbacks from mutating the current day', async () => {
  for (const phase of ['load', 'restore']) {
    let invoked = false;
    const component = Object.assign(new out.Fixture(), {
      isLoading: () => phase === 'load', historyRestoring: () => phase === 'restore', isPageLocked: false,
      dailyLog: { patientMovements: [{ name: 'retained' }], vascularAccessLog: [] }, handoverNotes: 'retained',
      confirmAction: () => { invoked = true; }, handleCancel: () => { invoked = true; },
    });
    component.selectPatient({ name: 'wrong patient' }, 0, 'movements');
    component.showAutocomplete({}, 0, 'movements');
    component.handleConfirm();
    await component.handleWardNumberConfirm('wrong ward');
    await component.handleVascularRejectConfirm('wrong reason');
    component.onNotesUpdated('wrong notes');
    assert.equal(component.dailyLog.patientMovements[0].name, 'retained');
    assert.equal(component.handoverNotes, 'retained');
    assert.equal(invoked, false);
  }
});

test('all external mutation overlays share inert protection while history stays outside', async () => {
  const { parseTemplate } = await import(pathToFileURL(require.resolve('@angular/compiler')).href);
  const parsed = parseTemplate(readFileSync(new URL(base + '.html', import.meta.url), 'utf8'), 'daily.html');
  assert.equal(parsed.errors, null);
  const all = [];
  const walk = nodes => { for (const node of nodes || []) { all.push(node); walk(node.children); walk(node.branches); } };
  walk(parsed.nodes);
  const wrapper = all.find(node => node.attributes?.some(attribute => attribute.name === 'class' && attribute.value === 'daily-log-mutation-overlays'));
  assert(wrapper);
  const lock = wrapper.inputs.find(input => input.name === 'inert');
  assert.match(lock.value.source, /isLoading\(\) \|\| historyRestoring\(\)/);
  const descendants = [];
  const collect = nodes => { for (const node of nodes || []) { descendants.push(node); collect(node.children); collect(node.branches); } };
  collect(wrapper.children);
  for (const name of ['app-ward-number-dialog', 'app-vascular-access-event-dialog', 'app-confirm-dialog', 'app-handover-notes-dialog']) assert(descendants.some(node => node.name === name), name);
  assert(descendants.some(node => node.name === 'ul' && node.attributes?.some(attribute => attribute.value === 'global-autocomplete-results')));
  assert(!descendants.some(node => node.name === 'app-daily-log-history'));
});
