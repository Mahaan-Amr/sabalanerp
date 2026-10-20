import {draftRecord} from '@/lib/modelDraft';
import type {InventoryMasterDataKind,InventoryMasterDataValues} from './InventoryMasterDataUi';

const fields={service:['code','name','namePersian','description'],cuttingType:['code','name','namePersian','description','pricePerMeter'],
  subService:['code','name','namePersian','description','minimumQuantity','pricePerMeter','calculationBase'],
  stoneFinishing:['code','name','namePersian','description','minimumQuantity','pricePerSquareMeter','calculationBase']} as const;
export function parseInventoryMasterDataDraft(kind:InventoryMasterDataKind,value:unknown):InventoryMasterDataValues{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('CATALOG_DRAFT_INVALID');
  const row=value as Record<string,unknown>;
  if(!Array.isArray(row.images)||row.images.length!==0)throw Error('CATALOG_DRAFT_IMAGES_NOT_ARCHIVED');
  const {images,...text}=row;draftRecord(text,fields[kind],['isActive']);
  if('calculationBase' in text&&!['length','squareMeters'].includes(String(text.calculationBase)))throw Error('CATALOG_DRAFT_INVALID');
  return value as InventoryMasterDataValues;
}
export function emptyInventoryMasterDataDraft(kind:InventoryMasterDataKind,value:InventoryMasterDataValues){
  return value.images.length===0&&value.isActive&&fields[kind].every(key=>key==='calculationBase'
    ?value[key]===(kind==='stoneFinishing'?'squareMeters':'length'):value[key]==='');
}
