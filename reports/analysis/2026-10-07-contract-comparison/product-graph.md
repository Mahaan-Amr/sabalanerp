# مقایسه گراف محصول و محاسبات ایجاد قرارداد عادی و همکار

تاریخ: ۲۰۲۶-۱۰-۰۷. این گزارش خواندن پیاده‌سازی فعلی، اجرای آزمون‌های خالص و بازتولید تازه را ثبت می‌کند؛ کد محصول تغییر نکرده است. مسئول این بخش: product_graph. نتیجه اصلی: موتور هندسه و قیمت پایه مشترک است، اما مسیرهای نگارش state و مرز اعتبارسنجی یکسان نیستند. استفاده از اجزای مشترک UI اثبات برابری رفتار نیست.

## مبنا و محدوده

مبنای دامنه: `CONTEXT.md`؛ ADR-0012 (حکمی و برش)، ADR-0111-use-ordinary-sale-pricing-for-partner-product-entry و ADR-0116 (حکمی مستقل خرید). مهارت `.agents/skills/audit-contract-product-graph/SKILL.md` و ماتریس REFERENCE خوانده شد. قیمت تاریخی نباید از قاعده فعلی دوباره ساخته شود.

مسیر عادی: `CreateContractWizardClient.tsx` → `useContractProductCartController` / modal sections → canonical calculators → `canonicalProductSavePricing` → `wizardData.products` / `serviceRows` → submission / persisted graph. مسیر همکار: `PartnerCreationRuntime.tsx` → `PartnerTechnicalDraftEditor` → strict `PartnerTechnicalDraft` → `previewPartnerTechnicalDraft` → checkpoint recovery → `compilePartnerTechnicalGraph` → saved configuration refs → inquiry bindings / canonical retail quote → Case revision → internal/customer/fulfillment projections.

## ماتریس تطبیقی

