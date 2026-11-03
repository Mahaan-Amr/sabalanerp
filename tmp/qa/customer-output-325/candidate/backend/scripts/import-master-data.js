const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Master data mappings based on Excel analysis
const MASTER_DATA = {
  cuttingDimensions: {
    1: { name: 'Longitudinal', namePersian: 'طولی' },
    2: { name: 'Tile/Block', namePersian: 'حکمی/تایل' },
    3: { name: 'Volumetric', namePersian: 'حجمی' }
  },
  stoneMaterials: {
    1: { name: 'Travertine', namePersian: 'تراورتن' },
    2: { name: 'Marble', namePersian: 'مرمریت' },
    3: { name: 'Crystal Marble', namePersian: 'کریستال ماربل' },
    4: { name: 'Granite', namePersian: 'گرانیت' },
    5: { name: 'Basalt', namePersian: 'بازالت' },
    6: { name: 'Limestone', namePersian: 'لایمستون' },
    7: { name: 'Andesite', namePersian: 'آندوزیت' },
    8: { name: 'Traunix', namePersian: 'ترااونیکس' },
    9: { name: 'Tramit', namePersian: 'ترامیت' },
    10: { name: 'Sandstone', namePersian: 'سند استون' },
    11: { name: 'Onyx', namePersian: 'اونیکس' },
    12: { name: 'Alabaster', namePersian: 'آلاباستر' }
  },
  cutWidths: {
    1: { value: 10, name: 'عرض 10', namePersian: 'عرض 10', unit: 'cm' },
    2: { value: 15, name: 'عرض 15', namePersian: 'عرض 15', unit: 'cm' },
    3: { value: 20, name: 'عرض 20', namePersian: 'عرض 20', unit: 'cm' },
    4: { value: 25, name: 'عرض 25', namePersian: 'عرض 25', unit: 'cm' },
    5: { value: 30, name: 'عرض 30', namePersian: 'عرض 30', unit: 'cm' },
    6: { value: 35, name: 'عرض 35', namePersian: 'عرض 35', unit: 'cm' },
    7: { value: 40, name: 'عرض 40', namePersian: 'عرض 40', unit: 'cm' },
    8: { value: 50, name: 'عرض 50', namePersian: 'عرض 50', unit: 'cm' },
    9: { value: 60, name: 'عرض 60', namePersian: 'عرض 60', unit: 'cm' },
    10: { value: 70, name: 'عرض 70', namePersian: 'عرض 70', unit: 'cm' },
    11: { value: 80, name: 'عرض 80', namePersian: 'عرض 80', unit: 'cm' }
  },
  thicknesses: {
    1: { value: 2, name: 'ضخامت 2CM', namePersian: 'ضخامت 2CM', unit: 'cm' },
    2: { value: 3, name: 'ضخامت 3CM', namePersian: 'ضخامت 3CM', unit: 'cm' },
    3: { value: 4, name: 'ضخامت 4CM', namePersian: 'ضخامت 4CM', unit: 'cm' },
    4: { value: 5, name: 'ضخامت 5CM', namePersian: 'ضخامت 5CM', unit: 'cm' },
    5: { value: 6, name: 'ضخامت 6CM', namePersian: 'ضخامت 6CM', unit: 'cm' }
  },
  mines: {
    '001': { name: 'Abbas Abad', namePersian: 'عباس آباد' },
    '002': { name: 'Yazd', namePersian: 'یزد' },
    '003': { name: 'Kashan', namePersian: 'کاشان' },
    '004': { name: 'Natanz', namePersian: 'نطنز' },
    '005': { name: 'Mashhad', namePersian: 'مشهد' },
    '006': { name: 'Nehbandan', namePersian: 'نهبندان' },
    '007': { name: 'Marvarid', namePersian: 'مروارید' },
    '008': { name: 'Khoy', namePersian: 'خوی' },
    '009': { name: 'Salmas', namePersian: 'سلماس' },
    '010': { name: 'Azna', namePersian: 'ازنا' },
    '011': { name: 'Neyriz', namePersian: 'نی ریز' },
    '012': { name: 'Birjand', namePersian: 'بیرجند' },
    '013': { name: 'Piranshahr', namePersian: 'پیرانشهر' },
    '014': { name: 'Ardestan', namePersian: 'اردستان' },
    '015': { name: 'Mahabad', namePersian: 'مهاباد' },
    '016': { name: 'Mahallat', namePersian: 'محلات' },
    '017': { name: 'Mimeh', namePersian: 'میمه' },
    '018': { name: 'Sirjan', namePersian: 'سیرجان' },
    '019': { name: 'Marvdasht', namePersian: 'مرودشت' },
    '020': { name: 'Aligudarz', namePersian: 'الیگودرز' },
    '021': { name: 'Azar Shahr', namePersian: 'آذر شهر' },
    '022': { name: 'Joushqan', namePersian: 'جوشقان' },
    '023': { name: 'Qorveh', namePersian: 'قروه' },
    '024': { name: 'Abadeh', namePersian: 'آباده' },
    '025': { name: 'Arsanj', namePersian: 'ارسنجان' },
    '026': { name: 'Bavanat', namePersian: 'بوانات' },
    '027': { name: 'Behsangan', namePersian: 'بهسنگان' },
    '028': { name: 'Persian Silk', namePersian: 'پرشین سیلک' },
    '029': { name: 'Prince', namePersian: 'پرنس' },
    '030': { name: 'Palladium', namePersian: 'پلادیوم' },
    '031': { name: 'Tornado', namePersian: 'تورنادو' },
    '032': { name: 'Jiroft', namePersian: 'جیرفت' },
    '033': { name: 'Khorramabad', namePersian: 'خرم آباد' },
    '034': { name: 'Khoobsangan', namePersian: 'خوبسنگان' },
    '035': { name: 'Dragon', namePersian: 'دراگون' },
    '036': { name: 'Dehbid', namePersian: 'دهبید' },
    '037': { name: 'Royal', namePersian: 'رویال' },
    '038': { name: 'Sanandaj', namePersian: 'سنندج' },
    '039': { name: 'Simkan', namePersian: 'سیمکان' },
    '040': { name: 'Shahyadi', namePersian: 'شهیادی' },
    '041': { name: 'Cubism', namePersian: 'کوبیسم' },
    '042': { name: 'Golden Beauty', namePersian: 'گلدن بیوتی' },
    '043': { name: 'Gandmak', namePersian: 'گندمک' },
    '044': { name: 'Gohreh Khorramabad', namePersian: 'گوهره خرم آباد' },
    '045': { name: 'Lashtr', namePersian: 'لاشتر' },
    '046': { name: 'Marfil', namePersian: 'مارفیل' },
    '047': { name: 'Maragheh', namePersian: 'مراغه' },
    '048': { name: 'Mehkam', namePersian: 'مهکام' },
    '049': { name: 'Najafabad', namePersian: 'نجف آباد' },
    '050': { name: 'Harsin', namePersian: 'هرسین' },
    '051': { name: 'Almut', namePersian: 'الموت' },
    '052': { name: 'Taybad', namePersian: 'تایباد' },
    '053': { name: 'Tuysekan', namePersian: 'تویسرکان' },
    '054': { name: 'Chinese', namePersian: 'چینی' },
    '055': { name: 'Khoram Dareh', namePersian: 'خرم دره' },
    '056': { name: 'Zahedan', namePersian: 'زاهدان' },
    '057': { name: 'Zanjan', namePersian: 'زنجان' },
    '058': { name: 'Green Forest', namePersian: 'سبز جنگلی' },
    '059': { name: 'Shaghayeq', namePersian: 'شقایق' },
    '060': { name: 'Pearl', namePersian: 'مروارید' },
    '061': { name: 'Bukan', namePersian: 'بوکان' },
    '062': { name: 'Samirum', namePersian: 'سمیرم' },
    '063': { name: 'Naghdeh', namePersian: 'نقده' },
    '064': { name: 'Haji Abad', namePersian: 'حاجی آباد' },
    '065': { name: 'Khalhal', namePersian: 'خلخال' },
    '066': { name: 'Dareh Bakhari', namePersian: 'دره بخاری' },
    '067': { name: 'Ramesh', namePersian: 'رامشه' },
    '068': { name: 'Tabas', namePersian: 'طبس' },
    '069': { name: 'Torq', namePersian: 'طرق' },
    '070': { name: 'Makou', namePersian: 'ماکو' },
    '071': { name: 'Abianeh', namePersian: 'ابیانه' },
    '072': { name: 'Atashkuh', namePersian: 'آتشکوه' },
    '073': { name: 'Parham', namePersian: 'پرهام' },
    '074': { name: 'Takab', namePersian: 'تکاب' },
    '075': { name: 'Yazd Dehshir', namePersian: 'یزد دهشیر' },
    '076': { name: 'Lushan', namePersian: 'لوشان' },
    '077': { name: 'Abgarm', namePersian: 'آبگرم' }
  },
  finishTypes: {
    1: { name: 'Polished', namePersian: 'صیقل' },
    2: { name: 'Raw', namePersian: 'خام' },
    3: { name: 'Zero Sand', namePersian: 'ساب صفر' },
    4: { name: 'Leather', namePersian: 'چرمی' },
    5: { name: 'Honed', namePersian: 'هوند' },
    6: { name: 'Flamed', namePersian: 'فلیم' },
    7: { name: 'Scratched', namePersian: 'اسکراچ' },
    8: { name: 'Grooved', namePersian: 'شیار' },
    9: { name: 'Sand Blast', namePersian: 'سند بلاست' },
    10: { name: 'Chiseled', namePersian: 'تیشه' },
    11: { name: 'Bush Hammer', namePersian: 'بوش همر' },
    12: { name: 'Cut Hammer', namePersian: 'کات همر' },
    13: { name: 'Cut Broken', namePersian: 'کات بروکن' }
  },
  colors: {
    1: { name: 'White', namePersian: 'سفید' },
    2: { name: 'Light Cream', namePersian: 'کرم روشن' },
    3: { name: 'Cream', namePersian: 'کرم' },
    4: { name: 'Honey', namePersian: 'عسلی' },
    5: { name: 'Chocolate', namePersian: 'شکلاتی' },
    6: { name: 'Gray', namePersian: 'طوسی' },
    7: { name: 'Beige', namePersian: 'بژ' },
    8: { name: 'Silver', namePersian: 'سیلور' },
    9: { name: 'Black', namePersian: 'مشکی' },
    10: { name: 'Red', namePersian: 'قرمز' },
    11: { name: 'Yellow', namePersian: 'زرد' },
    12: { name: 'Blue', namePersian: 'آبی' },
    13: { name: 'Peach', namePersian: 'هلویی' },
    14: { name: 'Plum', namePersian: 'سماقی' },
    15: { name: 'Tomato', namePersian: 'گوجه ای' },
    16: { name: 'Salt Pepper', namePersian: 'فلفل نمکی' },
    17: { name: 'Coffee', namePersian: 'نسکافه ای' },
    18: { name: 'Pomegranate Seed', namePersian: 'دانه اناری' },
    19: { name: 'Turquoise', namePersian: 'فیروزه ای' }
  }
};

