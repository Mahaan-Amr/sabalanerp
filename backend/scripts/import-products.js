const { PrismaClient } = require('@prisma/client');
const XLSX = require('xlsx');
const path = require('path');

const prisma = new PrismaClient();

// Product attribute mappings based on Excel analysis
const PRODUCT_ATTRIBUTES = {
  cuttingDimensions: {
    1: { name: 'Longitudinal', namePersian: 'طولی' },
    2: { name: 'Tile/Block', namePersian: 'حکمی/تایل' },
    3: { name: 'Volumetric', namePersian: 'حجمی' }
  },
  stoneTypes: {
    1: { name: 'Travertine', namePersian: 'تراورتن' },
    2: { name: 'Marble', namePersian: 'مرمریت' },
    3: { name: 'Crystal Marble', namePersian: 'کریستال ماربل' },
    4: { name: 'Granite', namePersian: 'گرانیت' },
    5: { name: 'Basalt', namePersian: 'بازالت' },
    6: { name: 'Limestone', namePersian: 'لایمستون' },
    7: { name: 'Andesite', namePersian: 'آندوزیت' },
    8: { name: 'Travertine', namePersian: 'ترااونیکس' },
    9: { name: 'Travertine', namePersian: 'ترامیت' },
    10: { name: 'Sandstone', namePersian: 'سند استون' },
    11: { name: 'Onyx', namePersian: 'اونیکس' },
    12: { name: 'Alabaster', namePersian: 'آلاباستر' }
  },
  widths: {
    1: { value: 10, name: 'عرض 10' },
    2: { value: 15, name: 'عرض 15' },
    3: { value: 20, name: 'عرض 20' },
    4: { value: 25, name: 'عرض 25' },
    5: { value: 30, name: 'عرض 30' },
    6: { value: 35, name: 'عرض 35' },
    7: { value: 40, name: 'عرض 40' },
    8: { value: 50, name: 'عرض 50' },
    9: { value: 60, name: 'عرض 60' },
    10: { value: 70, name: 'عرض 70' },
    11: { value: 80, name: 'عرض 80' }
  },
  thicknesses: {
    1: { value: 2, name: 'ضخامت 2CM' },
    2: { value: 3, name: 'ضخامت 3CM' },
    3: { value: 4, name: 'ضخامت 4CM' },
    4: { value: 5, name: 'ضخامت 5CM' },
    5: { value: 6, name: 'ضخامت 6CM' }
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
    '019': { name: 'Marvdasht', namePersian: 'مرودشت' }
  },
  finishes: {
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
  },
  qualities: {
    1: { name: 'Super', namePersian: 'سوپر' },
    2: { name: 'Excellent', namePersian: 'ممتاز' },
    3: { name: 'First Grade', namePersian: 'درجه یک' },
    4: { name: 'Second Grade', namePersian: 'درجه دو' }
  }
};

// Generate product code from attributes
function generateProductCode(attributes) {
  const {
    cuttingDimensionCode,
    stoneTypeCode,
    widthCode,
    thicknessCode,
    mineCode,
    finishCode,
    colorCode,
    qualityCode
  } = attributes;
  
  return `${cuttingDimensionCode}${stoneTypeCode}${widthCode}${thicknessCode}${mineCode}${finishCode}${colorCode}${qualityCode}`;
}

// Generate product name from attributes
function generateProductName(attributes) {
  const {
    cuttingDimensionNamePersian,
    stoneTypeNamePersian,
    widthName,
    thicknessName,
    mineNamePersian,
    finishNamePersian,
    colorNamePersian,
    qualityNamePersian
  } = attributes;
  
  return `${stoneTypeNamePersian} ${colorNamePersian} ${qualityNamePersian} - ${widthName} × ${thicknessName} - ${mineNamePersian} - ${finishNamePersian} - ${cuttingDimensionNamePersian}`;
}

// Generate English product name
function generateProductNameEnglish(attributes) {
  const {
    cuttingDimensionName,
    stoneTypeName,
    widthValue,
    thicknessValue,
    mineName,
    finishName,
    colorName,
    qualityName
  } = attributes;
  
  return `${qualityName} ${colorName} ${stoneTypeName} - ${widthValue}cm × ${thicknessValue}cm - ${mineName} - ${finishName} - ${cuttingDimensionName}`;
}

