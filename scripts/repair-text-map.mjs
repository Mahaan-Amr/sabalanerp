import fs from 'fs';
import path from 'path';

const replacements = [
  ['�&حص��D', 'محصول'],
  ['�&حص��D\'*', 'محصولات'],
  ['�&��AB�*', 'موفقیت'],
  ['��69�*', 'وضعیت'],
  ['��\'1//5\'/1', 'وارد/صادر'],
  ['ت��6�-\'*', 'توضیحات'],
  ['ا� ��\'9', 'انواع'],
  ['� ��9', 'نوع'],
  ['فعا�\u001e', 'فعال'],
  ['جد��D�', 'جدولی'],
  ['ر��2', 'روز'],
  ['�&�R�Rخ��\'G�/', 'می‌خواهید'],
  ['تح���D\fG\'', 'تحویل‌ها'],
  ['� خ��\'G/', 'نخواهد'],
  ['ب��/', 'بود'],
  ['�&ج��2', 'مجوز'],
  ['ضر��1�', 'ضروری'],
  ['فر��4', 'فروش'],
  ['داشب��1/', 'داشبورد'],
  ['پر��A\'�D', 'پروفایل'],
  ['پر����G', 'پروژه'],
  ['خص��5�\'*', 'خصوصیات'],
  ['ط��D�', 'طولی'],
  ['ط��D', 'طول'],
  ['ضخا�&*', 'ضخامت'],
  ['جاد�Ư1', 'جادوگر'],
  ['ا� صراف', 'انصراف'],
  ['��ر��/', 'ورود'],
  ['خر��,�', 'خروجی'],
  ['خر��,', 'خروج'],
  ['ب�!�Rر��213\'F�', 'به‌روزرسانی'],
  ['استا� دارد', 'استاندارد'],
  ['س� گ', 'سنگ'],
  ['خد�&*', 'خدمت'],
  ['خد�&\'*', 'خدمات'],
  ['�&��\'/', 'مواد'],
  ['�&ا�&��1�*\fG\'', 'ماموریت‌ها'],
  ['حض��1 و غیاب', 'حضور و غیاب'],
  ['تخص�R5', 'تخصیص'],
  ['ارسا�\u001e', 'ارسال'],
  ['آ�&\'1', 'آمار'],
  ['� اپ', 'چاپ'],
  ['ا�&6\'', 'امضا'],
  ['استث� اء', 'استثناء']
];

const files = process.argv.slice(2).map((p) => path.resolve(process.cwd(), p));
if (!files.length) {
  console.error('Usage: node scripts/repair-text-map.mjs <file...>');
  process.exit(2);
}

for (const filePath of files) {
  if (!fs.existsSync(filePath)) continue;
  const original = fs.readFileSync(filePath, 'utf8');
  let updated = original;
  for (const [from, to] of replacements) {
    updated = updated.split(from).join(to);
  }
  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf8');
    console.log(`updated ${path.relative(process.cwd(), filePath)}`);
  }
}