async function importMasterData() {
  try {
    console.log('🚀 Starting master data import...');
    
    let totalImported = 0;
    
    // Import Cut Types
    console.log('\n📊 Importing Cut Types...');
    for (const [code, data] of Object.entries(MASTER_DATA.cuttingDimensions)) {
      await prisma.cutType.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.cuttingDimensions).length} cut types`);
    
    // Import Stone Materials
    console.log('\n📊 Importing Stone Materials...');
    for (const [code, data] of Object.entries(MASTER_DATA.stoneMaterials)) {
      await prisma.stoneMaterial.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.stoneMaterials).length} stone materials`);
    
    // Import Cut Widths
    console.log('\n📊 Importing Cut Widths...');
    for (const [code, data] of Object.entries(MASTER_DATA.cutWidths)) {
      await prisma.cutWidth.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.cutWidths).length} cut widths`);
    
    // Import Thicknesses
    console.log('\n📊 Importing Thicknesses...');
    for (const [code, data] of Object.entries(MASTER_DATA.thicknesses)) {
      await prisma.thickness.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.thicknesses).length} thicknesses`);
    
    // Import Mines
    console.log('\n📊 Importing Mines...');
    for (const [code, data] of Object.entries(MASTER_DATA.mines)) {
      await prisma.mine.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.mines).length} mines`);
    
    // Import Finish Types
    console.log('\n📊 Importing Finish Types...');
    for (const [code, data] of Object.entries(MASTER_DATA.finishTypes)) {
      await prisma.finishType.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.finishTypes).length} finish types`);
    
    // Import Colors
    console.log('\n📊 Importing Colors...');
    for (const [code, data] of Object.entries(MASTER_DATA.colors)) {
      await prisma.color.upsert({
        where: { code },
        update: data,
        create: {
          code,
          ...data,
          isActive: true
        }
      });
      totalImported++;
    }
    console.log(`✅ Imported ${Object.keys(MASTER_DATA.colors).length} colors`);
    
    console.log('\n📊 Master Data Import Summary:');
    console.log(`✅ Total imported: ${totalImported} master data items`);
    console.log('🎉 Master data import completed successfully!');
    
  } catch (error) {
    console.error('❌ Master data import failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importMasterData();
