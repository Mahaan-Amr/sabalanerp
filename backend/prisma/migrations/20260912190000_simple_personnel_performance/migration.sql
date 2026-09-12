CREATE TABLE "simple_performance_profiles" (
  "id" TEXT NOT NULL,
  "stableKey" TEXT NOT NULL,
  "nameFa" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simple_performance_profiles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simple_performance_indicators" (
  "id" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "categoryFa" TEXT,
  "titleFa" TEXT NOT NULL,
  "unitFa" TEXT NOT NULL,
  "target" DECIMAL(18,4) NOT NULL,
  "direction" TEXT NOT NULL,
  "weightPercent" DECIMAL(7,4) NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "simple_performance_indicators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simple_performance_profile_assignments" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "assignedByUserId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simple_performance_profile_assignments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simple_performance_evaluations" (
  "id" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  "profileId" TEXT NOT NULL,
  "evaluationDate" DATE NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "evaluatorUserId" TEXT NOT NULL,
  "evaluatorAuthority" TEXT NOT NULL,
  "score" DECIMAL(7,2),
  "levelCode" TEXT,
  "finalizedAt" TIMESTAMP(3),
  "correctionOfId" TEXT,
  "correctionReason" TEXT,
  "supersededAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "simple_performance_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simple_performance_values" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT NOT NULL,
  "indicatorId" TEXT NOT NULL,
  "actual" DECIMAL(18,4) NOT NULL,
  "score" DECIMAL(7,2),
  CONSTRAINT "simple_performance_values_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "simple_performance_audits" (
  "id" TEXT NOT NULL,
  "evaluationId" TEXT,
  "personnelId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "authoritySource" TEXT,
  "eventType" TEXT NOT NULL,
  "reason" TEXT,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "simple_performance_audits_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "simple_performance_profiles_stableKey_version_key" ON "simple_performance_profiles"("stableKey", "version");
CREATE INDEX "simple_performance_profiles_isActive_nameFa_idx" ON "simple_performance_profiles"("isActive", "nameFa");
CREATE UNIQUE INDEX "simple_performance_indicators_profileId_code_key" ON "simple_performance_indicators"("profileId", "code");
CREATE INDEX "simple_performance_indicators_profileId_sortOrder_idx" ON "simple_performance_indicators"("profileId", "sortOrder");
CREATE UNIQUE INDEX "simple_performance_profile_assignments_personnelId_key" ON "simple_performance_profile_assignments"("personnelId");
CREATE INDEX "simple_performance_profile_assignments_profileId_idx" ON "simple_performance_profile_assignments"("profileId");
CREATE INDEX "simple_performance_evaluations_personnelId_status_finalizedAt_idx" ON "simple_performance_evaluations"("personnelId", "status", "finalizedAt");
CREATE INDEX "simple_performance_evaluations_correctionOfId_idx" ON "simple_performance_evaluations"("correctionOfId");
CREATE UNIQUE INDEX "simple_performance_values_evaluationId_indicatorId_key" ON "simple_performance_values"("evaluationId", "indicatorId");
CREATE INDEX "simple_performance_values_indicatorId_idx" ON "simple_performance_values"("indicatorId");
CREATE INDEX "simple_performance_audits_evaluationId_createdAt_idx" ON "simple_performance_audits"("evaluationId", "createdAt");
CREATE INDEX "simple_performance_audits_personnelId_createdAt_idx" ON "simple_performance_audits"("personnelId", "createdAt");

ALTER TABLE "simple_performance_indicators" ADD CONSTRAINT "simple_performance_indicators_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "simple_performance_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_profile_assignments" ADD CONSTRAINT "simple_performance_profile_assignments_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "simple_performance_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_profile_assignments" ADD CONSTRAINT "simple_performance_profile_assignments_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_evaluations" ADD CONSTRAINT "simple_performance_evaluations_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "simple_performance_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_evaluations" ADD CONSTRAINT "simple_performance_evaluations_personnelId_fkey" FOREIGN KEY ("personnelId") REFERENCES "personnel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_evaluations" ADD CONSTRAINT "simple_performance_evaluations_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "simple_performance_evaluations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "simple_performance_values" ADD CONSTRAINT "simple_performance_values_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "simple_performance_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "simple_performance_values" ADD CONSTRAINT "simple_performance_values_indicatorId_fkey" FOREIGN KEY ("indicatorId") REFERENCES "simple_performance_indicators"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "simple_performance_profiles" ("id", "stableKey", "nameFa", "version", "createdByUserId") VALUES
('simple-profile-sales-v1', 'sales', 'فروش', 1, 'system-workbook-import'),
('simple-profile-marketing-v1', 'marketing-sales', 'بازاریابی و فروش', 1, 'system-workbook-import'),
('simple-profile-sales-accounting-v1', 'sales-accounting', 'حسابداری فروش', 1, 'system-workbook-import'),
('simple-profile-finance-v1', 'finance-management', 'مدیریت مالی', 1, 'system-workbook-import'),
('simple-profile-hr-v1', 'hr-branding', 'اچ‌آر و برندینگ', 1, 'system-workbook-import'),
('simple-profile-procurement-v1', 'stone-procurement', 'خرید و تأمین سنگ', 1, 'system-workbook-import'),
('simple-profile-buyer-v1', 'buyer', 'کارپرداز', 1, 'system-workbook-import'),
('simple-profile-logistics-v1', 'logistics-supervisor', 'سرپرست لجستیک', 1, 'system-workbook-import'),
('simple-profile-workshop-v1', 'workshop-warehouse', 'سرپرست کارگاه سنگ و انبار', 1, 'system-workbook-import'),
('simple-profile-security-v1', 'security', 'انتظامات', 1, 'system-workbook-import'),
('simple-profile-services-v1', 'services', 'خدمات و تشریفات', 1, 'system-workbook-import'),
('simple-profile-it-v1', 'it', 'برنامه‌نویس و ای‌تی', 1, 'system-workbook-import');

INSERT INTO "simple_performance_indicators" ("id", "profileId", "code", "categoryFa", "titleFa", "unitFa", "target", "direction", "weightPercent", "sortOrder") VALUES
('spi-s01-v1','simple-profile-sales-v1','S01','فروش','مبلغ فروش ماهانه','میلیارد ریال',15,'HIGHER_IS_BETTER',50,1),
('spi-s02-v1','simple-profile-sales-v1','S02','فروش','تعداد مشتری جدید','نفر',4,'HIGHER_IS_BETTER',20,2),
('spi-s03-v1','simple-profile-sales-v1','S03','فروش','نرخ وصول مطالبات','درصد',85,'HIGHER_IS_BETTER',30,3),
('spi-m01-v1','simple-profile-marketing-v1','M01','بازاریابی و فروش','تعداد لید (سرنخ) تولیدشده','عدد',30,'HIGHER_IS_BETTER',40,1),
('spi-m02-v1','simple-profile-marketing-v1','M02','بازاریابی و فروش','نرخ تبدیل لید به قرارداد','درصد',20,'HIGHER_IS_BETTER',40,2),
('spi-m03-v1','simple-profile-marketing-v1','M03','بازاریابی و فروش','تعاملات برند (شبکه‌های اجتماعی)','عدد',200,'HIGHER_IS_BETTER',20,3),
('spi-f01-v1','simple-profile-sales-accounting-v1','F01','حسابداری فروش','دقت در صدور فاکتور','درصد',100,'HIGHER_IS_BETTER',40,1),
('spi-f02-v1','simple-profile-sales-accounting-v1','F02','حسابداری فروش','سرعت صدور فاکتور','روز',1,'LOWER_IS_BETTER',30,2),
('spi-f03-v1','simple-profile-sales-accounting-v1','F03','حسابداری فروش','مغایرت حساب‌ها','مورد',0,'LOWER_IS_BETTER',30,3),
('spi-fm01-v1','simple-profile-finance-v1','FM01','مدیریت مالی','انحراف از بودجه','درصد',5,'LOWER_IS_BETTER',40,1),
('spi-fm02-v1','simple-profile-finance-v1','FM02','مدیریت مالی','مدیریت جریان نقدینگی','درصد',90,'HIGHER_IS_BETTER',40,2),
('spi-fm03-v1','simple-profile-finance-v1','FM03','مدیریت مالی','زمان گزارش‌دهی','روز',3,'LOWER_IS_BETTER',20,3),
('spi-hr01-v1','simple-profile-hr-v1','HR01','اچ‌آر و برندینگ','نرخ نگهداشت پرسنل','درصد',95,'HIGHER_IS_BETTER',40,1),
('spi-hr02-v1','simple-profile-hr-v1','HR02','اچ‌آر و برندینگ','زمان استخدام','روز',30,'LOWER_IS_BETTER',30,2),
('spi-hr03-v1','simple-profile-hr-v1','HR03','اچ‌آر و برندینگ','رضایت همکاران داخلی','درصد',85,'HIGHER_IS_BETTER',30,3),
('spi-pr01-v1','simple-profile-procurement-v1','PR01','خرید و تأمین سنگ','درصد برگشتی سنگ خریداری‌شده','درصد',2,'LOWER_IS_BETTER',50,1),
('spi-pr02-v1','simple-profile-procurement-v1','PR02','خرید و تأمین سنگ','صرفه اقتصادی قیمت خرید','درصد',95,'HIGHER_IS_BETTER',30,2),
('spi-pr03-v1','simple-profile-procurement-v1','PR03','خرید و تأمین سنگ','زمان تحویل تأمین‌کننده','روز',7,'LOWER_IS_BETTER',20,3),
('spi-w01-v1','simple-profile-buyer-v1','W01','کارپرداز','سرعت انجام خریدهای خرد','روز',2,'LOWER_IS_BETTER',40,1),
('spi-w02-v1','simple-profile-buyer-v1','W02','کارپرداز','صرفه و صلاح مالی خریدها','درصد',90,'HIGHER_IS_BETTER',30,2),
('spi-w03-v1','simple-profile-buyer-v1','W03','کارپرداز','رضایت درخواست‌کنندگان داخلی','درصد',85,'HIGHER_IS_BETTER',30,3),
('spi-l01-v1','simple-profile-logistics-v1','L01','سرپرست لجستیک','زمان تحویل به مشتری','روز',3,'LOWER_IS_BETTER',40,1),
('spi-l02-v1','simple-profile-logistics-v1','L02','سرپرست لجستیک','هزینه حمل نسبت به بودجه','درصد',95,'HIGHER_IS_BETTER',30,2),
('spi-l03-v1','simple-profile-logistics-v1','L03','سرپرست لجستیک','خطای در ارسال','مورد',0,'LOWER_IS_BETTER',30,3),
('spi-wk01-v1','simple-profile-workshop-v1','WK01','سرپرست کارگاه سنگ و انبار','میزان پرت سنگ','درصد',5,'LOWER_IS_BETTER',50,1),
('spi-wk02-v1','simple-profile-workshop-v1','WK02','سرپرست کارگاه سنگ و انبار','دقت موجودی انبار','درصد',98,'HIGHER_IS_BETTER',30,2),
('spi-wk03-v1','simple-profile-workshop-v1','WK03','سرپرست کارگاه سنگ و انبار','رعایت زمان‌بندی تولید','درصد',95,'HIGHER_IS_BETTER',20,3),
('spi-sct01-v1','simple-profile-security-v1','SCT01','انتظامات','کنترل صحیح تردد','درصد',100,'HIGHER_IS_BETTER',40,1),
('spi-sct02-v1','simple-profile-security-v1','SCT02','انتظامات','گزارش‌دهی دقیق حوادث','درصد',100,'HIGHER_IS_BETTER',30,2),
('spi-sct03-v1','simple-profile-security-v1','SCT03','انتظامات','رعایت پروتکل‌های امنیتی','درصد',100,'HIGHER_IS_BETTER',30,3),
('spi-hs01-v1','simple-profile-services-v1','HS01','خدمات و تشریفات','رضایت پرسنل و مهمانان','درصد',85,'HIGHER_IS_BETTER',40,1),
('spi-hs02-v1','simple-profile-services-v1','HS02','خدمات و تشریفات','نظم و پاکیزگی محیط کار','درصد',90,'HIGHER_IS_BETTER',30,2),
('spi-hs03-v1','simple-profile-services-v1','HS03','خدمات و تشریفات','سرعت رسیدگی به درخواست‌ها','ساعت',4,'LOWER_IS_BETTER',30,3),
('spi-it01-v1','simple-profile-it-v1','IT01','برنامه‌نویس و ای‌تی','پایداری سیستم (Uptime)','درصد',99,'HIGHER_IS_BETTER',40,1),
('spi-it02-v1','simple-profile-it-v1','IT02','برنامه‌نویس و ای‌تی','زمان رفع تیکت پشتیبانی','ساعت',8,'LOWER_IS_BETTER',30,2),
('spi-it03-v1','simple-profile-it-v1','IT03','برنامه‌نویس و ای‌تی','پیشرفت پروژه‌ها طبق زمان‌بندی','درصد',90,'HIGHER_IS_BETTER',30,3);
