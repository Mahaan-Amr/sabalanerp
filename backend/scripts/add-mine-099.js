const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function addMine099() {
  try {
    console.log('🚀 Adding mine code 099...');
    
    await prisma.mine.create({
      data: {
        code: '099',
        name: 'Unknown Mine 099',
        namePersian: 'معدن ناشناخته 099',
        isActive: true
      }
    });
    
    console.log('✅ Added mine: 099 - معدن ناشناخته 099');
    
  } catch (error) {
    if (error.code === 'P2002') {
      console.log('⚠️ Mine 099 already exists, skipping');
    } else {
      console.error('❌ Error adding mine 099:', error.message);
    }
  } finally {
    await prisma.$disconnect();
  }
}

addMine099();
