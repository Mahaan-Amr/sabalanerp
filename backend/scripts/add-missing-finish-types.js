const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Missing finish type codes from Excel that need to be added
const missingFinishTypes = [
  { code: '09', name: 'Unknown Finish 09', namePersian: 'پرداخت ناشناخته 09' }
];

async function addMissingFinishTypes() {
  try {
    console.log('🚀 Adding missing finish type codes...');
    
    let addedCount = 0;
    
    for (const finish of missingFinishTypes) {
      try {
        await prisma.finishType.create({
          data: {
            code: finish.code,
            name: finish.name,
            namePersian: finish.namePersian,
            isActive: true
          }
        });
        console.log(`✅ Added finish type: ${finish.code} - ${finish.namePersian}`);
        addedCount++;
      } catch (error) {
        if (error.code === 'P2002') {
          console.log(`⚠️ Finish type ${finish.code} already exists, skipping`);
        } else {
          console.error(`❌ Error adding finish type ${finish.code}:`, error.message);
        }
      }
    }
    
    console.log(`\n📊 Summary: Added ${addedCount} new finish type codes`);
    
  } catch (error) {
    console.error('Error adding missing finish types:', error);
  } finally {
    await prisma.$disconnect();
  }
}

addMissingFinishTypes();
