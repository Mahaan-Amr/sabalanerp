const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Missing mine codes from Excel that need to be added
const missingMines = [
  { code: '078', name: 'آبگرم', namePersian: 'آبگرم' },
  { code: '079', name: 'Unknown Mine 079', namePersian: 'معدن ناشناخته 079' },
  { code: '080', name: 'Unknown Mine 080', namePersian: 'معدن ناشناخته 080' },
  { code: '081', name: 'Unknown Mine 081', namePersian: 'معدن ناشناخته 081' },
  { code: '082', name: 'Unknown Mine 082', namePersian: 'معدن ناشناخته 082' },
  { code: '085', name: 'Unknown Mine 085', namePersian: 'معدن ناشناخته 085' },
  { code: '086', name: 'Unknown Mine 086', namePersian: 'معدن ناشناخته 086' },
  { code: '088', name: 'Unknown Mine 088', namePersian: 'معدن ناشناخته 088' },
  { code: '093', name: 'Unknown Mine 093', namePersian: 'معدن ناشناخته 093' },
  { code: '095', name: 'Unknown Mine 095', namePersian: 'معدن ناشناخته 095' },
  { code: '097', name: 'Unknown Mine 097', namePersian: 'معدن ناشناخته 097' },
  { code: '098', name: 'Unknown Mine 098', namePersian: 'معدن ناشناخته 098' },
  { code: '100', name: 'Unknown Mine 100', namePersian: 'معدن ناشناخته 100' },
  { code: '101', name: 'Unknown Mine 101', namePersian: 'معدن ناشناخته 101' }
];

async function addMissingMines() {
  try {
    console.log('🚀 Adding missing mine codes...');
    
    let addedCount = 0;
    
    for (const mine of missingMines) {
      try {
        await prisma.mine.create({
          data: {
            code: mine.code,
            name: mine.name,
            namePersian: mine.namePersian,
            isActive: true
          }
        });
        console.log(`✅ Added mine: ${mine.code} - ${mine.namePersian}`);
        addedCount++;
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️ Mine ${mine.code} already exists, skipping`);
        } else {
          console.error(`❌ Error adding mine ${mine.code}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Summary: Added ${addedCount} new mine codes`);
    
  } catch (error) {
    console.error('Error adding missing mines:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addMissingMines();
