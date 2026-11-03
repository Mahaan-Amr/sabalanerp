const fs = require('fs');
const path = 'frontend/src/app/dashboard/accounting/customer-accounts/[id]/page.tsx';
let text = fs.readFileSync(path, 'utf8');
const headerStart = text.indexOf('    primaryAction={');
const headerEnd = text.indexOf('    {loading &&', headerStart);
text = text.slice(0, headerStart) + '    >\n' + text.slice(headerEnd);
const start = text.indexOf('      <ErpCard className="p-4 sm:hidden">');
const end = text.indexOf("      {tab === 'overview'", start);
text = text.slice(0, start) + `      <div className="flex flex-wrap gap-2">
        {data.capabilities.canManageTreasury && <><ErpButton label="ثبت دریافت" icon={FaMoneyBillWave} tone="success" variant="solid" onClick={() => openOperation('RECEIPT')} /><ErpButton label="تخصیص به بدهی" onClick={() => openOperation('ALLOCATION')} /></>}
        {(operations.length > 0 || data.capabilities.canExport) && <ErpButton label="سایر عملیات" tone="neutral" onClick={() => setOperationsOpen(true)} />}
        <ErpButton label="به‌روزرسانی" icon={FaSync} tone="neutral" onClick={() => void load()} />
      </div>
      <ErpCard className={workspaceStyles.summary}>
        <div className={workspaceStyles.balance}><span className="text-xs sds-text-secondary">مانده · {accountBalanceLabel(data.netBalanceRials)}</span><strong>{accountMoney(data.netBalanceRials)}</strong></div>
        <div><span className="text-sm sds-text-secondary">بدهی باز قطعی</span><strong>{accountMoney(data.debitOpenRials ?? data.receivableRials)}</strong>{insight && BigInt(insight.overdueRials) > BigInt(0) && <ErpBadge tone="danger">{accountMoney(insight.overdueRials)} معوق</ErpBadge>}</div>
        <div><span className="text-sm sds-text-secondary">دریافت آماده تخصیص</span><strong className={workspaceStyles.success}>{accountMoney(data.unallocatedCreditRials)}</strong></div>
      </ErpCard>
      <ErpSegmentedControl value={tab} onChange={setTab} options={[
        {value:'overview',label:'خلاصه'}, {value:'items',label:'بدهی و اعتبار'}, {value:'receipts',label:'دریافت‌ها و چک‌ها'},
        {value:'contracts',label:'قراردادها',count:data.contracts.length,countTone:'neutral'}, {value:'records',label:'رکوردها و دریافتنی‌ها',count:data.financialRecords.length,countTone:'neutral'},
        {value:'statement',label:'ریزگردش'}, {value:'analytics',label:'تحلیل'},
      ]} />
      {tab === 'analytics' && <CustomerAccountAnalytics account={data} />}
      {tab === 'items' && <>
        <ErpField label="جستجوی بدهی و اعتبار"><ErpInput type="search" value={itemSearch} onChange={event => setItemSearch(event.target.value)} placeholder="فاکتور یا قرارداد" /></ErpField>
        <ErpSegmentedControl value={itemFilter} onChange={setItemFilter} options={[{value:'open',label:'باز'},{value:'all',label:'همه'},{value:'overdue',label:'معوق'},{value:'credit',label:'بستانکاری'}]} />
        <AccountCards key={itemFilter + itemSearch} items={data.activityItems.filter(item => {
          const record = recordForPostedItem(data,item);
          return (itemFilter === 'all' || itemFilter === 'overdue' && item.kind === 'RECEIVABLE' && item.agingDays > 0 && BigInt(item.remainingRials) > BigInt(0) || itemFilter === 'credit' && item.kind === 'CREDIT' || itemFilter === 'open' && BigInt(item.remainingRials) > BigInt(0))
            && (item.invoiceNumber + ' ' + (item.description || '') + ' ' + contractName(item.contractId) + ' ' + (record?.systemInvoiceNumber || '')).includes(itemSearch);
        })} empty="قلمی پیدا نشد" render={item => <ErpCard key={item.id} className="space-y-3 p-4" tone={item.kind === 'CREDIT' || BigInt(item.remainingRials) === BigInt(0) ? 'success' : item.agingDays > 0 ? 'danger' : 'neutral'}>
          <div className="flex flex-wrap justify-between gap-3"><div className="min-w-0"><strong className="break-words">{item.invoiceNumber}</strong><p className="mt-1 text-xs sds-text-secondary">{contractName(item.contractId)} · {item.kind === 'CREDIT' ? 'بستانکاری' : 'دریافتنی'} · {dateFa(item.dueAt)}</p></div><strong>{accountMoney(item.remainingRials)}</strong></div>
          <ErpButton label="جزئیات بدهی / اعتبار" tone="neutral" onClick={() => setItemId(item.id)} />
        </ErpCard>} />
      </>}
` + text.slice(end);
// Keep every existing summary, with secondary information disclosed on demand.
text = text.replace("{tab === 'overview' && <>", `{tab === 'overview' && <>
        <ErpDisclosure title="اطلاعات حساب"><ErpSummaryGrid columns={3} items={[
          {label:'بستانکاری مستقل آزاد',value:accountMoney(data.standaloneCreditRials ?? '0')},
          {label:'قابل استرداد نقدی',value:accountMoney(data.refundableRials ?? '0'),hint:'پس از وصول و کسر مصرف معتبر'},
          {label:'مبلغ قراردادهای جاری',value:contractTotals || 'بدون قرارداد جاری',hint:'مبلغ قرارداد، بدهی قطعی نیست'},
        ]} /></ErpDisclosure>`);
