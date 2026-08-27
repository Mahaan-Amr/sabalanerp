type Product = Readonly<Record<string, unknown>>;
const record = (v: unknown): Product => v && typeof v === 'object' && !Array.isArray(v) ? v as Product : {};
const identity = (p: Product) => String(p.rowId ?? p.productRowId ?? '');
const source = (p: Product) => record(record(p.meta).remainingSource);
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((id): id is string => typeof id === 'string') : [];

/** Use identities and physical lineage, not names/catalog matches, to scope manual recovery. */
export const remainingRecoveryGuidance = (products: readonly Product[], badRowId: string, causeCode?: string) => {
  const byId = new Map(products.map(p => [identity(p), p]));
  const edges = new Map<string, Set<string>>();
  const producers = new Map<string, Set<string>>();
  const addEdge = (parent: string, child: string) => {
    if (!byId.has(parent) || !byId.has(child)) return;
    edges.set(parent, new Set([...(edges.get(parent) ?? []), child]));
  };
  for (const p of products) for (const stone of strings(source(p).generatedRemainingStoneIds)) {
    producers.set(stone, new Set([...(producers.get(stone) ?? []), identity(p)]));
  }
  for (const p of products) {
    const id = identity(p);
    const s = source(p);
    for (const parent of [p.parentProductRowId, s.sourceProductRowId]) {
      if (typeof parent === 'string') addEdge(parent, id);
    }
    for (const stone of strings(s.consumedSourceStoneIds)) {
      for (const parent of producers.get(stone) ?? []) addEdge(parent, id);
    }
  }
  const bad = byId.get(badRowId);
  const sourceProductRowId = typeof source(bad ?? {}).sourceProductRowId === 'string'
    ? source(bad ?? {}).sourceProductRowId as string
    : typeof bad?.parentProductRowId === 'string' ? bad.parentProductRowId : undefined;
  const rootId = sourceProductRowId ?? badRowId;
  const chain = products.filter(p => identity(p) === rootId || source(p).sourceProductRowId === rootId);
  const chainIds = new Set(chain.map(identity));
  const originalIds = new Set<string>();
  const originalInventory = byId.get(rootId)?.remainingStoneSourceInventory;
  if (Array.isArray(originalInventory)) for (const value of originalInventory) {
    const stone = record(value);
    if (typeof stone.id !== 'string' || !Number.isSafeInteger(stone.quantity) || Number(stone.quantity) < 1) continue;
    if (stone.quantity === 1) originalIds.add(stone.id);
    else for (let i = 1; i <= Number(stone.quantity); i++) originalIds.add(`${stone.id}:unit:${i}`);
  }
  const consumedIds = new Set<string>();
  const brokenLineage = chain.some(p => identity(p) !== rootId && (
    !Array.isArray(source(p).consumedSourceStoneIds) || !Array.isArray(source(p).generatedRemainingStoneIds) ||
    !strings(source(p).consumedSourceStoneIds).length ||
    [source(p).consumedSourceStoneIds, source(p).generatedRemainingStoneIds].some(value =>
      !Array.isArray(value) || strings(value).length !== value.length || new Set(value).size !== value.length) ||
    strings(source(p).consumedSourceStoneIds).some(stone => {
      const owners = producers.get(stone);
      const validOrigin = originalIds.has(stone) ? !owners?.size : owners?.size === 1 &&
        [...owners].every(id => id !== identity(p) && chainIds.has(id));
      const duplicate = consumedIds.has(stone);
      consumedIds.add(stone);
      return !validOrigin || duplicate;
    })
  ));
  const unsupportedLayout = ['unsupported-physical-layout', 'ambiguous-physical-layout', 'ambiguous-layer-consumption-order'].includes(causeCode ?? '');
  const uncertain = unsupportedLayout || causeCode === 'consumed-source-child-mismatch' ||
    (causeCode === 'final-inventory-mismatch' && chain.length === 1) ||
    brokenLineage || chainIds.size !== chain.length ||
    !bad || (sourceProductRowId !== undefined && !byId.has(sourceProductRowId)) ||
    chain.some(p => identity(p) !== rootId && (!Array.isArray(source(p).consumedSourceStoneIds) ||
      !Array.isArray(source(p).generatedRemainingStoneIds))) ||
    [...producers.values()].some(ids => ids.size > 1 && [...ids].some(id => chain.some(p => identity(p) === id)));
  const affected = new Set<string>();
  const visit = (id: string) => {
    if (affected.has(id) || !byId.has(id)) return;
    affected.add(id);
    for (const child of edges.get(id) ?? []) visit(child);
  };
  visit(badRowId);
  if (uncertain) for (const p of chain) visit(identity(p));
  const order: string[] = [];
  const pending = new Set(affected);
  while (pending.size) {
    const ready = [...pending].filter(id => ![...pending].some(parent => edges.get(parent)?.has(id)));
    if (!ready.length) break;
    ready.sort((a, b) => products.findIndex(p => identity(p) === a) - products.findIndex(p => identity(p) === b));
    const id = ready[0];
    order.push(id); pending.delete(id);
  }
  const label = (id: string) => {
    const index = products.findIndex(p => identity(p) === id);
    if (index < 0) return `شناسهٔ ${id} (در پیش‌نویس یافت نشد)`;
    const title = String(products[index].stoneName ?? products[index].name ?? 'بدون نام');
    return `ردیف ${index + 1} «${title}»`;
  };
  const shortLabel = (id: string) => `ردیف ${products.findIndex(p => identity(p) === id) + 1}`;
  const dependencies = [...affected].filter(id => id !== badRowId);
  const rootText = sourceProductRowId ? ` منبع سنگ: ${label(sourceProductRowId)}.` : '';
  const immediateSources = [...new Set(strings(source(bad ?? {}).consumedSourceStoneIds)
    .flatMap(id => [...(producers.get(id) ?? [])]))];
  const immediateText = immediateSources.length ? ` سنگ مصرف‌شده در این ردیف از باقی‌ماندهٔ ${immediateSources.map(label).join('، ')} تولید شده است.` : '';
  const dependencyText = dependencies.length ? ` ${uncertain ? 'ردیف‌های مرتبط برای بررسی وابستگی' : 'ردیف‌های وابسته'}: ${dependencies.map(label).join('، ')}.` : ' ردیف وابسته‌ای در این زنجیره شناسایی نشد.';
  const instructions = uncertain || pending.size || !affected.size
    ? ' ترتیب وابستگی قابل تأیید نیست؛ ردیفی را حذف نکنید و با کد پیگیری از پشتیبانی کمک بگیرید.'
    : ` مشخصات ردیف‌ها را حفظ کنید. ترتیب ساخت مجدد از همان سنگ منبع: ${order.map(shortLabel).join(' سپس ')}.` +
      (dependencies.length ? ` در صورت نیاز به حذف دستی برای جایگزینی، ترتیب حذف برعکس است: ${[...order].reverse().map(shortLabel).join(' سپس ')}.` : ' فقط همین ردیف را بازسازی کنید؛ حذف محصولات مستقل لازم نیست.');
  return {
    sourceProductRowId, relatedProductRowIds: [...affected], rebuildProductRowIds: uncertain || pending.size ? [] : order,
    message: `بازسازی خودکار ${label(badRowId)} بدون تغییر مبلغ یا مصرف سنگ قابل تأیید نیست.${reason(causeCode)}${rootText}${immediateText}${dependencyText}${unsupportedLayout ? ' صرف ساخت مجدد همین چیدمان کافی نیست؛ شواهد دقیق سهم هر قطعه از منبع باید بررسی شود.' : ''}${instructions} هیچ ردیف یا مبلغی خودکار تغییر نکرده و پیش‌نویس حفظ شده است. ثبت فقط پس از کنترل دوبارهٔ کل زنجیره امکان‌پذیر است.`
  };
};

const reason = (code?: string) => {
  if (!code) return '';
  if (code.includes('price') || code.includes('total') || code.includes('zero-material')) return ' شواهد مبلغ مواد اولیه، برش یا عملیات با محاسبهٔ معتبر ردیف سازگار نیست.';
  if (code.includes('inventory') || code.includes('consumed')) return ' موجودی منبع یا سابقهٔ مصرف سنگ با باقی‌ماندهٔ ثبت‌شده سازگار نیست.';
  if (code.includes('order')) return ' ترتیب مصرف سنگ در ردیف‌های وابسته روشن یا یکتا نیست.';
  if (code.includes('lineage') || code.includes('identity') || code.includes('ownership')) return ' شناسهٔ منبع یا ارتباط مصرف سنگ بین ردیف‌ها ناقص یا متناقض است.';
  if (code.includes('layout') || code.includes('geometry') || code.includes('piece')) return ' ابعاد یا چیدمان هر قطعه روی سنگ منبع با شواهد موجود قابل بازسازی دقیق نیست.';
  return ' بخشی از شواهد لازم برای بازسازی دقیق این ردیف ناقص یا متناقض است.';
};
