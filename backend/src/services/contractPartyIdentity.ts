export class ContractPartyIdentityValidationError extends Error {
  readonly code = 'contract-party-identity-invalid';
}

interface ContractPartySnapshot {
  customerId?: unknown;
  customer?: {
    id?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    companyName?: unknown;
  } | null;
  projectId?: unknown;
  project?: { id?: unknown } | null;
}

interface ContractPartyIdentityInput {
  customerId: string;
  contractData?: ContractPartySnapshot | null;
  content?: string | null;
}

interface ContractPartyIdentityLookup {
  findCustomer(id: string): Promise<{
    id: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
  } | null>;
  findProject(id: string): Promise<{ id: string; customerId: string } | null>;
}

export const validateContractPartyChangeCompleteness = (input: {
  previousCustomerId: string;
  customerId: string;
  contractData?: ContractPartySnapshot | null;
  content?: string | null;
}): void => {
  if (input.previousCustomerId === input.customerId) return;
  if (!input.contractData || !input.content) {
    throw new ContractPartyIdentityValidationError(
      'تغییر مشتری فقط همراه با اطلاعات کامل مشتری، پروژه و متن تازه قرارداد مجاز است.'
    );
  }
};

const normalizePartyText = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const validateContractPartyIdentity = async (
  input: ContractPartyIdentityInput,
  lookup: ContractPartyIdentityLookup
): Promise<void> => {
  const customer = await lookup.findCustomer(input.customerId);
  if (!customer) throw new ContractPartyIdentityValidationError('مشتری انتخاب‌شده در CRM پیدا نشد.');

  if (!input.contractData) {
    throw new ContractPartyIdentityValidationError('اطلاعات مشتری و پروژه قرارداد باید به‌صورت کامل ارسال شود.');
  }
  const snapshotCustomerId = String(input.contractData.customerId || '');
  const customerObjectId = String(input.contractData.customer?.id || '');
  if (snapshotCustomerId !== input.customerId || customerObjectId !== input.customerId) {
    throw new ContractPartyIdentityValidationError('هویت مشتری در اطلاعات قرارداد با مشتری اصلی یکسان نیست.');
  }

  const snapshotCustomer = input.contractData.customer;
  const canonicalCustomerName = normalizePartyText(
    `${customer.firstName} ${customer.lastName}`.trim() || customer.companyName
  );
  const snapshotCustomerName = normalizePartyText(
    `${snapshotCustomer?.firstName ?? ''} ${snapshotCustomer?.lastName ?? ''}`.trim() ||
    snapshotCustomer?.companyName
  );
  if (!canonicalCustomerName || snapshotCustomerName !== canonicalCustomerName) {
    throw new ContractPartyIdentityValidationError('نام مشتری در اطلاعات قرارداد با رکورد اصلی CRM یکسان نیست.');
  }
  if (!input.content || !normalizePartyText(input.content).includes(canonicalCustomerName)) {
    throw new ContractPartyIdentityValidationError('متن قرارداد با مشتری اصلی قرارداد یکسان نیست.');
  }

  const projectId = String(input.contractData.projectId || '');
  const projectObjectId = String(input.contractData.project?.id || '');
  if (!projectId || projectObjectId !== projectId) {
    throw new ContractPartyIdentityValidationError('هویت پروژه در اطلاعات قرارداد ناقص یا ناسازگار است.');
  }
  const project = await lookup.findProject(projectId);
  if (!project || project.customerId !== input.customerId) {
    throw new ContractPartyIdentityValidationError('پروژه انتخاب‌شده متعلق به مشتری اصلی قرارداد نیست.');
  }
};
