from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Flowable,
    Frame,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
)


ROOT = Path(__file__).resolve().parents[3]
WORK = Path(__file__).resolve().parent
FONT_DIR = WORK / "font" / "fonts" / "ttf"
OUTPUT = ROOT / "output" / "pdf" / "گزارش-مدیریتی-هفت-روزه-SabalanERP.pdf"

PAGE_W, PAGE_H = A4
MARGIN_X = 18 * mm
TOP = 22 * mm
BOTTOM = 17 * mm
CONTENT_W = PAGE_W - 2 * MARGIN_X

NAVY = colors.HexColor("#17324D")
BLUE = colors.HexColor("#286C91")
TEAL = colors.HexColor("#2B8A84")
GOLD = colors.HexColor("#C58A2B")
INK = colors.HexColor("#1D2A36")
MUTED = colors.HexColor("#60717F")
PALE = colors.HexColor("#F3F7F8")
PALE_BLUE = colors.HexColor("#EAF3F7")
PALE_GOLD = colors.HexColor("#FBF4E8")
LINE = colors.HexColor("#D7E2E6")
WHITE = colors.white


def rtl(text: str) -> str:
    return get_display(arabic_reshaper.reshape(text))


pdfmetrics.registerFont(TTFont("Vazir", str(FONT_DIR / "Vazirmatn-Regular.ttf")))
pdfmetrics.registerFont(TTFont("VazirMedium", str(FONT_DIR / "Vazirmatn-Medium.ttf")))
pdfmetrics.registerFont(TTFont("VazirBold", str(FONT_DIR / "Vazirmatn-Bold.ttf")))


class RTLText(Flowable):
    def __init__(
        self,
        text,
        font="Vazir",
        size=10.2,
        leading=17,
        color=INK,
        align="right",
        space_after=4 * mm,
        indent=0,
        bullet=False,
    ):
        super().__init__()
        self.text = text
        self.font = font
        self.size = size
        self.leading = leading
        self.color = color
        self.align = align
        self.space_after = space_after
        self.indent = indent
        self.bullet = bullet
        self.lines = []

    def _measure(self, logical):
        return pdfmetrics.stringWidth(rtl(logical), self.font, self.size)

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        max_width = availWidth - self.indent
        words = self.text.replace("\n", " \n ").split()
        lines, current = [], []
        for word in words:
            if word == "\n":
                if current:
                    lines.append(" ".join(current))
                    current = []
                continue
            candidate = " ".join(current + [word])
            if current and self._measure(candidate) > max_width:
                lines.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            lines.append(" ".join(current))
        self.lines = lines or [""]
        self.height = len(self.lines) * self.leading + self.space_after
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.setFont(self.font, self.size)
        for i, logical in enumerate(self.lines):
            y = self.height - self.leading * (i + 0.78)
            visual = rtl(logical)
            if self.align == "center":
                c.drawCentredString(self.width / 2, y, visual)
            elif self.align == "left":
                c.drawString(0, y, visual)
            else:
                c.drawRightString(self.width - self.indent, y, visual)
            if self.bullet and i == 0:
                c.setFillColor(TEAL)
                c.circle(self.width - 1.6 * mm, y + 1.2 * mm, 1.05 * mm, fill=1, stroke=0)
                c.setFillColor(self.color)


class Rule(Flowable):
    def __init__(self, color=LINE, space=3 * mm):
        super().__init__()
        self.color = color
        self.space = space

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self.height = self.space * 2
        return self.width, self.height

    def draw(self):
        self.canv.setStrokeColor(self.color)
        self.canv.setLineWidth(0.7)
        self.canv.line(0, self.space, self.width, self.space)


