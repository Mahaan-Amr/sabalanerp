import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const project = process.cwd();
const directory = path.join(project, 'reports/qa/partner-delivery');
mkdirSync(directory, { recursive: true });
const requireFrontend = createRequire(path.join(project, 'frontend/package.json'));
const { build } = requireFrontend('esbuild');
// Mount the current runtime's exact delivery JSX with a controlled fixture.
// API, recovery, and pricing are outside this presentation/interaction check.
const runtime = readFileSync(path.join(project, 'frontend/src/features/contract-creation/partner/PartnerCreationRuntime.tsx'), 'utf8');
const delivery = runtime.split("if (step === 'delivery') return ")[1].split("    if (step === 'payment')")[0];
const source = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ErpButton,ErpIconButton,ErpNeumorphicCard,ErpInlineState,ErpPressable} from '@/components/erp';
import {FaPlus,FaTrash} from 'react-icons/fa';
import {ContractDeliveryDetailsFields} from '@/features/contract-creation/components/shared/ContractWizardStepViews';
import {ContractDeliveryQuantityControl} from '@/features/contract-creation/components/shared/ContractDeliveryQuantityControl';
import {Step6DeliverySchedule} from '@/features/contract-creation/components/steps/Step6DeliverySchedule';
import {remainingPartnerAmount,stepPartnerDeliveryAmount} from '@/features/contract-creation/partner/partnerRetail';
import {normalizeNumericText,formatDisplayNumber} from '@/lib/numberFormat';
const context={customers:[{id:'customer',displayName:'مشتری آزمایشی',address:'خیابان آزمایشی'}]};
const technicalDraft={rows:[{productRowId:'stone',configuration:{widthMeters:'0.4'}}]};
const partnerQuantityUnitCopy={meter:'متر',squareMeter:'مترمربع',count:'عدد'};
const showValidationErrors=false;
const addDays=()=> '2026-10-15';
function App(){
const [draft,updateWizard]=useState({rows:[{productRowId:'stone',quantity:'14.4',unit:'meter',inquiryRow:{description:'طولی ترامیت ع۴۰ ض۲ سمیرم صیقل'}}],serviceRows:[{serviceRowId:'service',title:'خدمت آزمایشی',quantity:'2',unit:'count'}],intent:{contractDate:'2026-10-08',customerId:'customer',deliveries:[{deliveryId:'first',date:'2026-10-15',destination:'خیابان آزمایشی',receiverName:'مشتری آزمایشی',items:[],serviceItems:[]}]}});
(window as any).deliveryDraft=draft;
return ${delivery}
}
function Normal(){const [wizardData,setWizardData]=useState({products:[{rowId:'stone',productId:'catalog-stone',stoneName:'طولی ترامیت ع۴۰ ض۲ سمیرم صیقل',productType:'longitudinal',length:1.2,lengthUnit:'m',width:40,widthUnit:'cm',quantity:12,squareMeters:5.76}],serviceRows:[],deliveries:[{deliveryDate:'1405/07/23',deliveryAddress:'خیابان آزمایشی',projectManagerName:'',receiverName:'مشتری آزمایشی',products:[]}],project:{address:'خیابان آزمایشی'}});
return <Step6DeliverySchedule wizardData={wizardData as any} updateWizardData={updates=>setWizardData(current=>({...current,...updates}))} errors={{}}/>;}
const root=createRoot(document.getElementById('root')!);
(window as any).mountNormal=()=>root.render(<Normal/>);
root.render(<App/>);`;
const bundled = await build({ stdin: { contents: source, loader: 'tsx', resolveDir: path.join(project, 'frontend/src') },
  nodePaths: [path.join(project, 'frontend/node_modules')], tsconfig: path.join(project,'frontend/tsconfig.json'),
  bundle: true, write: false, format: 'iife', platform: 'browser', define: {'process.env.NODE_ENV':'"development"'},
  banner: {js:'var process={env:{}};'} });
const browser = await chromium.launch({channel:'chrome'});
try {
  const page = await browser.newPage({viewport:{width:800,height:900}});
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:3000/login');
  const styles=await page.locator('link[rel=stylesheet]').evaluateAll(nodes=>nodes.map(node=>node.outerHTML).join(''));
  await page.setContent('<!doctype html><html lang="fa" dir="rtl"><head>'+styles+'</head><body class="sds-neumorphic-workflow-scope"><main id="root" style="padding:20px"></main></body></html>');
  await page.addScriptTag({content:bundled.outputFiles[0].text});
  const quantity=page.getByRole('textbox',{name:/مقدار تحویل طولی/});
  const group=page.getByRole('group',{name:/مقدار تحویل طولی/});
  await expect(quantity).toHaveValue('0');
  await group.getByRole('button',{name:'زیاد کردن',exact:true}).click();
  await expect(quantity).toHaveValue('1');
  await group.getByRole('button',{name:'کم کردن',exact:true}).click();
  await expect(quantity).toHaveValue('0');
  await quantity.fill('0.1');
  await group.getByRole('button',{name:'زیاد کردن',exact:true}).click();
  await expect(quantity).toHaveValue('1.1');
  await page.getByRole('button',{name:'پر کردن (۱۴٫۴)',exact:true}).click();
  await expect(quantity).toHaveValue('14.4');
  await page.getByRole('button',{name:'افزودن تحویل',exact:true}).click();
  await expect(page.getByRole('heading',{name:'تحویل 2',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:/مقدار تحویل طولی/}).nth(1)).toHaveValue('0');
  await expect(page.getByRole('group',{name:/مقدار تحویل طولی/}).nth(1).getByRole('button',{name:'زیاد کردن',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'حذف تحویل 2',exact:true}).click();
  await expect(page.getByRole('heading',{name:'تحویل 2',exact:true})).toHaveCount(0);
  const observations=[];
  for (const width of [800,390]) for(const theme of ['light','dark']) for(const zoom of [1,2]) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(({theme,zoom})=>{document.documentElement.setAttribute('data-theme',theme);document.documentElement.style.zoom=String(zoom);},{theme,zoom});
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>document.documentElement.clientWidth+1);
    if (overflow) console.log({width,theme,zoom, elements:await page.locator('#root *').evaluateAll(nodes=>nodes.map(node=>({tag:node.tagName,text:node.textContent?.slice(0,45),left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right,width:node.getBoundingClientRect().width})).filter(node=>node.left<0 || node.right>document.documentElement.clientWidth+1))});
    expect(overflow).toBe(false);
    observations.push({width,theme,zoom,overflow});
    await page.screenshot({path:path.join(directory,`delivery-${width}-${theme}-${zoom}x.png`),fullPage:true});
  }
  expect(errors).toEqual([]);
  await page.evaluate(()=>{document.documentElement.style.zoom='1';document.documentElement.setAttribute('data-theme','light');});
  await page.setViewportSize({width:800,height:900});
  const metrics=async()=>({add:await page.getByRole('button',{name:'افزودن تحویل',exact:true}).evaluate(node=>({height:node.getBoundingClientRect().height,font:getComputedStyle(node).fontSize})),
    quantity:await page.getByRole('group').filter({has:page.getByRole('button',{name:'زیاد کردن',exact:true})}).first().evaluate(node=>({height:node.getBoundingClientRect().height,width:node.getBoundingClientRect().width,font:getComputedStyle(node.querySelector('input')).fontSize}))});
  const partnerMetrics=await metrics();
  await page.evaluate(()=>window.mountNormal());
  await expect(page.getByRole('button',{name:'افزودن تحویل',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'زیاد کردن',exact:true})).toHaveCount(1);
  const normalMetrics=await metrics();
  expect(partnerMetrics).toEqual(normalMetrics);
  for (const width of [800,390]) {
    await page.setViewportSize({width,height:900});
    await page.screenshot({path:path.join(directory,`normal-${width}-light.png`),fullPage:true});
  }
  writeFileSync(path.join(directory,'comparison.json'),JSON.stringify({partnerMetrics,normalMetrics},null,2));
  writeFileSync(path.join(directory,'observations.json'),JSON.stringify(observations,null,2));
  console.log('Delivery controls, exact decimal entry, add/remove, allocation limits, RTL light/dark and 200% zoom passed.');
} finally {await browser.close();}