| موضوع | عادی | همکار | نتیجه |
|---|---|---|---|
| خانواده‌های قابل انتخاب | طولی، پله، اسلب، کیوبیک/قطعات آماده | همین چهار خانواده در `partnerSelectableFamilies` | برابر برای ورود جدید؛ volumetric فقط سازگاری تاریخی در schema است و compiler ورود جدید آن را رد می‌کند |
| مرجع محصول | Product کامل همراه قیمت و تصاویر | snapshot فنی با id، نسخه، ابعاد، ویژگی و availability | تفاوت عمدی دسترسی؛ قیمت خصوصی خرید از safe catalog حذف است |
| هویت ردیف | `rowId` پایدار؛ index در برخی projectionهای قدیمی باقی است | `productRowId`، `sourceBatchId`، `allocationId`، operation ids و نسخه | معنای هویت مشترک، شکل نگهداری متفاوت |
| فیلدهای فنی | عددهای UI و `meta` / calculation snapshot | رشته decimal canonical، ابعاد متری؛ واحد نمایش جدا | adapters نقاط حساس تفاوت هستند |
| ابعاد طولی و بهینه‌سازی | canonical longitudinal policy و input آخرین تغییر | `calculateLongitudinalTechnical` با همان geometry engine | پایه فیزیکی مشترک؛ تعداد صفر/نبود تعداد می‌تواند total-linear-meters باشد |
| ضخامت/عرض مادر | Product و snapshot برای مصرف | catalog dimensions با نام واحد روشن | cm → m در compiler؛ متر طول مادر جدا |
| مساحت سفارش / مصرف | دو واقعیت مستقل در canonical output | همان جداسازی؛ cart مساحت سفارش را نمایش می‌دهد | برابر؛ مقدار قیمت ماده از مصرف، نه صرفاً مساحت تمام‌شده |
| اسلب | منبع‌های متعدد، بسته‌بندی، چهار سمت برش عمودی، نرخ lineBased/squareMeter | همان section و canonical slab calculator؛ sourceRows نسخه‌دار | برابر در مدل فعلی |
| پله | کف/پیشانی/پاگرد، mother length، count modes، layers | `StairPartSubsection` / quantity mode / layers مشترک؛ systems مستقل | پایه مشترک؛ quantityMode=system برای landing معتبر نیست، تعداد مستقل لازم است |
| قطعات آماده | cubic / readyPiece، count / ton / squareMeter | `PreparedProductSection` و inference نام مشترک | برابر؛ واحد انتخاب‌شده محفوظ می‌ماند؛ defaults count و 1 |
| نرخ ماده | ورودی فروشنده با پایه‌های canonical | نرخ مشتری مستقل از نرخ پیشنهاد سبلان؛ نرخ واردشده مثبت | تفاوت عمدی تجاری؛ قیمت کاتالوگ اجباری نیست |
| ابزار/پرداخت | group scope، edges، finishing collections و geometry quantities | همان `OperationCollectionsSection` و calculators؛ catalog فقط مشخصات فنی | نرخ خدمات ثابت معتبر از سرور می‌آید؛ selections و تعداد/لبه‌ها محلی‌اند |
| layer جدید | parent + layer geometry + source؛ paid remainder یا new material | همان canonical layer engine؛ new material می‌تواند stone دیگری باشد | قیمت مشتری سنگ جدید layer مستقل؛ استعلام جدا برای ماده دیگر |
| باقی‌مانده | source inventory و allocation replay در state writer | base inventory از محاسبه جاری، replay طبق creationOrder | اصل مشترک؛ تفاوت مرز commit در PG-01 |
| فرزند باقی‌مانده | material=0، ابزار/پرداخت متعلق به فرزند | `paid-source-zero`، mandatory=false، عملیات مستقل | برابر؛ خرید مجدد ماده ممنوع |
| تکثیر | شناسه تازه؛ منبع اصلی و children آن حفظ؛ layers همراه پله | remap شناسه‌ها، layer stocks، system و operations؛ children با source اصلی می‌مانند | برابر در موارد آزموده‌شده؛ partner duplication گراف نامعتبر را رد می‌کند |
| حذف منبع | باقی‌مانده‌های مستقل باید اول حذف شوند | حذف cascade همه descendants | شکاف رفتاری PG-02 |
| ویرایش منبع | replay پیش از commit؛ شکست، state قبلی را حفظ می‌کند | modal draft تا save؛ بررسی ردیف و global conflicts | شکاف PG-01: خطای dependent نادیده گرفته می‌شود |
| تصویر | Product/row/service images؛ upload و cart edit | در strict technical draft و dependent/service row ورودی تصویر وجود ندارد | شکاف قابلیت PG-03؛ الزام برابری دامنه‌ای تأیید نشده |
| عنوان/شرح | ردیف اصلی و فرزند قابل نگارش | عنوان/شرح ردیف اصلی دارد؛ remainder schema ندارد؛ UI remainder titleReadOnly و hideDescription | شکاف قابلیت PG-04 |
| تخفیف | tier مجاز از subtotal ماده؛ layers حذف؛ خدمات مستقل در پایه نیستند | تا 100٪ subtotal کامل retail شامل services/components؛ زیر خرید نیازمند تأیید زیان | تفاوت سیاست PG-05؛ احتمالاً مستقل تجاری ولی نیازمند تصمیم صریح |
| rounding | decimal witnesses سپس جمع و گرد کردن payable | decimal strings / exact quote totals سپس payable rounding | مشترک؛ effective rateهای blended جای lineTotal را نمی‌گیرند |
| تحویل | stone row و service row جدا؛ مقدار درخواست مستقل از مصرف | طولی متر، اسلب مترمربع، پله عدد، prepared واحد انتخابی؛ services جدا | قیمت‌گذاری مصرفی نباید واحد تحویل را عوض کند |
| ذخیره / downstream | Contract snapshot + graph + persisted item facts | frozen technical graph + refs/hash + retail/wholesale envelopes؛ fulfillment lineage | تفاوت عمدی دو توافق؛ shared graph truth باید محفوظ بماند |

## یافته‌های قابل اقدام

