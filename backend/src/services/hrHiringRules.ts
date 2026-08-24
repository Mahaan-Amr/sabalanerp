export const isValidIranianNationalCode = (value: unknown) => {
  const code = String(value || '');
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const sum = code.slice(0, 9).split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  return Number(code[9]) === (remainder < 2 ? remainder : 11 - remainder);
};

const validateIranianNationalCode = (value: unknown) => {
  const code = String(value ?? '');
  if (!/^\d{10}$/.test(code)) throw new Error('کد ملی باید دقیقاً ۱۰ رقم باشد.');
  if (!isValidIranianNationalCode(code)) throw new Error('کد ملی معتبر نیست.');
};

export const validateHiringQuestionnaire = (data: any) => {
  const required = [
    'firstName', 'lastName', 'alias', 'birthDate', 'birthPlace', 'militaryStatus', 'fatherName',
    'fatherOccupation', 'maritalStatus', 'address', 'postalCode', 'mobile', 'homePhone',
    'educationLevel', 'fieldOfStudy', 'graduationYear', 'socialMedia', 'hasSocialSecurityHistory'
  ];
  const missing = required.filter((key) => data?.[key] === undefined || data?.[key] === null || String(data[key]).trim() === '');
  if (data?.maritalStatus === 'MARRIED') {
    for (const key of ['childrenCount', 'spouseOccupation']) {
      if (data?.[key] === undefined || data?.[key] === null || String(data[key]).trim() === '') missing.push(key);
    }
  }
  if (!/^\d{10}$/.test(String(data?.postalCode || ''))) throw new Error('کد پستی باید ۱۰ رقم باشد.');
  if (!['SINGLE', 'MARRIED'].includes(data?.maritalStatus)) throw new Error('وضعیت تأهل نامعتبر است.');
  if (!['IRANIAN', 'FOREIGN'].includes(data?.identityKind)) throw new Error('نوع هویت نامعتبر است.');
  if (!['پایان خدمت', 'معاف', 'مشمول', 'غیرقابل اعمال'].includes(data?.militaryStatus)) throw new Error('وضعیت نظام وظیفه نامعتبر است.');
  if (!['FULL_TIME', 'PART_TIME'].includes(data?.cooperationType) || !['LONG_TERM', 'SHORT_TERM'].includes(data?.cooperationDuration)) throw new Error('ترجیحات همکاری نامعتبر است.');
  if (typeof data?.hasSocialSecurityHistory !== 'boolean') throw new Error('وضعیت سابقه بیمه باید انتخاب شود.');
  if (data?.maritalStatus === 'MARRIED' && (!Number.isInteger(Number(data.childrenCount)) || Number(data.childrenCount) < 0)) throw new Error('تعداد فرزندان نامعتبر است.');
  const iranian = data?.identityKind !== 'FOREIGN';
  if (iranian) validateIranianNationalCode(data?.nationalCode);
  if (!iranian && (!data?.foreignIdentityType || !data?.foreignIdentityNumber)) missing.push('foreignIdentity');
  if (!/^09\d{9}$/.test(String(data?.mobile || ''))) throw new Error('شماره همراه معتبر نیست.');
  const educationLevels = ['PRIMARY', 'LOWER_SECONDARY', 'DIPLOMA', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'DOCTORATE', 'SEMINARY', 'OTHER'];
  if (!educationLevels.includes(String(data?.educationLevel || ''))) throw new Error('آخرین مقطع تحصیلی نامعتبر است.');
  if (data?.educationLevel === 'OTHER' && !String(data?.educationLevelOther || '').trim()) throw new Error('عنوان مقطع برای گزینه سایر الزامی است.');
  const currentJalaliYear = Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' }).formatToParts(new Date()).find((part) => part.type === 'year')?.value);
  if (!/^\d{4}$/.test(String(data?.graduationYear || '')) || Number(data.graduationYear) < 1300 || Number(data.graduationYear) > currentJalaliYear) {
    throw new Error(`سال اخذ مدرک باید بین ۱۳۰۰ تا ${currentJalaliYear.toLocaleString('fa-IR', { useGrouping: false })} باشد.`);
  }
  validateHiringRepeaters(data);
  if (missing.length) throw new Error(`پاسخ فیلدهای الزامی ناقص است: ${Array.from(new Set(missing)).join(', ')}`);
  return true;
};

