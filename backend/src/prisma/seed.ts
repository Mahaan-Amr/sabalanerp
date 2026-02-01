import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import seedSecurityData from './seed-security';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting database seeding...');

  // Create departments based on Sabalan Stone's organizational structure
  const departments = [
    {
      name: 'Security',
      namePersian: 'انتظامات',
      description: 'Security and administration department'
    },
    {
      name: 'Finance',
      namePersian: 'مالی و حساب داری',
      description: 'Finance and accounting department'
    },
    {
      name: 'Warehouse',
      namePersian: 'انبار',
      description: 'Warehouse management department'
    },
    {
      name: 'Customer Affairs',
      namePersian: 'امور مشتریان',
      description: 'Customer affairs and CRM department'
    },
    {
      name: 'Sales Marketing',
      namePersian: 'فروش و بازاریابی',
      description: 'Sales and marketing department'
    },
    {
      name: 'Workshop',
      namePersian: 'کارگاه',
      description: 'Production workshop department'
    },
    {
      name: 'Procurement',
      namePersian: 'کارپرداز',
      description: 'Procurement department'
    },
    {
      name: 'Management',
      namePersian: 'مدیریت',
      description: 'Management department'
    }
  ];

  console.log('📁 Creating departments...');
  for (const dept of departments) {
    await prisma.department.upsert({
      where: { name: dept.name },
      update: {},
      create: dept
    });
  }

  // Create admin user
  console.log('👤 Creating admin user...');
  const hashedPassword = await bcrypt.hash('admin123', 12);
  
  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@sabalanerp.com' },
    update: {},
    create: {
      email: 'admin@sabalanerp.com',
      username: 'admin',
      password: hashedPassword,
      firstName: 'مدیر',
      lastName: 'سیستم',
      role: 'ADMIN',
      departmentId: (await prisma.department.findUnique({ where: { name: 'Management' } }))?.id
    }
  });

  // Create sample customer
  console.log('👥 Creating sample customer...');
  const sampleCustomer = await prisma.customer.upsert({
    where: { id: 'sample-customer-1' },
    update: {},
    create: {
      id: 'sample-customer-1',
      firstName: 'علی',
      lastName: 'احمدی',
      companyName: 'شرکت نمونه',
      email: 'ali@example.com',
      phone: '09123456789',
      address: 'تهران، خیابان ولیعصر',
      city: 'تهران',
      country: 'ایران'
    }
  });

  // Create sample contract template
  console.log('📄 Creating sample contract template...');
  const sampleTemplate = await prisma.contractTemplate.upsert({
    where: { id: 'sample-template-1' },
    update: {},
    create: {
      id: 'sample-template-1',
      name: 'Standard Sales Contract',
      namePersian: 'قرارداد فروش استاندارد',
      description: 'Standard sales contract template for stone products',
      content: `
        <div class="contract-container" style="font-family: 'Vazir', sans-serif; direction: rtl; text-align: right;">
          <!-- Header Section -->
          <div class="contract-header" style="margin-bottom: 30px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
              <div class="company-logo">
                <h1 style="color: #c0c0c0; font-size: 24px; margin: 0;">Sabalan STONE</h1>
              </div>
              <div class="document-title" style="text-align: center;">
                <h2 style="color: #c0c0c0; font-size: 20px; margin: 0;">طی نامه | قرارداد فروش</h2>
              </div>
            </div>
            
            <div class="contract-meta" style="display: flex; justify-content: space-between; margin-bottom: 20px;">
              <div>
                <span style="color: #c0c0c0;">تاریخ: </span>
                <span>{{contractDate}}</span>
              </div>
              <div>
                <span style="color: #c0c0c0;">شماره: </span>
                <span>{{contractNumber}}</span>
              </div>
              <div>
                <span style="color: #c0c0c0;">پاسخگوی مرکزی: </span>
                <span>۰۷۱۹۱۰۱۰۹۰۰</span>
              </div>
            </div>
            
            <div class="buyer-info" style="margin-bottom: 20px;">
              <div style="margin-bottom: 10px;">
                <span style="color: #c0c0c0;">نام و نام خانوادگی خریدار: </span>
                <span>{{buyerName}}</span>
              </div>
              <div style="margin-bottom: 10px;">
                <span style="color: #c0c0c0;">کد ملی: </span>
                <span>{{buyerNationalId}}</span>
              </div>
              <div style="margin-bottom: 10px;">
                <span style="color: #c0c0c0;">شماره تماس: </span>
                <span>{{buyerPhone}}</span>
              </div>
              <div>
                <span style="color: #c0c0c0;">آدرس پروژه: </span>
                <span>{{projectAddress}}</span>
              </div>
            </div>
          </div>
          
          <!-- Main Table Section -->
          <div class="contract-table" style="margin-bottom: 30px;">
            <table style="width: 100%; border-collapse: collapse; border: 1px solid #c0c0c0;">
              <thead>
                <tr style="background-color: #2a2a2a;">
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">ردیف</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">کد</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">نوع سنگ</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">قطر</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">طول</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">عرض</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">تعداد</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">متر مربع</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">في</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">قیمت کل</th>
                  <th style="border: 1px solid #c0c0c0; padding: 10px; color: #c0c0c0;">توضیحات</th>
                </tr>
              </thead>
              <tbody>
                {{tableRows}}
              </tbody>
            </table>
          </div>
          
          <!-- Footer Section -->
          <div class="contract-footer">
            <div style="margin-bottom: 20px;">
              <div style="margin-bottom: 10px;">
                <span style="color: #c0c0c0;">مبلغ كل به حروف / عدد: </span>
                <span>{{totalAmountWords}} / {{totalAmount}} ریال</span>
              </div>
              <div>
                <span style="color: #c0c0c0;">نحوه تسویه حساب: </span>
                <span>{{paymentMethod}}</span>
              </div>
            </div>
            
            <div class="terms-conditions" style="margin-bottom: 30px; font-size: 12px; line-height: 1.6;">
              <p style="color: #c0c0c0; margin-bottom: 10px;">شرایط عمومی:</p>
              <ul style="color: #c0c0c0; padding-right: 20px;">
                <li>هزینه حمل و نقل بر عهده خریدار می‌باشد.</li>
                <li>دریافت کننده فاکتور در محل پروژه نماینده قانونی خریدار محسوب می‌شود.</li>
                <li>خریدار موظف است قبل از تخلیه، کیفیت، سلامت و ابعاد سنگ تحویلی را بررسی نماید.</li>
                <li>تمام سفارشات تا تسویه نهایی نزد خریدار امانت می‌باشد.</li>
                <li>این قرارداد فقط با پرداخت کامل توسط خریدار معتبر است، در غیر این صورت فاقد اعتبار است.</li>
              </ul>
            </div>
            
            <div class="signatures" style="display: flex; justify-content: space-between;">
              <div style="text-align: center;">
                <p style="color: #c0c0c0; margin-bottom: 50px;">مهر و امضاء خریدار</p>
                <div style="border-top: 1px solid #c0c0c0; width: 150px; height: 50px;"></div>
              </div>
              <div style="text-align: center;">
                <p style="color: #c0c0c0; margin-bottom: 50px;">مهر و امضاء فروشنده</p>
                <div style="border-top: 1px solid #c0c0c0; width: 150px; height: 50px;"></div>
              </div>
              <div style="text-align: center;">
                <p style="color: #c0c0c0; margin-bottom: 50px;">تأیید مدیر فروش</p>
                <div style="border-top: 1px solid #c0c0c0; width: 150px; height: 50px;"></div>
              </div>
              <div style="text-align: center;">
                <p style="color: #c0c0c0; margin-bottom: 50px;">ثبت و تأیید حسابداری فروش</p>
                <div style="border-top: 1px solid #c0c0c0; width: 150px; height: 50px;"></div>
              </div>
            </div>
          </div>
        </div>
      `,
      variables: {
        contractDate: { type: 'date', label: 'تاریخ قرارداد', required: true },
        contractNumber: { type: 'text', label: 'شماره قرارداد', required: true, autoGenerated: true },
        buyerName: { type: 'text', label: 'نام و نام خانوادگی خریدار', required: true },
        buyerNationalId: { type: 'text', label: 'کد ملی', required: true },
        buyerPhone: { type: 'text', label: 'شماره تماس', required: true },
        projectAddress: { type: 'text', label: 'آدرس پروژه', required: true },
        totalAmount: { type: 'number', label: 'مبلغ کل', required: true, calculated: true },
        totalAmountWords: { type: 'text', label: 'مبلغ به حروف', required: true, calculated: true },
        paymentMethod: { type: 'text', label: 'نحوه تسویه حساب', required: true },
        items: { type: 'array', label: 'اقلام قرارداد', required: true, fields: {
          code: { type: 'text', label: 'کد' },
          stoneType: { type: 'text', label: 'نوع سنگ', required: true },
          thickness: { type: 'text', label: 'قطر' },
          length: { type: 'number', label: 'طول' },
          width: { type: 'number', label: 'عرض' },
          quantity: { type: 'number', label: 'تعداد' },
          squareMeter: { type: 'number', label: 'متر مربع', calculated: true },
          unitPrice: { type: 'number', label: 'قیمت واحد' },
          totalPrice: { type: 'number', label: 'قیمت کل', calculated: true },
          description: { type: 'text', label: 'توضیحات' }
        }}
      },
      structure: {
        sections: ['header', 'table', 'footer'],
        tableConfig: {
          maxRows: 9,
          columns: [
            { key: 'row', label: 'ردیف', type: 'number', autoIncrement: true },
            { key: 'code', label: 'کد', type: 'text' },
            { key: 'stoneType', label: 'نوع سنگ', type: 'text', required: true },
            { key: 'thickness', label: 'قطر', type: 'text' },
            { key: 'length', label: 'طول', type: 'number' },
            { key: 'width', label: 'عرض', type: 'number' },
            { key: 'quantity', label: 'تعداد', type: 'number' },
            { key: 'squareMeter', label: 'متر مربع', type: 'number', calculated: true },
            { key: 'unitPrice', label: 'في', type: 'number' },
            { key: 'totalPrice', label: 'قیمت کل', type: 'number', calculated: true },
            { key: 'description', label: 'توضیحات', type: 'text' }
          ]
        }
      },
      calculations: {
        formulas: {
          squareMeter: 'length * width',
          totalPrice: 'squareMeter * unitPrice',
          totalAmount: 'SUM(totalPrice)'
        },
        persianNumberConversion: true
      },
      createdBy: adminUser.id
    }
  });

  // Seed security data
  await seedSecurityData();

  console.log('✅ Database seeding completed successfully!');
  console.log('📊 Created:');
  console.log(`   - ${departments.length} departments`);
  console.log(`   - 1 admin user (admin@sabalanerp.com / admin123)`);
  console.log(`   - 1 sample customer`);
  console.log(`   - 1 sample contract template`);
  console.log(`   - 2 default shifts (Day/Night)`);
  console.log(`   - Security personnel assignment`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
