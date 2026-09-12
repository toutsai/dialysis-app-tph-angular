export interface InventoryLocation {
  section: string;
  view: string;
  tab: string;
  report: string;
  date: string;
  category: string;
  item: string;
  mode: string;
}
const administrative = ['physician', 'register', 'injection', 'gentamycin', 'catastrophic'];
const viewTabs: Record<string, string[]> = {
  overview: ['dashboard'], calendar: ['purchase', 'counts', 'consumption', 'weekly'],
  reports: ['consumption', 'stock-report'], settings: ['items', 'beds'],
};
/** URL values describe presentation only; authorization remains in PAGE_ACCESS/route guards. */
export function inventoryLocation(input: Record<string, string | null | undefined>): InventoryLocation {
  const section = input['section'] === 'inventory' ? 'inventory' : administrative.includes(input['section'] || '') ? input['section']! : 'physician';
  const view = Object.hasOwn(viewTabs, input['view'] || '') ? input['view']! : 'overview';
  const tabs = viewTabs[view];
  const tab = tabs.includes(input['tab'] || '') ? input['tab']! : tabs[0];
  const date = input['date'] || '';
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  const category = ['artificialKidney', 'dialysateCa', 'bicarbonateType'].includes(input['category'] || '') ? input['category']! : '';
  return { section, view: section === 'inventory' ? view : 'overview', tab: section === 'inventory' ? tab : 'dashboard',
    report: view === 'reports' && input['report'] === 'monthly' ? 'monthly' : view === 'calendar' && tab === 'consumption' && input['report'] === 'theoretical' ? 'theoretical' : '', date: validDate ? date : '', category, item: category ? input['item'] || '' : '', mode: input['mode'] === 'month' ? 'month' : 'week' };
}
export function inventoryUrl(state: InventoryLocation): string {
  const query = new URLSearchParams();
  if (state.section !== 'physician') query.set('section', state.section);
  if (state.section === 'inventory') {
    query.set('view', state.view);
    if (state.tab !== viewTabs[state.view][0]) query.set('tab', state.tab);
    if (state.report) query.set('report', state.report);
    if (state.view === 'calendar' && state.mode === 'month') query.set('mode', 'month');
    if (state.date) query.set('date', state.date);
    if (state.category) query.set('category', state.category);
    if (state.item) query.set('item', state.item);
  }
  return '/inventory' + (query.size ? '?' + query.toString() : '');
}
/** Check before touching state. Rejected back/query navigation restores the accepted URL once. */
export class InventoryNavigation {
  accepted: InventoryLocation | null = null;
  accept(target: InventoryLocation, allow: () => boolean, commit: (state: InventoryLocation) => boolean | void, restore: (url: string) => void): boolean {
    if (this.accepted && inventoryUrl(target) === inventoryUrl(this.accepted)) return true;
    if (this.accepted && !allow()) { restore(inventoryUrl(this.accepted)); return false; }
    if (commit(target) === false) { if (this.accepted) restore(inventoryUrl(this.accepted)); return false; }
    this.accepted = target;
    return true;
  }
}

export const inventoryScrollPositions = new Map<string, number>();