const validateHiringRepeaters = (data: any, requestedFields?: Set<string>) => {
  const repeaters = [
    { key: 'workHistory', label: 'سابقه کاری', fields: ['organization', 'duration', 'lastPosition', 'lastSalaryBenefits'] },
    { key: 'skills', label: 'مهارت', fields: ['name', 'familiarity', 'proficiency'] },
    { key: 'languages', label: 'زبان خارجی', fields: ['name', 'level', 'proficiency'] },
  ];
  for (const repeater of repeaters) {
    if (requestedFields && !requestedFields.has(repeater.key)) continue;
    const rows = Array.isArray(data?.[repeater.key]) ? data[repeater.key] : [];
    rows.forEach((row: any, index: number) => {
      const filled = repeater.fields.filter((field) => String(row?.[field] ?? '').trim() !== '');
      if (filled.length > 0 && filled.length < repeater.fields.length) {
        throw new Error(`ردیف ${repeater.label} ${index + 1} باید کامل یا حذف شود.`);
      }
    });
  }
};

export const validateHiringCorrection = (data: any, fields: string[]) => {
  const requestedFields = new Set(fields);
  const missing = fields.filter((key) =>
    data?.[key] === undefined ||
    data?.[key] === null ||
    String(data[key]).trim() === ''
  );
  if (missing.length) {
    throw new Error(`فیلدهای درخواستی برای اصلاح ناقص‌اند: ${missing.join(', ')}`);
  }
  if (fields.includes('nationalCode') && data?.identityKind !== 'FOREIGN') validateIranianNationalCode(data?.nationalCode);
  if (fields.includes('postalCode') && !/^\d{10}$/.test(String(data?.postalCode || ''))) {
    throw new Error('کد پستی باید ۱۰ رقم باشد.');
  }
  if (fields.includes('mobile') && !/^09\d{9}$/.test(String(data?.mobile || ''))) {
    throw new Error('شماره همراه معتبر نیست.');
  }
  if (fields.includes('educationLevel')) {
    const educationLevels = ['PRIMARY', 'LOWER_SECONDARY', 'DIPLOMA', 'ASSOCIATE', 'BACHELOR', 'MASTER', 'DOCTORATE', 'SEMINARY', 'OTHER'];
    if (!educationLevels.includes(String(data?.educationLevel || ''))) throw new Error('آخرین مقطع تحصیلی نامعتبر است.');
    if (data?.educationLevel === 'OTHER' && !String(data?.educationLevelOther || '').trim()) throw new Error('عنوان مقطع برای گزینه سایر الزامی است.');
  }
  if (fields.includes('graduationYear')) {
    const currentJalaliYear = Number(new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' }).formatToParts(new Date()).find((part) => part.type === 'year')?.value);
    if (!/^\d{4}$/.test(String(data?.graduationYear || '')) || Number(data.graduationYear) < 1300 || Number(data.graduationYear) > currentJalaliYear) {
      throw new Error(`سال اخذ مدرک باید بین ۱۳۰۰ تا ${currentJalaliYear.toLocaleString('fa-IR', { useGrouping: false })} باشد.`);
    }
  }
  validateHiringRepeaters(data, requestedFields);
  return true;
};

const COMPENSATION_CATEGORY_LABELS: Record<string, string> = {
  BASE_SALARY: 'حقوق پایه',
  FIXED_BENEFIT: 'مزایای ثابت',
  VARIABLE_BENEFIT: 'مزایای متغیر',
  ALLOWANCE: 'کمک‌هزینه',
};

export type CompensationComponentInput = {
  category?: string;
  label?: string;
  amountRials: string | number;
};

export const normalizeCompensationComponents = (components: CompensationComponentInput[]) => {
  if (!Array.isArray(components) || !components.length) throw new Error('حداقل یک ردیف جبران خدمات لازم است.');
  const normalized = components.map((component) => {
    const category = String(component.category || '');
    if (category === 'OTHER') {
      const label = String(component.label || '').trim();
      if (!label) throw new Error('عنوان مورد سایر الزامی است.');
      return { category, label, amountRials: normalizeHiringRial(component.amountRials) };
    }
    const label = COMPENSATION_CATEGORY_LABELS[category];
    if (!label) throw new Error('طبقه‌بندی ساختاریافته همه ردیف‌های جبران خدمات الزامی است.');
    return { category, label, amountRials: normalizeHiringRial(component.amountRials) };
  });
  if (normalized.filter(({ category }) => category === 'BASE_SALARY').length !== 1) {
    throw new Error('پیشنهاد باید دقیقاً یک ردیف حقوق پایه داشته باشد.');
  }
  const identities = new Set<string>();
  for (const component of normalized) {
    if (BigInt(component.amountRials) <= 0n) throw new Error('مبلغ هر ردیف باید بزرگ‌تر از صفر باشد.');
    const identity = component.category === 'OTHER'
      ? `OTHER:${component.label.replace(/\s+/g, ' ').toLocaleLowerCase('fa-IR')}`
      : component.category;
    if (identities.has(identity)) throw new Error('ردیف‌های جبران خدمات تکراری مجاز نیستند.');
    identities.add(identity);
  }
  return normalized;
};

export const compensationTotalRials = (components: Array<{ label?: string; amountRials: string | number }>) => {
  if (!Array.isArray(components) || !components.length) throw new Error('حداقل یک ردیف جبران خدمات لازم است.');
  const total = components.reduce((sum, item) => {
    if (!String(item.label || '').trim()) throw new Error('عنوان هر ردیف جبران خدمات الزامی است.');
    const value = String(item.amountRials ?? '');
    if (!/^\d+$/.test(value)) throw new Error('مبلغ هر ردیف باید عدد صحیح ریال باشد.');
    return sum + BigInt(value);
  }, 0n);
  if (total.toString().length > 18) throw new Error('جمع پیشنهاد حقوق از سقف مبلغ ریالی مجاز بیشتر است.');
  return total;
};

const COLLATERAL_LABELS: Record<string, string> = {
  PROMISSORY_NOTE: 'سفته', CHEQUE: 'چک ضمانت', GUARANTEE: 'ضامن',
  UNDERTAKING: 'تعهدنامه', OTHER: 'وثیقه',
};

export const collateralCandidateExplanation = (type: string, amountRials: string | null) => {
  const label = COLLATERAL_LABELS[type] || COLLATERAL_LABELS.OTHER;
  const amount = amountRials ? ` به مبلغ ${BigInt(amountRials).toLocaleString('en-US')} ریال` : '';
  return `پس از پذیرش پیشنهاد، امور مالی برای دریافت ${label}${amount} با شما هماهنگ می‌کند.`;
};

export const unresolvedActivationRequirements = (input: {
  scheduledStartDate?: Date | null;
  identityClearance: string;
  collateralClearance: string;
  contractClearance: string;
  compensationClearance: string;
  hasPayrollParticipation: boolean;
  tasks: Array<{ title: string; activationBlocker: boolean; status: string }>;
}, now = new Date()) => {
  const unresolved: string[] = [];
  if (!input.scheduledStartDate || input.scheduledStartDate > now) unresolved.push('تاریخ شروع');
  if (input.identityClearance !== 'APPROVED') unresolved.push('تأیید هویت');
  if (input.collateralClearance !== 'APPROVED') unresolved.push('تأیید وثیقه');
  if (input.contractClearance !== 'APPROVED') unresolved.push('تأیید قرارداد');
  if (input.compensationClearance !== 'APPROVED') unresolved.push('تأیید جبران خدمات');
  if (!input.hasPayrollParticipation) unresolved.push('مشارکت حقوق و دستمزد');
  unresolved.push(...input.tasks.filter((task) => task.activationBlocker && !['COMPLETE', 'WAIVED'].includes(task.status)).map((task) => task.title));
  return unresolved;
};
import { normalizeHiringRial } from './hrApplicantExperience';