text = text.replace('<ErpSection title="افتتاحیه بررسی‌شده">','<ErpDisclosure title="افتتاحیه بررسی‌شده">');
text = text.replace('</ErpDisclosure>}</ErpSection>}','</ErpDisclosure>}</ErpDisclosure>}');
text = text.replace("onClick: () => setTab('statement') }]}>", "onClick: () => setTab('items') }]}>");
text = text.replace('<p className="mt-3 text-lg font-bold">{accountMoney(item.remainingRials)}</p></ErpCard>', '<p className="mt-3 text-lg font-bold">{accountMoney(item.remainingRials)}</p><ErpButton label="جزئیات بدهی / اعتبار" tone="neutral" onClick={() => setItemId(item.id)} /></ErpCard>');
// Receipt tracing supplements, rather than replaces, the original receipt/check/audit sections.
text = text.replace("{tab === 'receipts' && <>", `{tab === 'receipts' && <>
        <CustomerReceiptTrace account={data} onAllocate={() => openOperation('ALLOCATION')} onItem={setItemId} onEvidence={id => void openEvidence(id)} evidenceLoading={evidenceLoading} />`);
// Preserve full receipt voucher access and refund history which was previously absent from the tab.
text = text.replace('<ErpSection title="تخصیص بستانکاری مستقل">', `<ErpSection title="استردادها"><AccountCards items={data.refunds} empty="استردادی ثبت نشده است" render={row => <ErpCard key={row.id} className="space-y-3 p-4"><strong>{accountMoney(row.amountRials)}</strong><p>{dateFa(row.occurredAt)}</p><ErpButton label="سند استرداد" tone="neutral" onClick={() => void openEvidence(row.postedVoucherId)} disabled={evidenceLoading} /></ErpCard>} /></ErpSection><ErpSection title="تخصیص بستانکاری مستقل">`);
const overlay = text.indexOf('    {data && operation &&');
text = text.slice(0,overlay) + `    <ErpSheet open={operationsOpen} onClose={() => setOperationsOpen(false)} title="عملیات حساب" presentation="modal" size="wide">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{operations.map(action => <ErpButton key={action.label} {...action} tone="neutral" />)}
        {data?.capabilities.canExport && <><ErpButton label="خروجی PDF" icon={FaFilePdf} onClick={() => void download('pdf')} disabled={exporting || !data.profile} /><ErpButton label="خروجی Excel" icon={FaFileExcel} onClick={() => void download('xlsx')} disabled={exporting || !data.profile} /></>}
      </div>
    </ErpSheet>
    <ErpSheet open={Boolean(itemId && data)} onClose={() => setItemId(undefined)} title="جزئیات بدهی / اعتبار" presentation="modal" size="wide">
      {data && itemId && <CustomerPostedItems account={data} items={data.activityItems.filter(item => item.id === itemId)} title="قلم قطعی" onEvidence={id => void openEvidence(id)} evidenceLoading={evidenceLoading} />}
    </ErpSheet>
` + text.slice(overlay);
fs.writeFileSync(path,text);