### PG-01 — ویرایش منبع در همکار می‌تواند فرزند نامعتبر را به draft متعهد کند (ریسک از دست رفتن تنظیم معتبر؛ اولویت بالا)

بازتولید تازه با توابع production: طولی مادر عرض 40cm، محصول 20cm × 1m تعداد 1 با retail rate=100؛ یک فرزند 10cm × 0.5m از remaining inventory ساخته شد. قبل از تغییر rootOk=true، childOk=true، conflicts=[]. تغییر عرض root به40cm: rootOk=true و conflicts=[]، اما child.calculation.ok=false با `selected-remainder-missing`.

مرز خطا دقیق است: `PartnerTechnicalDraftEditor.tsx:346` تا 353 فقط calculation ردیف باز، operations همان ردیف، retail rate، نرخ layer و `preview.value.conflicts` را می‌بیند؛ `onPrimary` در355–357 به همان شرط اتکا می‌کند. `technical-draft.ts:242` تا247 خطاهای identities/system/editing را در global conflicts می‌گذارد؛ `technical-dependents.ts:37` تا99 نتیجه شکست children/layers را داخل dependents[].calculation قرار می‌دهد، نه global conflicts. پس preview.ok و global conflicts=[] به معنای همه children معتبر نیست.

در عادی `CreateContractWizardClient.tsx:5632` تا5645 replay قبل از updateWizardData انجام می‌شود و failure مانع commit است. سرور همکار `technicalGraph.ts:75` تا79 تمام dependent calculations را چک و ذخیره نهایی را رد می‌کند؛ بنابراین فساد ذخیره‌شده سرور در این بازتولید اثبات نشده است، اما edit معتبر قبلی در recovery-owned draft جایگزین می‌شود و کاربر دیرتر در ادامه مسیر گیر می‌کند. همین نقص برای layer geometry failures و remainder service operation conflicts نیز از ساختار شرط محتمل است، اما آن دو سناریو جداگانه بازتولید نشدند.

مرز اصلاح پیشنهادی: یک validator مشترک صحت کل candidate preview برای root-edit و remainder-edit و duplication، با نمایش شناسه/عنوان همه children متعارض؛ published draft باید تا رفع تعارض قبلی بماند. صرف انتقال همه errors به global list بدون بررسی مالک خطا کافی نیست.

### PG-02 — حذف منبع در همکار همه فرزندان را بی‌اعلام دقیق حذف می‌کند (ریسک از دست رفتن کار کاربر؛ اولویت بالا)

در همان گراف، `removePartnerTechnicalProduct` قبل rows=1/dependents=1 و بعد rows=0/dependents=0 تولید کرد. `partnerTechnicalDraftAdapter.ts:182` تا205 recursively children، secondary-owner dependencies و layers را حذف می‌کند. UI `PartnerTechnicalDraftEditor.tsx:286` تا288 فقط «حذف این محصول؟» می‌گوید، بدون شمارش فرزندان یا ذکر حذف وابسته‌ها.

عادی `CreateContractWizardClient.tsx:4305` تا4314 وقتی independentChildren دارد حذف source را رد می‌کند و کاربر ابتدا allocations را حذف می‌کند؛ layers را بعد از هشدار مشخص cascade حذف می‌کند. این تفاوت در ADRهای خوانده‌شده قاعده تجاری مستقلی ندارد. اصلاح باید انتخاب محافظتی محصول را روشن کند: برابری با رفتار عادی یا cascade با هشدار دقیق و برگشت‌پذیری. حذف‌های UI feature-level باید حالت recovery / delivery را هم سازگار کنند؛ server را تغییر ندهید مگر rule پذیرفته شود.

### PG-03 — تصاویر ردیف/خدمت در همکار قابل افزودن نیست (شکاف قابلیت؛ اولویت متوسط)