class AccentBar(Flowable):
    def __init__(self, label, color=TEAL):
        super().__init__()
        self.label = label
        self.color = color

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self.height = 13 * mm
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(self.color)
        c.roundRect(0, 2 * mm, self.width, 9.5 * mm, 3 * mm, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont("VazirBold", 12.5)
        c.drawRightString(self.width - 5 * mm, 5.2 * mm, rtl(self.label))


class InfoBox(Flowable):
    def __init__(self, title, body, tone="blue"):
        super().__init__()
        self.title = title
        self.body = body
        self.tone = tone
        self.body_lines = []

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        size = 9.4
        max_w = availWidth - 12 * mm
        words = self.body.split()
        lines, current = [], []
        for word in words:
            candidate = " ".join(current + [word])
            if current and pdfmetrics.stringWidth(rtl(candidate), "Vazir", size) > max_w:
                lines.append(" ".join(current))
                current = [word]
            else:
                current.append(word)
        if current:
            lines.append(" ".join(current))
        self.body_lines = lines
        self.height = 16 * mm + len(lines) * 5.8 * mm
        return availWidth, self.height + 3 * mm

    def draw(self):
        c = self.canv
        bg, accent = (PALE_GOLD, GOLD) if self.tone == "gold" else (PALE_BLUE, BLUE)
        c.setFillColor(bg)
        c.setStrokeColor(LINE)
        c.roundRect(0, 3 * mm, self.width, self.height - 3 * mm, 3.5 * mm, fill=1, stroke=1)
        c.setFillColor(accent)
        c.roundRect(self.width - 3.3 * mm, 3 * mm, 3.3 * mm, self.height - 3 * mm, 1.5 * mm, fill=1, stroke=0)
        c.setFillColor(accent)
        c.setFont("VazirBold", 10.5)
        c.drawRightString(self.width - 7 * mm, self.height - 8.5 * mm, rtl(self.title))
        c.setFillColor(INK)
        c.setFont("Vazir", 9.4)
        y = self.height - 15 * mm
        for line in self.body_lines:
            c.drawRightString(self.width - 7 * mm, y, rtl(line))
            y -= 5.8 * mm


class KpiRow(Flowable):
    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self.height = 31 * mm
        return self.width, self.height

    def draw(self):
        c = self.canv
        gap = 4 * mm
        box_w = (self.width - 2 * gap) / 3
        cards = [
            ("۲۶", "تغییر اصلی", TEAL),
            ("۲", "Pull Request ادغام‌شده", BLUE),
            ("۵", "حوزه کسب‌وکار", GOLD),
        ]
        for i, (number, label, accent) in enumerate(cards):
            x = i * (box_w + gap)
            c.setFillColor(WHITE)
            c.setStrokeColor(LINE)
            c.roundRect(x, 2 * mm, box_w, 26 * mm, 4 * mm, fill=1, stroke=1)
            c.setFillColor(accent)
            c.setFont("VazirBold", 18)
            c.drawCentredString(x + box_w / 2, 16 * mm, rtl(number))
            c.setFillColor(MUTED)
            c.setFont("VazirMedium", 8.3)
            c.drawCentredString(x + box_w / 2, 8 * mm, rtl(label))


class SourceItem(Flowable):
    def __init__(self, label, url):
        super().__init__()
        self.label = label
        self.url = url

    def wrap(self, availWidth, availHeight):
        self.width = availWidth
        self.height = 13 * mm
        return self.width, self.height

    def draw(self):
        c = self.canv
        c.setFillColor(INK)
        c.setFont("VazirMedium", 9.2)
        c.drawRightString(self.width, 8.2 * mm, rtl(self.label))
        c.setFillColor(BLUE)
        c.setFont("Helvetica", 6.8)
        c.drawRightString(self.width, 3 * mm, self.url)
        c.linkURL(self.url, (0, 0, self.width, 11 * mm), relative=1)


def bullet(text):
    return RTLText(text, size=9.8, leading=16.5, space_after=1.6 * mm, indent=5 * mm, bullet=True)


def heading(text, size=17, color=NAVY, after=4 * mm):
    return RTLText(text, font="VazirBold", size=size, leading=size * 1.7, color=color, space_after=after)


def paragraph(text, after=4 * mm, size=10.2):
    return RTLText(text, size=size, leading=size * 1.72, color=INK, space_after=after)


def header_footer(canvas, doc):
    page = canvas.getPageNumber()
    canvas.saveState()
    if page > 1:
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(MARGIN_X, PAGE_H - 13 * mm, PAGE_W - MARGIN_X, PAGE_H - 13 * mm)
        canvas.setFont("VazirMedium", 8)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 9.5 * mm, rtl("گزارش مدیریتی هفت‌روزه SabalanERP"))
        canvas.drawString(MARGIN_X, PAGE_H - 9.5 * mm, "29 JUL - 05 AUG 2026")
    canvas.setStrokeColor(LINE)
    canvas.line(MARGIN_X, 11.5 * mm, PAGE_W - MARGIN_X, 11.5 * mm)
    canvas.setFillColor(MUTED)
    canvas.setFont("Vazir", 7.7)
    canvas.drawRightString(PAGE_W - MARGIN_X, 7.2 * mm, rtl("محرمانه داخلی - تهیه‌شده از فعالیت شاخه اصلی GitHub"))
    canvas.drawString(MARGIN_X, 7.2 * mm, f"{page:02d}")
    canvas.restoreState()


