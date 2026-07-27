import assert from "node:assert/strict";
import {
  hiringTaskCapability,
  hiringTaskDetailVisible,
  hiringLifecycleStatusLabel,
  resolveSelectedHiringPhase,
  selectedHiringPhase,
  type HiringLifecycleProjection,
} from "./hiringLifecycleViewModel";

const projection: HiringLifecycleProjection = {
  currentPhaseId: "IDENTITY",
  currentPhaseNumber: 2,
  totalPhases: 7,
  terminal: false,
  phases: [
    {
      id: "APPLICATION",
      number: 1,
      title: "فرم",
      status: "COMPLETED",
      requiredComplete: 1,
      requiredTotal: 1,
      blockers: [],
      primaryAction: null,
      secondaryActions: [],
      guidance: "تکمیل شده",
      responsibleFunction: null,
    },
    {
      id: "IDENTITY",
      number: 2,
      title: "هویت",
      status: "ACTION_REQUIRED",
      requiredComplete: 0,
      requiredTotal: 1,
      blockers: [],
      primaryAction: {
        id: "REVIEW_IDENTITY",
        label: "بررسی هویت",
        authorities: ["HR_PROCESSOR"],
      },
      secondaryActions: [],
      guidance: "اقدام شما",
      responsibleFunction: "کارشناس منابع انسانی",
    },
  ],
};

assert.equal(
  resolveSelectedHiringPhase(projection, "APPLICATION"),
  "APPLICATION",
);
assert.equal(resolveSelectedHiringPhase(projection, "UNKNOWN"), "IDENTITY");
assert.equal(resolveSelectedHiringPhase(projection, null), "IDENTITY");
assert.equal(
  selectedHiringPhase(projection, "IDENTITY").primaryAction?.id,
  "REVIEW_IDENTITY",
);
assert.equal(hiringLifecycleStatusLabel.ACTION_REQUIRED, "اقدام شما");

const taskCapabilities = [
  {
    id: "SIGNED_CONTRACT",
    title: "قرارداد کاغذی",
    status: "IN_PROGRESS",
    ownerAuthorities: ["FINANCE_RECORDER", "FINANCE_MANAGER"],
    detailVisible: false,
    actionIds: [],
  },
  {
    id: "INSURANCE",
    title: "پیگیری ثبت بیمه",
    status: "IN_PROGRESS",
    ownerAuthorities: ["HR_PROCESSOR"],
    detailVisible: true,
    actionIds: ["UPDATE_INSURANCE"],
  },
];

assert.equal(
  hiringTaskDetailVisible(taskCapabilities, "SIGNED_CONTRACT"),
  false,
);
assert.equal(hiringTaskDetailVisible(taskCapabilities, "INSURANCE"), true);
assert.equal(
  hiringTaskCapability(taskCapabilities, "INSURANCE")?.actionIds[0],
  "UPDATE_INSURANCE",
);
assert.equal(hiringTaskCapability(taskCapabilities, "UNKNOWN"), null);

console.log("HR hiring lifecycle view-model tests passed.");