عادی: `contract.types.ts:318` و459 فیلد images؛ writer `CreateContractWizardClient.tsx:4284` تا4299 تصویر را ذخیره و upload می‌کند، و save branches تصاویر را نگه می‌دارند (4869،5063،5470). همکار `technical-draft.ts:19` تا25 و58 تا89 strict schema فاقد images؛ dependent remainder schema `technical-dependents.ts:12` تا22 نیز فاقد آن است. fresh `PartnerTechnicalDraftSchema.safeParse` با images روی root=false شد. safe catalog هم عکس ندارد. این فقدان به‌خودی‌خود نقض دامنه اثبات‌شده نیست؛ ولی رابط، recovery، قرارداد/PDF و کارگاه همکار تصویر ردیف را نمی‌توانند همانند عادی دریافت کنند.

### PG-04 — عنوان/شرح قراردادی فرزند باقی‌مانده قابل سفارشی‌سازی نیست (شکاف قابلیت؛ اولویت متوسط)

عادی createRemainingStoneChildDraft در `productConfigurationController.ts:53` تا106 نام و شرح دارد و قابل نگهداری است. همکار remainder strict schema فقط geometry/ids/operations دارد؛ `PartnerRemainderConfigurationFlow.tsx:100` تا103 `productTitleReadOnly hideDescription` می‌دهد؛ compiler `technicalGraphRemainder.ts:25` تا27 title را فقط از نام کاتالوگ می‌گیرد. root عنوان/شرح همکار دارد (`partnerTechnicalDraftAdapter.ts:43` تا49)، پس شکاف اختصاصی child است. لازم است روشن شود نام اجرایی/شرح فرزند باید به مشتری/کارگاه انتقال یابد یا نام استاندارد عمدی است.

### PG-05 — پایه و سقف تخفیف همکار با عادی متفاوت است (تصمیم تجاری باز)

عادی `CreateContractWizardClient.tsx:514` تا522 subtotal original material است، layers حذف و services خارج است؛ 919 تا935 tier range و maxDiscountPercent را enforce می‌کند. همکار `partnerRetail.ts:137` تا169 effective full totals و services را در subtotal می‌گنجاند و فقط discountPercent<=100 را می‌سنجد. editor همکار `PartnerCreationRuntime.tsx:1553` تا1582 همین را اجرا می‌کند. retail discount به wholesale سرایت نمی‌کند و loss confirmation مستقل دارد.

مثال روشن برای تصمیم: ماده1,000 + برش/ابزار200 + خدمت مستقل300، تخفیف10٪ در عادی روی پایه1,000 برابر100 است؛ در همکار روی1,500 برابر150. این تفاوت را بدون تصمیم کسب‌وکار «باگ» نمی‌نامیم؛ چون مشتری و نرخ همکار مستقل‌اند. با این حال مطالبه «تمام منطق یکسان» شامل انتخاب صریح این سیاست است.

## pricing، ذخیره و خروجی: شواهد فنی

