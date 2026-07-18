import assert from 'node:assert/strict';
import { ContractPrintVariant, renderContractHtml } from '../printTemplate';

const projectName = 'پروژه برج آفتاب';
const projectAddress = 'شیراز، بلوار بسیار طولانی پروژه، کوچه یک، پلاک صد و بیست و سه';
const contract = {
  id: 'contract-project-name-test',
  contractNumber: 'TEST-PROJECT-NAME',
  contractDate: '1405/04/27',
  status: 'DRAFT',
  customer: {
    firstName: 'مشتری',
    lastName: 'آزمایشی',
    nationalCode: '0012345678',
    companyName: 'شرکت آزمایشی'
  },
  items: [],
  contractData: {
    project: {
      projectName,
      address: projectAddress,
      projectManagerName: 'مدیر آزمایشی',
      projectManagerNumber: '09120000000'
    }
  }
};

const customerSection = (variant: ContractPrintVariant): string => {
  const html = renderContractHtml(contract as any, { variant });
  const match = html.match(/<h2>مشخصات مشتری و پروژه<\/h2>([\s\S]*?)<\/section>/);
  assert.ok(match, `${variant} should render the customer and project section`);
  return match[1];
};

(['original', 'summary', 'accounting', 'custom'] as ContractPrintVariant[]).forEach((variant) => {
  const section = customerSection(variant);
  assert.ok(section.includes('class="grid two-col balanced-info"'));
  assert.match(
    section,
    new RegExp(`نام پروژه:<\\/strong> ${projectName}[\\s\\S]*?آدرس پروژه:<\\/strong> ${projectAddress}[\\s\\S]*?مدیر پروژه:`)
  );
  assert.ok(!section.includes('class="full"'), `${variant} should keep project fields in two columns`);
});

const workshopHtml = renderContractHtml(contract as any, { variant: 'workshop' });
assert.ok(!workshopHtml.includes(projectName), 'workshop output should remain unchanged');
assert.ok(!workshopHtml.includes('<h2>مشخصات مشتری و پروژه</h2>'));

const unnamedProjectHtml = renderContractHtml({
  ...contract,
  contractData: { project: { address: projectAddress } }
} as any);
assert.match(unnamedProjectHtml, /نام پروژه:<\/strong> —/);

console.log('printTemplateProjectName tests passed');
