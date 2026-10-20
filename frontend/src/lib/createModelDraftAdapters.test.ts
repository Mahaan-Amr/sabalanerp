import assert from 'node:assert/strict';
import test from 'node:test';
import {parseDepartmentDraft,emptyDepartmentDraft} from '../features/departments/departmentDraft';
import {parsePotentialProjectDraft,emptyPotentialProjectDraft} from '../features/crm/potentialProjectDraft';
import {parseInventoryMasterDataDraft,emptyInventoryMasterDataDraft} from '../features/inventory/master-data/inventoryMasterDataDraft';

const department={name:'sales',namePersian:'فروش',description:'متن اصلی\nخط دوم',isActive:false};
const project={customerId:'customer',title:'پروژه',responsibleSellerId:'seller',status:'جدید',workType:'تماس',address:'آدرس',
  estimatedValue:'001.2300',probability:'۰۵',expectedCloseDate:'۱۴۰۵/۰۷/۲۸',description:'شرح اصلی',source:'معرفی'};
test('create adapters preserve exact original textual values and refuse undeclared credentials, files and schema drift',()=>{
  assert.deepEqual(parseDepartmentDraft(department),department);
  assert.deepEqual(parsePotentialProjectDraft(project),project);
  for(const invalid of [{...department,password:'secret'},{...department,isActive:'false'},{...department,attachment:new Uint8Array([1])},{name:'x'}])assert.throws(()=>parseDepartmentDraft(invalid));
  for(const invalid of [{...project,sessionToken:'secret'},{...project,probability:5},{...project,attachment:{}},{...project,description:null}])assert.throws(()=>parsePotentialProjectDraft(invalid));
});
test('inventory draft preserves untouched numeric text and blocks every unarchived image or undeclared field',()=>{
  const common={code:'001',name:'stone',namePersian:'سنگ',description:'متن',images:[],isActive:true};
  const cases=[['service',common],['cuttingType',{...common,pricePerMeter:'001.2300'}],
    ['subService',{...common,minimumQuantity:'۰۰۱',pricePerMeter:'0.0001',calculationBase:'length'}],
    ['stoneFinishing',{...common,minimumQuantity:'۰۰۱',pricePerSquareMeter:'0.0001',calculationBase:'squareMeters'}]] as const;
  for(const [kind,model] of cases){
    assert.deepEqual(parseInventoryMasterDataDraft(kind,model),model);
    for(const images of [['/uploads/original.png'],['data:image/png;base64,AA=='],[new Uint8Array([1])]])assert.throws(()=>parseInventoryMasterDataDraft(kind,{...model,images}));
    assert.throws(()=>parseInventoryMasterDataDraft(kind,{...model,password:'secret'}));
  }
  const blank={code:'',name:'',namePersian:'',description:'',images:[],isActive:true};
  assert.equal(emptyInventoryMasterDataDraft('service',blank),true);
  assert.equal(emptyInventoryMasterDataDraft('service',{...blank,isActive:false}),false);
  assert.equal(emptyInventoryMasterDataDraft('stoneFinishing',{...blank,minimumQuantity:'',pricePerSquareMeter:'',calculationBase:'length'}),false);
});
test('restoration never treats changed defaults or nontext edits as an empty form',()=>{
  assert.equal(emptyDepartmentDraft({name:'',namePersian:'',description:'',isActive:true}),true);
  assert.equal(emptyDepartmentDraft({name:'',namePersian:'',description:'',isActive:false}),false);
  const defaults={customerId:'customer',responsibleSellerId:'seller',workType:'تماس'};
  const empty={...project,title:'',address:'',estimatedValue:'',probability:'',expectedCloseDate:'',description:'',source:''};
  assert.equal(emptyPotentialProjectDraft(empty,defaults),true);
  for(const change of [{customerId:'other'},{responsibleSellerId:'other'},{workType:'جلسه'},{status:'درحال پیگیری'},{description:'نوشته'}])assert.equal(emptyPotentialProjectDraft({...empty,...change},defaults),false);
});