- `technicalGraph.ts:1` تا17 و101 تا202 canonical commands و calculators را مصرف می‌کند؛ `enteredRate` مستقل از owner rates با conversion IRR/10 وارد policy می‌شود. پس `buildPartnerProductionTechnicalDraft` تنها helper است و مسیر حقیقی editor را نباید با defaults ساده آن اشتباه گرفت.
- `technicalGraph.ts:225` به بعد `partnerPricingBasis='ordinary-sale-v1'` را روی snapshot تازه می‌گذارد؛ `canonicalWholesale.ts:29` تا62 تاریخی را با semantics قبلی نگه می‌دارد. ADR-0111 صریحاً ADR-0062 را برای ورود تازه supersede کرده است.
- `canonicalWholesale.ts:69` تا149 مواد را با approved rate و ancillary frozen snapshot محاسبه می‌کند؛ حکمی wholesale مستقل را جایگزین retail mandatory می‌کند، cross cut bill را صفر/بازسازی و physical cuts را حفظ می‌کند. `calculatePartnerCanonicalRetail` در152 تا166 بدون explicit wholesale policy اجرا می‌شود، پس حکمی خرید به فروش مشتری نفوذ نمی‌کند.
- `technicalGraphRemainder.ts:31` تا40 ماده پرداخت‌شده=0 و mandatory=false؛ child operations در49 به بعد مستقل از parent ساخته می‌شوند. همکار `partnerRetailIntentRows` parent binding را برای authorization ماده می‌یابد؛ این inheritance مجوز قیمت است، نه کپی ابزار/پرداخت.
- `canonicalProductSavePricing.ts:15` تا36 عادی exact witnesses را کنار عدد UI می‌گذارد؛ `contractProductPricing.ts:12` تا32 تطبیق witnesses با UI snapshot و components را کنترل می‌کند. legacy reconciliation `contractProductPricing.ts:92` به بعد canonical current save را مقدم می‌داند؛ وجود facts چندشکلی باید هنگام migration محفوظ و تدریجاً حذف شود.
- `technicalGraphMeasures.ts:11` تا42 واحد requested commercial delivery را project می‌کند؛ `partnerWizardEntry.ts:120` تا144 توزیع کامل product و service quantity را دقیق الزام می‌کند. مصرف مادر مبنای قیمت است و جای quantity تحویل نیست.
- `fulfillment/adapter.ts:23` تا46 graph row ids و hash و تحویل را validate می‌کند؛ lineage با sourceKind=PARTNER_CASE و productRowId نگهداری می‌شود. این ممیزی roundtrip زنده DB/PDF/loading انجام نداده و درباره نمایش واقعی تاریخی downstream ادعای موفقیت ندارد.

## آزمون و بازتولید

۱۹ آزمون frontend روی partnerTechnicalParity، partnerLayerOperations، partnerCanonicalRowAmounts، partnerPricingUnit، partnerServiceRetail و partnerRequoteIdentity: همگی پاس، بدون skip. ۳۵ آزمون backend روی partnerCanonicalWholesale، partnerCanonicalRowAmounts، partnerCustomerGraphTotal، partnerCaseDraftGraph و partnerTechnicalSavedGraph: همگی پاس، بدون skip. این آزمون‌ها unit/pure هستند و دیتابیس/Compose تازه‌ای ایجاد نشده است.

بازتولید مستقل تازه توسط temporary harness تولید شد و فایل آن بعد از ثبت نتیجه حذف شد. خروجی مشاهده‌شده PG-01/02/03 در بالا ثبت است. parent همچنین کاهش quantity=2→1 را با `selected-remainder-insufficient` و global conflicts=[] بازتولید کرده است؛ این corroboration از همین family defect است. Parent کل `test:contract-creation` را نیز با exit0 اجرا کرده است؛ بنابراین pass موجود coverage gap را نفی نمی‌کند.

ماتریس مهارت کامل فهرست شد اما اجرای پویا همه permutations آن تکمیل نشده: source width و quantity، duplication identities/child preservation، child deletion inventory، exact pricing و service-only در آزمون‌های انتخابی پوشش داده شد؛ source length/mandatory/cutting جداگانه، ترتیب‌های پیچیده conflict sibling، تعویض catalog add-on inactive، reload DB و تمام نسخه‌های چاپ/حسابداری/کارگاه/لجستیک هنوز نیازمند سناریوی زنده هدفمند هستند. محصول جدید یا اصلاح production انجام نشده است.

## ترتیب پیشنهادی ادامه

۱. PG-01 اعتبارسنجی و commit اتمیک کل candidate graph؛ بازتولید root width و quantity و layer/service conflicts قبل از هر تغییر.
۲. تصمیم حذف منبع و هشدار/undo PG-02؛ حفظ mapping تحویل بعد از حذف.
۳. تصمیم صریح برای تصاویر، عنوان/شرح فرزند و پایه/سقف تخفیف.
۴. اجرای سناریوهای باقی‌مانده با داده ایزوله در stack موجود `sabalanerp-local` و تطبیق persisted witnesses با customer/internal/workshop و fulfillment. تا آن مرحله ادعای parity کامل یا آمادگی release نکنید.