async function importProducts() {
  try {
    console.log('🚀 Starting product import...');
    
    // Read Excel file
    const excelPath = path.join(__dirname, '../../excel/kala-kod.xls');
    const workbook = XLSX.readFile(excelPath);
    const sheetName = workbook.SheetNames[1]; // Sheet2 (index 1) - contains the actual product data
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
    
    console.log(`📊 Found ${data.length - 1} product rows in Excel file`);
    
    // Skip header row
    const productRows = data.slice(1);
    
    let importedCount = 0;
    let skippedCount = 0;
    
    for (const [index, row] of productRows.entries()) {
      try {
        // Skip empty rows
        if (!row || row.length === 0 || row.every(cell => cell === undefined || cell === null || cell === '')) {
          continue;
        }
        
        // Extract data from row based on actual Excel structure
        const [
          cuttingDimensionName,
          cuttingDimensionCode,
          stoneTypeName,
          stoneTypeCode,
          widthName,
          widthCode,
          thicknessName,
          thicknessCode,
          mineName,
          mineCode,
          finishName,
          finishCode,
          colorName,
          colorCode,
          qualityName,
          qualityCode,
          generatedName,
          generatedCode
        ] = row;
        
        // Validate required fields
        if (!cuttingDimensionName || !stoneTypeName || !widthName || !thicknessName || !mineName || !finishName) {
          console.log(`⚠️  Skipping row ${index + 2}: Missing required data`);
          skippedCount++;
          continue;
        }
        
        // Parse width and thickness values from names
        const widthMatch = widthName.match(/ع(\d+)/);
        const thicknessMatch = thicknessName.match(/ض(\d+)/);
        
        const widthValue = widthMatch ? parseInt(widthMatch[1]) : 0;
        const thicknessValue = thicknessMatch ? parseInt(thicknessMatch[1]) : 0;
        
        // Create attribute objects from Excel data
        const cuttingDimension = {
          name: cuttingDimensionName === 'تایل' ? 'Tile' : cuttingDimensionName === 'طولی' ? 'Longitudinal' : 'Volumetric',
          namePersian: cuttingDimensionName
        };
        
        const stoneType = {
          name: stoneTypeName === 'کریستال' ? 'Crystal' : stoneTypeName === 'مرمریت' ? 'Marble' : stoneTypeName,
          namePersian: stoneTypeName
        };
        
        const width = {
          value: widthValue,
          name: widthName
        };
        
        const thickness = {
          value: thicknessValue,
          name: thicknessName
        };
        
        const mine = {
          name: mineName,
          namePersian: mineName
        };
        
        const finish = {
          name: finishName === 'صیقل' ? 'Polished' : finishName,
          namePersian: finishName
        };
        
        // Handle optional color and quality
        const color = {
          name: colorName || 'Default',
          namePersian: colorName || 'پیش‌فرض'
        };
        
        const quality = {
          name: qualityName || 'Standard',
          namePersian: qualityName || 'استاندارد'
        };
        
        // Use generated code from Excel or create our own
        const productCode = generatedCode || `${cuttingDimensionCode}${stoneTypeCode}${widthCode}${thicknessCode}${mineCode}${finishCode}${colorCode || '00'}${qualityCode || '00'}`;
        
        // Use generated name from Excel or create our own
        const namePersian = generatedName || `${stoneType.namePersian} ${width.name} × ${thickness.name} - ${mine.namePersian} - ${finish.namePersian}`;
        const nameEnglish = `${stoneType.name} ${width.value}cm × ${thickness.value}cm - ${mine.name} - ${finish.name}`;
        
        // Check if product already exists
        const existingProduct = await prisma.product.findUnique({
          where: { code: productCode }
        });
        
        if (existingProduct) {
          console.log(`⚠️  Product ${productCode} already exists, skipping...`);
          skippedCount++;
          continue;
        }
        
        // Create product
        await prisma.product.create({
          data: {
            code: productCode,
            name: nameEnglish,
            namePersian: namePersian,
            
            cuttingDimensionCode: String(cuttingDimensionCode || '1'),
            cuttingDimensionName: cuttingDimension.name,
            cuttingDimensionNamePersian: cuttingDimension.namePersian,
            
            stoneTypeCode: String(stoneTypeCode || '1'),
            stoneTypeName: stoneType.name,
            stoneTypeNamePersian: stoneType.namePersian,
            
            widthCode: String(widthCode || '1'),
            widthValue: widthValue,
            widthName: width.name,
            
            thicknessCode: String(thicknessCode || '1'),
            thicknessValue: thicknessValue,
            thicknessName: thickness.name,
            
            mineCode: String(mineCode || '000'),
            mineName: mine.name,
            mineNamePersian: mine.namePersian,
            
            finishCode: String(finishCode || '1'),
            finishName: finish.name,
            finishNamePersian: finish.namePersian,
            
            colorCode: String(colorCode || '1'),
            colorName: color.name,
            colorNamePersian: color.namePersian,
            
            qualityCode: String(qualityCode || '1'),
            qualityName: quality.name,
            qualityNamePersian: quality.namePersian,
            
            // Set default pricing (to be updated by manager)
            basePrice: null,
            currency: 'ریال',
            isAvailable: true,
            leadTime: null,
            
            description: null,
            images: [],
            isActive: true
          }
        });
        
        importedCount++;
        console.log(`✅ Imported product ${productCode}: ${namePersian}`);
        
      } catch (error) {
        console.error(`❌ Error importing row ${index + 2}:`, error.message);
        skippedCount++;
      }
    }
    
    console.log('\n📊 Import Summary:');
    console.log(`✅ Successfully imported: ${importedCount} products`);
    console.log(`⚠️  Skipped: ${skippedCount} products`);
    console.log(`📈 Total processed: ${importedCount + skippedCount} products`);
    
  } catch (error) {
    console.error('❌ Import failed:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the import
importProducts();
