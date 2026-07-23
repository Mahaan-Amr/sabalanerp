export const isValidIranianNationalCode = (value: unknown) => {
  const code = String(value || '');
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const sum = code.slice(0, 9).split('').reduce((total, digit, index) => total + Number(digit) * (10 - index), 0);
  const remainder = sum % 11;
  return Number(code[9]) === (remainder < 2 ? remainder : 11 - remainder);
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
  if (iranian && !isValidIranianNationalCode(data?.nationalCode)) throw new Error('کد ملی معتبر نیست.');
  if (!iranian && (!data?.foreignIdentityType || !data?.foreignIdentityNumber)) missing.push('foreignIdentity');
  if (!/^09\d{9}$/.test(String(data?.mobile || ''))) throw new Error('شماره همراه معتبر نیست.');
  if (missing.length) throw new Error(`پاسخ فیلدهای الزامی ناقص است: ${Array.from(new Set(missing)).join(', ')}`);
  return true;
};

export const validateHiringCorrection = (data: any, fields: string[]) => {
  const missing = fields.filter((key) =>
    data?.[key] === undefined ||
    data?.[key] === null ||
    String(data[key]).trim() === ''
  );
  if (missing.length) {
    throw new Error(`فیلدهای درخواستی برای اصلاح ناقص‌اند: ${missing.join(', ')}`);
  }
  if (fields.includes('nationalCode') && data?.identityKind !== 'FOREIGN' && !isValidIranianNationalCode(data?.nationalCode)) {
    throw new Error('کد ملی معتبر نیست.');
  }
  if (fields.includes('postalCode') && !/^\d{10}$/.test(String(data?.postalCode || ''))) {
    throw new Error('کد پستی باید ۱۰ رقم باشد.');
  }
  if (fields.includes('mobile') && !/^09\d{9}$/.test(String(data?.mobile || ''))) {
    throw new Error('شماره همراه معتبر نیست.');
  }
  return true;
};

export const compensationTotalRials = (components: Array<{ label?: string; amountRials: string | number }>) => {
  if (!Array.isArray(components) || !components.length) throw new Error('حداقل یک ردیف جبران خدمات لازم است.');
  return components.reduce((sum, item) => {
    if (!String(item.label || '').trim()) throw new Error('عنوان هر ردیف جبران خدمات الزامی است.');
    const value = String(item.amountRials ?? '');
    if (!/^\d+$/.test(value)) throw new Error('مبلغ هر ردیف باید عدد صحیح ریال باشد.');
    return sum + BigInt(value);
  }, 0n);
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