def build_story():
    s = []

    # Cover
    s += [Spacer(1, 19 * mm)]
    s.append(RTLText("گزارش مدیریتی هفت‌روزه", font="VazirBold", size=25, leading=38, color=NAVY, align="center", space_after=1 * mm))
    s.append(RTLText("پروژه SabalanERP", font="VazirBold", size=20, leading=32, color=TEAL, align="center", space_after=4 * mm))
    s.append(RTLText("مرور قابلیت‌ها و فرایندهای افزوده‌شده", font="VazirMedium", size=11.5, leading=20, color=MUTED, align="center", space_after=10 * mm))
    s.append(Rule(color=TEAL, space=2 * mm))
    s.append(RTLText("بازه گزارش: ۲۹ ژوئیه تا ۵ اوت ۲۰۲۶", font="VazirMedium", size=10.5, leading=18, color=INK, align="center", space_after=10 * mm))
    s.append(KpiRow())
    s.append(Spacer(1, 5 * mm))
    s.append(InfoBox("جمع‌بندی یک‌خطی", "این هفته دید مدیریتی، پاسخ‌گویی سازمانی و پایداری فرایندهای عملیاتی به‌طور محسوسی بهتر شد؛ اما مدیریت انتشار و وضعیت تیکت‌ها باید با سرعت توسعه هماهنگ شود.", "blue"))
    s.append(Spacer(1, 6 * mm))
    s.append(heading("خلاصه مدیریتی", 16))
    s.append(paragraph("این هفته، پروژه از مرحله نوسازی ظاهری عبور کرده و به سمت فرایندهای عملیاتی کنترل‌شده، مسئولیت‌پذیری فردی و تصمیم‌گیری مبتنی بر شواهد حرکت کرده است. مهم‌ترین خروجی‌ها شامل بازسازی هوش تجاری، راه‌اندازی پشتیبانی و اعلان یکپارچه، مدیریت وظایف منابع انسانی، بهبود فرایند قرارداد و نوسازی فضای گارد هستند."))
    s.append(InfoBox("تعریف تحویل", "در این گزارش، تحویل‌شده یعنی تغییر وارد شاخه اصلی GitHub شده است. این وضعیت به‌تنهایی تأیید نمی‌کند که همان نسخه در محیط عملیاتی مستقر شده باشد.", "gold"))

    # BI
    s.append(PageBreak())
    s.append(AccentBar("۱. هوش تجاری و تصمیم‌گیری مدیریتی", TEAL))
    s.append(heading("BI از گزارش‌گیری به مرکز تصمیم تبدیل شد"))
    s.append(paragraph("فضای قبلی هوش تجاری به یک مرکز تصمیم‌گیری مبتنی بر شواهد تبدیل شده است. مدیر به‌جای مشاهده تعداد زیادی عدد هم‌سطح، ابتدا موارد نیازمند توجه را می‌بیند و سپس می‌تواند شواهد هر سیگنال را در مسیر تخصصی آن بررسی کند."))
    for x in [
        "نمای اولویت‌بندی‌شده نیازمند توجه برای ریسک‌ها و تعهدات مهم",
        "شاخص‌های فروش قطعی، پایپ‌لاین فعال، مطالبات و ریسک تحویل",
        "پیشنهادهای مدیریتی زنده براساس شرایط واقعی و قابل توضیح",
        "تطبیق اطلاعات میان فروش، CRM، حسابداری، لجستیک و گارد",
        "تحلیل اختصاصی فروش، پایپ‌لاین، وصول، تحویل، فروشندگان و ترکیب تجاری",
        "خروجی فارسی PDF و Excel با همان دامنه مجاز اطلاعات",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(InfoBox("اصل اعتمادپذیری", "داده ناموجود دیگر صفر نمایش داده نمی‌شود. سامانه میان مقدار واقعی، پوشش ناقص، منبع خارج از دسترس و نداشتن مجوز تفاوت می‌گذارد.", "blue"))
    s.append(heading("اثر مدیریتی", 13.5, TEAL, 2 * mm))
    s.append(paragraph("BI یک سیستم وظیفه موازی ایجاد نمی‌کند. پیشنهادها فقط سیگنال‌های خواندنی هستند، به منبع اصلی ارجاع می‌دهند و پس از رفع وضعیت مبنا حذف می‌شوند. این موضوع از ایجاد دو حقیقت متفاوت درباره وضعیت کار جلوگیری می‌کند."))
    s.append(InfoBox("کنترل دسترسی", "مدیر دارای دسترسی مدیریتی BI می‌تواند دامنه شرکتی را ببیند؛ دسترسی مشاهده عادی در محدوده واحد باقی می‌ماند. تمام مسیرهای تحلیل، خروجی‌ها و پیوندهای شواهد دوباره همان مجوز را اعمال می‌کنند.", "gold"))

    # Support
    s.append(PageBreak())
    s.append(AccentBar("۲. پشتیبانی و مرکز اعلان یکپارچه", BLUE))
    s.append(heading("پشتیبانی به یک فرایند سازمانی تبدیل شد"))
    s.append(paragraph("سامانه جدید تیکت، مسیر گزارش مشکل یا پیشنهاد را از همان محل وقوع تا پاسخ، حل و پیگیری فراهم می‌کند. سوابق تیکت ماندگار و کنترل‌شده هستند و اطلاعات حساس فقط در محدوده مجاز دیده می‌شوند."))
    for x in [
        "ثبت مشکل یا پیشنهاد از داخل ERP همراه با اطلاعات تشخیصی کنترل‌شده",
        "پیگیری درخواست توسط گزارش‌دهنده و دریافت پاسخ و تغییر وضعیت",
        "صف کاری متناسب با نقش برای کارشناسان، مدیران و همکاران مجاز",
        "تخصیص، همکاری، حل، بستن، بازگشایی و مدیریت موارد تکراری",
        "اهداف پاسخ‌گویی و حل براساس تقویم کاری تهران",
        "مسیر محدود برای رخدادهای امنیتی یا نقض حریم خصوصی",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(heading("مرکز اعلان", 13.5, BLUE, 2 * mm))
    s.append(paragraph("اعلان‌ها اکنون یک صندوق ورودی پایدار برای تخصیص‌ها، اشاره‌ها، تأییدها، رخدادهای امنیتی، پاسخ‌های پشتیبانی و رویدادهای کسب‌وکار هستند. تحویل لحظه‌ای و اعلان مرورگر فقط کانال‌های اطلاع‌رسانی‌اند و جای سابقه ماندگار را نمی‌گیرند."))
    s.append(InfoBox("تفکیک تجربه کاربر", "زنگ اعلان فقط خلاصه موارد جدید را نشان می‌دهد. تاریخچه کامل، درخواست‌های شخصی، صف کارشناسان و تنظیمات اعلان هرکدام مسیر متمرکز خود را دارند.", "blue"))
    s.append(InfoBox("تصمیم امنیتی صریح", "بازکردن هشدار امنیتی دیگر به معنای حل آن نیست. کاربر باید فعالیت را تأیید کند یا آن را مشکوک اعلام کند؛ در حالت مشکوک، نشست مربوطه لغو و تغییر رمز پیشنهاد می‌شود.", "gold"))

    # HR
    s.append(PageBreak())
    s.append(AccentBar("۳. منابع انسانی و مسئولیت‌پذیری فردی", GOLD))
    s.append(heading("HR صاحب سیستم مدیریت وظایف شخصی شد"))
    s.append(paragraph("وظایف منابع انسانی اکنون مسئول مشخص، موعد، وضعیت، مقصد و سابقه تکمیل دارند. این وظایف می‌توانند دستی ایجاد شوند یا از شرایط قابل اقدام پرونده استخدامی به‌صورت خودکار شکل بگیرند."))
    for x in [
        "تخصیص دستی وظایف منابع انسانی به یک مسئول مشخص",
        "ایجاد خودکار وظیفه از پرونده‌های استخدامی قابل اقدام",
        "تعیین مسئول پیش‌فرض برای هر مرجع استخدامی",
        "صف بدون مسئول برای مواردی که مالک واجد شرایط ندارند",
        "پیشرفت ماهانه شخصی همراه با وظایف معوق حل‌نشده",
        "صفحه اختصاصی وظایف و صفحه متمرکز ظرفیت جایگاه‌ها",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(heading("بهبودهای عملیاتی HR", 13.5, GOLD, 2 * mm))
    for x in [
        "افراد بایگانی‌شده از تاریخ مؤثر از فهرست حضور گارد خارج می‌شوند، بدون حذف سابقه قبلی",
        "جست‌وجوی نام فارسی سریع‌تر، چندبخشی و مقاوم‌تر شده است",
        "شاخص‌های مهاجرت به صفحات مستقل نتایج دقیق متصل شده‌اند",
        "پنجره‌های مهاجرت و تخصیص مسئول، هنگام اجرای عملیات از بسته‌شدن ناخواسته محافظت می‌شوند",
        "ناوبری HR در دسکتاپ و موبایل یکپارچه‌تر و ماندگارتر شده است",
    ]:
        s.append(bullet(x))
    s.append(InfoBox("اثر مدیریتی", "کار سازمانی دیگر صرفاً یک فرصت عمومی برای اقدام نیست؛ مسئولیت فردی قابل پیگیری است و وظیفه‌ای که مالک معتبر ندارد، به‌جای گم‌شدن در صف بدون مسئول دیده می‌شود.", "gold"))

    # Sales page 1
    s.append(PageBreak())
    s.append(AccentBar("۴. فروش و ایجاد قرارداد", TEAL))
    s.append(heading("سفر ایجاد قرارداد ساده‌تر و مطمئن‌تر شد"))
    s.append(paragraph("صفحه فروش و مراحل قرارداد در انتخاب مشتری، پروژه، محصول، تحویل، پرداخت، امضا، بازیابی و تکمیل بازطراحی شده‌اند. هدف اصلی، کاهش ابهام و حفظ اطلاعات کاربر در شرایط خطا یا جابه‌جایی میان مراحل بوده است."))
    for x in [
        "خلاصه عملیاتی روشن‌تر در صفحه فروش و داشبورد اصلی",
        "ساختار منظم‌تر مراحل قرارداد و برجسته‌شدن اقدام اصلی",
        "بهبود تجربه موبایل، حالت تاریک و کنترل‌های پیمایش",
        "حفظ آخرین محاسبه معتبر محصول هنگام محاسبه مجدد",
        "جابه‌جایی مستقیم میان مراحل ویرایش قرارداد در موبایل",
        "خروج صحیح پس از ثبت موفق، بدون خطر ارسال دوباره قرارداد",
        "ایجاد پیش‌نویس کاملاً خالی با انتخاب قرارداد جدید",
        "دسترسی مهمان به درخواست همکاری و تأیید مشتری با OTP اختصاصی",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(InfoBox("رفع مانع موبایل", "پنجره تنظیم محصول پله بالاتر از ناوبری موبایل قرار می‌گیرد؛ بدنه قابل پیمایش است و اقدامات پایین پنجره دیگر توسط منوی موبایل پوشانده نمی‌شوند.", "blue"))
    s.append(heading("ویرایش ایمن میان تب‌ها و دستگاه‌ها", 13.5, TEAL, 2 * mm))
    s.append(paragraph("هر قرارداد فقط یک نشست فعال با اختیار ذخیره دارد. نشست دیگر می‌تواند اختیار را صریحاً منتقل کند؛ نشست قبلی در اقدام بعدی مطلع می‌شود و نسخه قدیمی نمی‌تواند بدون کنترل روی نسخه جدید نوشته شود."))
    s.append(InfoBox("بازیابی قابل اتکا", "مرحله فعلی، موقعیت صفحه و پیش‌نویس حفظ می‌شوند. نسخه منقضی نیازمند بارگذاری آگاهانه آخرین اطلاعات است و خطای پاک‌سازی نشست، ثبت موفق قرارداد را ناموفق نشان نمی‌دهد.", "gold"))

    # Sales page 2
    s.append(PageBreak())
    s.append(AccentBar("۴. فروش - سلامت محصول و قیمت‌گذاری", TEAL))
    s.append(heading("اختلال‌های پیچیده محصول به خطای قابل مدیریت تبدیل شدند"))
    s.append(paragraph("چند اصلاح مهم روی تکثیر محصول، ابزار و پرداخت، برش، سنگ باقی‌مانده و برنامه تحویل انجام شد. این حوزه مستقیماً بر قیمت، موجودی، خروجی کارگاه و قابلیت ثبت قرارداد اثر دارد."))
    for x in [
        "محصول تکثیرشده برنامه تحویل محصول اصلی را به‌اشتباه به ارث نمی‌برد",
        "هویت داخلی ابزارها، پرداخت‌ها و عملیات میان محصولات مستقل باقی می‌ماند",
        "ناسازگاری مطمئن و بدون اثر مالی به‌صورت خودکار اصلاح می‌شود",
        "مورد مبهم فقط همان ردیف محصول را متوقف می‌کند، نه کل پیش‌نویس را",
        "کاربر به همان محصول و فیلد نیازمند بازبینی هدایت می‌شود",
        "قیمت، مقدار، عملیات و برنامه تحویل معتبر هنگام اصلاح تغییر نمی‌کنند",
        "قرارداد نهایی بدون ویرایش و ذخیره صریح بازنویسی نمی‌شود",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(InfoBox("نتیجه کسب‌وکاری", "احتمال قیمت اشتباه، عملیات تکراری، تخصیص نادرست تحویل یا خطای عمومی هنگام ثبت قرارداد کاهش یافته است. خطاهای مبهم اکنون تا حد امکان خودکار ترمیم می‌شوند و موارد واقعاً مبهم پیام قابل اقدام دارند.", "blue"))
    s.append(heading("حفظ تاریخچه تجاری", 13.5, TEAL, 2 * mm))
    s.append(paragraph("اطلاعات قراردادهای قدیمی هنگام مشاهده یا بازکردن، به‌صورت پنهانی بازنویسی نمی‌شوند. تبدیل دائمی فقط در ویرایش و ذخیره مجاز همان قرارداد انجام می‌شود و هر اختلاف مالی توضیح‌ناپذیر، عملیات را متوقف می‌کند."))
    s.append(InfoBox("کنترل مهم", "اصلاح خودکار فقط زمانی انجام می‌شود که رابطه مالکیت، مقدار، نرخ و اثر مالی بدون ابهام باشند. سامانه در موارد نامطمئن حدس نمی‌زند.", "gold"))

    # Guard
    s.append(PageBreak())
    s.append(AccentBar("۵. گارد و گزارش شیفت", BLUE))
    s.append(heading("فضای کاری گارد نوسازی شد"))
    s.append(paragraph("بخش‌های شیفت، حضور و غیاب، استثناها، پرسنل، خودروها، گزارش‌های سرپرستی، فهرست حضور و تنظیمات گزارش به زبان بصری و تعامل یکپارچه‌تری منتقل شده‌اند."))
    for x in [
        "خلاصه روشن حضور، غیبت، تأخیر، مأموریت، مرخصی و استثناها",
        "نمای متمرکزتر برای شیفت‌های فعال و تکمیل‌شده",
        "دسترسی منظم‌تر به گزارش‌های پرسنلی و سرپرستی",
        "هماهنگی بهتر صفحات گارد در موبایل و حالت‌های روشن و تاریک",
        "حفظ سوابق حضور افراد بایگانی‌شده در دوره‌های تاریخی",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 2 * mm))
    s.append(heading("گزارش رسمی شیفت‌های تکمیل‌شده", 13.5, BLUE, 2 * mm))
    s.append(paragraph("خروجی PDF شیفت‌ها برای استفاده مدیریتی بازسازی شده است. هر شیفت از صفحه جدید آغاز می‌شود، مستندات تصویری بدون برش نمایش داده می‌شوند و نام فایل و شماره ردیف زمانی برای ردیابی شواهد حفظ می‌شود."))
    s.append(InfoBox("اثر مدیریتی", "گزارش شیفت از یک خروجی نمایشی به سندی خوانا و قابل استناد برای مرور عملیات و مستندات تبدیل شده است.", "blue"))
    s.append(heading("داشبورد و ناوبری مشترک", 13.5, NAVY, 2 * mm))
    s.append(paragraph("داشبورد اصلی از یک منوی تخت به نمای عملیاتی متناسب با نقش تبدیل شده است. وضعیت فعلی، موارد نیازمند توجه و اقدام بعدی اولویت دارند؛ در عین حال مسیرهای واحدها و مدیریت با تأکید ثانویه در دسترس باقی می‌مانند."))

    # Assessment
    s.append(PageBreak())
    s.append(AccentBar("ارزیابی و توصیه مدیریتی", NAVY))
    s.append(heading("برداشت کلی", 17, NAVY))
    s.append(InfoBox("جهت پروژه", "مسیر کلی بسیار مثبت است. پروژه از صفحات پراکنده به سمت فرایندهای کنترل‌شده، مسئولیت‌پذیری فردی، مدیریت استثنا و تصمیم‌گیری مبتنی بر شواهد حرکت می‌کند.", "blue"))
    s.append(InfoBox("بالاترین ارزش هفته", "بازسازی BI و راه‌اندازی پشتیبانی و اعلان یکپارچه بیشترین اثر میان‌واحدی را دارند و مستقیماً کیفیت نظارت و پاسخ‌گویی سازمانی را افزایش می‌دهند.", "blue"))
    s.append(InfoBox("ریسک عملیاتی", "حجم تغییرات بالا بوده و فروش، HR، پشتیبانی، BI، گارد و ناوبری مشترک تقریباً هم‌زمان تغییر کرده‌اند. تست یکپارچه و انتشار مرحله‌ای اهمیت زیادی دارد.", "gold"))
    s.append(InfoBox("نگرانی حاکمیتی", "تنها دو Pull Request ادغام‌شده در برابر ۲۶ تغییر اصلی ثبت شده‌اند. چند تیکت HR و فروش نیز با وجود مشاهده تغییر متناظر در شاخه اصلی هنوز باز هستند؛ بنابراین نمای تیکت‌ها تصویر کاملاً دقیقی از پیشرفت ارائه نمی‌کند.", "gold"))
    s.append(heading("اقدامات پیشنهادی برای هفته بعد", 14, NAVY, 2 * mm))
    for x in [
        "تأیید دقیق نسخه مستقرشده در محیط عملیاتی و تطبیق آن با شاخه اصلی",
        "اجرای سناریوهای یکپارچه میان فروش، حسابداری، لجستیک، گارد و اعلان‌ها",
        "بستن یا به‌روزرسانی تیکت‌هایی که کار متناظر آن‌ها تحویل شده است",
        "تعریف یک خلاصه انتشار مدیریتی برای هر بسته تغییر بزرگ",
        "ادامه طراحی داشبورد حسابداری پس از قطعی‌شدن منطق شاخص‌ها و دسترسی‌ها",
    ]:
        s.append(bullet(x))
    s.append(Spacer(1, 3 * mm))
    s.append(InfoBox("تحویل‌نشده در این بازه", "بازطراحی داشبورد اصلی حسابداری در مرحله برنامه‌ریزی و نمونه‌سازی است و تغییر تحویل‌شده مشخصی برای آن در شاخه اصلی این هفته مشاهده نشد.", "blue"))

    # Sources
    s.append(PageBreak())
    s.append(AccentBar("منابع اصلی گزارش", TEAL))
    s.append(paragraph("این گزارش از فعالیت شاخه اصلی، Pull Requestهای ادغام‌شده و تیکت‌های محصول در GitHub تهیه شده است. پیوندهای زیر قابل کلیک هستند."))
    sources = [
        ("پیاده‌سازی فضای هوش تجاری", "https://github.com/Mahaan-Amr/sabalanerp/commit/56133fd58f8a7f134b68173116d5a5b5526168f4"),
        ("مشخصات محصول هوش تجاری", "https://github.com/Mahaan-Amr/sabalanerp/issues/187"),
        ("Pull Request بازسازی BI", "https://github.com/Mahaan-Amr/sabalanerp/pull/195"),
        ("زیرساخت تیکت و اعلان یکپارچه", "https://github.com/Mahaan-Amr/sabalanerp/commit/a6910bc49381253b07f1c127a029acb76b43f6a6"),
        ("بازطراحی اعلان‌ها و فضای شخصی", "https://github.com/Mahaan-Amr/sabalanerp/commit/8d832e638b6f1ff7f6c0c42d5e0292543536e051"),
        ("وظایف شخصی منابع انسانی", "https://github.com/Mahaan-Amr/sabalanerp/commit/78655b25f688cb41684e2aedae12db9d04a06d26"),
        ("بهبود گردش کار منابع انسانی", "https://github.com/Mahaan-Amr/sabalanerp/commit/b08a68ec0cb793d5abacf8250da8a3541cbc576f"),
        ("بازطراحی فروش و قرارداد", "https://github.com/Mahaan-Amr/sabalanerp/commit/f95f614e549178c163a8706b8ffef9b01f78b2ab"),
        ("اصلاح دسترسی عمومی و تجربه موبایل", "https://github.com/Mahaan-Amr/sabalanerp/pull/194"),
        ("نوسازی فضای گارد و گزارش PDF", "https://github.com/Mahaan-Amr/sabalanerp/commit/a68086dd9821f8c51dd80f310675e8ad120a9f61"),
        ("برنامه بازطراحی داشبورد حسابداری", "https://github.com/Mahaan-Amr/sabalanerp/issues/182"),
    ]
    for label, url in sources:
        s.append(SourceItem(label, url))
        s.append(Rule(space=1.3 * mm))
    s.append(Spacer(1, 4 * mm))
    s.append(InfoBox("یادداشت روش‌شناسی", "مبنای گزارش، تغییرات قابل مشاهده در GitHub است. ارزیابی استقرار، پذیرش کاربران یا عملکرد واقعی محیط تولید نیازمند بررسی جداگانه است.", "gold"))

    return s


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=TOP,
        bottomMargin=BOTTOM,
        title="گزارش مدیریتی هفت‌روزه SabalanERP",
        author="OpenAI Codex",
        subject="مرور مدیریتی قابلیت‌ها و فرایندهای افزوده‌شده",
    )
    frame = Frame(MARGIN_X, BOTTOM, CONTENT_W, PAGE_H - TOP - BOTTOM, id="main", showBoundary=0)
    doc.addPageTemplates([PageTemplate(id="report", frames=[frame], onPage=header_footer)])
    doc.build(build_story())
    print("PDF generated successfully")


if __name__ == "__main__":
    main()
