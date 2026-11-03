const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Missing width codes from Excel that need to be added
const missingWidths = [
  { code: '08', name: 'عرض 80', namePersian: 'عرض 80', value: 80 },
  { code: '09', name: 'عرض 90', namePersian: 'عرض 90', value: 90 }
];

async function addMissingWidths() {
  try {
    console.log('🚀 Adding missing width codes...');
    
    let addedCount = 0;
    
    for (const width of missingWidths) {
      try {
        await prisma.cutWidth.create({
          data: {
            code: width.code,
            name: width.name,
            namePersian: width.namePersian,
            value: width.value,
            isActive: true
          }
        });
        console.log(`✅ Added width: ${width.code} - ${width.name}`);
        addedCount++;
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️ Width ${width.code} already exists, skipping`);
        } else {
          console.error(`❌ Error adding width ${width.code}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Summary: Added ${addedCount} new width codes`);
    
  } catch (error) {
    console.error('Error adding missing widths:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addMissingWidths();
