import type { Prisma } from '@prisma/client';

export type DispatchContractContact = {
  contractNumber: string;
  project: string;
  address: string;
  customerPhone: string;
  manager: string;
  managerPhone: string;
  sellerName?: string;
  sellerPhone?: string;
};

const object = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, unknown> : {};
const text = (...values: unknown[]) => values.find(
  (value): value is string => typeof value === 'string' && Boolean(value.trim()),
)?.trim() || '';

const select = {
  id: true,
  contractNumber: true,
  contractData: true,
  responsibleSeller: { select: {
    firstName: true, lastName: true, profile: { select: { phone: true } },
  } },
  customer: { select: {
    phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { id: 'asc' }],
      select: { number: true } },
    primaryContact: { select: { isActive: true, mobile: true, phone: true } },
    workNumber: true,
    homeNumber: true,
    projectManagerName: true,
    projectManagerNumber: true,
  } },
} satisfies Prisma.SalesContractSelect;

export async function readDispatchContractPrintSources(tx: Prisma.TransactionClient, ids: string[]) {
  const contracts = ids.length ? await tx.salesContract.findMany({
    where: { id: { in: [...new Set(ids)] } }, select,
  }) : [];
  return new Map(contracts.map(contract => {
    const data = object(contract.contractData);
    const project = object(data.project);
    const customer = object(data.customer);
    const address = text(project.address);
    const city = text(project.city);
    const profile = contract.customer;
    const primaryContact = profile.primaryContact?.isActive ? profile.primaryContact : null;
    const manager = text(project.projectManagerName, project.managerName, customer.projectManagerName, profile.projectManagerName);
    const contact: DispatchContractContact = {
      contractNumber: contract.contractNumber,
      project: text(project.projectName, project.title, project.name),
      address: address && city && !address.includes(city) ? `${city}، ${address}` : address,
      customerPhone: text(profile.phoneNumbers[0]?.number, primaryContact?.mobile, primaryContact?.phone,
        customer.phone, customer.mobile, customer.workNumber, customer.homeNumber, profile.workNumber, profile.homeNumber),
      manager,
      sellerName: [contract.responsibleSeller.firstName, contract.responsibleSeller.lastName].map(name => name.trim()).filter(Boolean).join(' '),
      sellerPhone: text(contract.responsibleSeller.profile?.phone),
      managerPhone: text(project.projectManagerNumber, project.managerPhone,
        manager && manager === text(customer.projectManagerName) ? customer.projectManagerNumber : undefined,
        manager && manager === text(profile.projectManagerName) ? profile.projectManagerNumber : undefined),
    };
    return [contract.id, { contact, contractData: contract.contractData }] as const;
  }));
}
