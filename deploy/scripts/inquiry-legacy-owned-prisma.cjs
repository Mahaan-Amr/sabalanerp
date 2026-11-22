'use strict';
const Module=require('node:module');
/** Wrap the application's existing client; never construct a second pool.
 * Query and transaction callbacks may only descend from an active source. */
function wrapPrismaConstructor(Original,owner,clients){
 let Wrapped;
 Wrapped=new Proxy(Original,{construct(target,args,newTarget){
  owner.assertActive();
  const original=Reflect.construct(target,args,newTarget===Wrapped?target:newTarget);
  clients.add(original);
  const client=original.$extends({query:{$allOperations({args,query}){owner.assertActive();return owner.run(()=>query(args));}}});
  const transaction=new Proxy(client.$transaction,{apply(fn,_receiver,args){owner.assertActive();return owner.run(()=>Reflect.apply(fn,client,args));}});
  return new Proxy(client,{get(target,key,receiver){return key==='$transaction'?transaction:Reflect.get(target,key,receiver);}});
 }});
 return Wrapped;
}
exports.wrapPrismaConstructor=wrapPrismaConstructor;
exports.installOwnedInquiryPrisma=function(owner){
 const clients=new Set(),wrapped=new WeakMap(),exportsCache=new WeakMap(),originalLoad=Module._load;
 const allowed=new Set(['/app/node_modules/@prisma/client/index.js','/app/node_modules/@prisma/client/default.js','/app/node_modules/.prisma/client/index.js','/app/node_modules/.prisma/client/default.js']);
 Module._load=function(request,parent,isMain){
  const resolved=Module._resolveFilename(request,parent,isMain),value=Reflect.apply(originalLoad,this,arguments);
  if(!allowed.has(resolved)||!value||typeof value.PrismaClient!=='function')return value;
  let constructor=wrapped.get(value.PrismaClient);
  if(!constructor){constructor=wrapPrismaConstructor(value.PrismaClient,owner,clients);wrapped.set(value.PrismaClient,constructor);wrapped.set(constructor,constructor);}
  let exported=exportsCache.get(value);if(!exported){const descriptors=Object.getOwnPropertyDescriptors(value);descriptors.PrismaClient={value:constructor,enumerable:true,writable:false,configurable:false};exported=Object.defineProperties(Object.create(Object.getPrototypeOf(value)),descriptors);exportsCache.set(value,exported);}return exported;
 };
 return Object.freeze({async disconnect(){for(const client of clients)await client.$disconnect();}});
};
