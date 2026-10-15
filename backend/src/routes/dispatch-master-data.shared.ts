import { prisma } from "../lib/prisma";
import { Prisma, PrismaClient } from "@prisma/client";
import { Response } from "express";
import { AuthRequest } from "../middleware/auth";
import { projectInternalDriverReadiness } from "../services/dispatchMasterDataPolicy";
import { HrVehicleError } from "../services/hrVehicleOperations";

export { prisma };
export const actor = (req: AuthRequest) => req.user!.id;
export const requiredText = (value: unknown, label: string) => {
  const normalized = String(value ?? "").trim();
  if (!normalized)
    throw new HrVehicleError(
      ((
        {
          fleetCode: "کد ناوگان",
          vehicleType: "نوع خودرو",
          licenceNumber: "شماره گواهینامه",
          personnelId: "پرسنل",
          driverId: "راننده",
          vehicleId: "خودرو",
          status: "وضعیت",
          plate: "پلاک",
          reason: "دلیل",
        } as Record<string, string>
      )[label] || "این فیلد") + " الزامی است. مقدار آن را وارد کنید.",
      400,
    );
  return normalized;
};
export const optionalText = (value: unknown) =>
  String(value ?? "").trim() || null;
export const parsedDate = (value: unknown, label: string) => {
  const parsed = new Date(String(value ?? ""));
  if (Number.isNaN(parsed.getTime()))
    throw new HrVehicleError(
      "تاریخ واردشده معتبر نیست. تاریخ را از تقویم دوباره انتخاب کنید.",
      400,
    );
  return parsed;
};
export const optionalDate = (value: unknown, label: string) =>
  value ? parsedDate(value, label) : null;
export const activeAt = (at: Date) => ({
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});

const conflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  ["P2002", "P2003", "P2010"].includes(error.code);
export const fail = (res: Response, error: unknown, context: string) => {
  console.error(context, error);
  if (error instanceof HrVehicleError)
    return res
      .status(error.statusCode)
      .json({ success: false, error: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const target = JSON.stringify(error.meta || {});
    const sqlCode = String(error.meta?.code || "");
    if (
      !["P2002", "P2003", "P2004", "P2034"].includes(error.code) &&
      !(
        error.code === "P2010" &&
        ["23P01", "23505", "23503", "23514", "40001"].includes(sqlCode)
      )
    ) {
      return res
        .status(500)
        .json({
          success: false,
          error:
            "سامانه نتوانست نتیجه درخواست را تأیید کند. وضعیت فعلی را بررسی کنید و فقط اگر تغییر ثبت نشده بود دوباره اقدام کنید.",
        });
    }
    const field = /fleetCode/.test(target)
      ? "کد ناوگان"
      : /licenceNumber/.test(target)
        ? "شماره گواهینامه"
        : /vin/.test(target)
          ? "شماره شاسی"
          : /personnelId/.test(target)
            ? "پرسنل انتخاب‌شده"
            : /plate/i.test(target)
              ? "پلاک"
              : "";
    const message =
      error.code === "P2002" && field
        ? `${field} قبلاً ثبت شده است. رکورد موجود را بررسی کنید.`
        : error.code === "P2003"
          ? "این رکورد سابقه وابسته دارد و قابل حذف نیست. از بایگانی استفاده کنید."
          : error.code === "P2034" || String(error.meta?.code) === "40001"
            ? "اطلاعات هم‌زمان توسط کاربر دیگری تغییر کرد. فهرست را به‌روزرسانی و نتیجه را دوباره بررسی کنید."
            : /plate/i.test(target)
              ? "پلاک در این بازه به خودروی دیگری تعلق دارد. پلاک و سابقه اعتبار آن را بررسی کنید."
              : "بازه انتخاب‌شده با اطلاعات ثبت‌شده تداخل دارد. تخصیص‌ها و برنامه‌های موجود را بررسی کنید.";
    return res.status(409).json({ success: false, error: message });
  }
  const translations: Record<string, string> = {
    "Internal driving profile was not found.":
      "پروفایل راننده پیدا نشد. فهرست را به‌روزرسانی کنید.",
    "Restore the archived profile before editing it.":
      "راننده بایگانی شده است. ابتدا او را به پیش‌نویس بازگردانید.",
    "A licence number, licence class, and future licence expiry are required for activation.":
      "فعال‌سازی راننده به شماره، پایه و تاریخ اعتبار معتبر گواهینامه نیاز دارد. مشخصات رانندگی را تکمیل کنید.",
    "An active Personnel record is required.":
      "پرسنل انتخاب‌شده فعال نیست. وضعیت پرونده پرسنل را بررسی کنید.",
    "Internal driver was not found.":
      "راننده پیدا نشد. فهرست را به‌روزرسانی کنید.",
    "Company vehicle was not found.":
      "خودرو پیدا نشد. فهرست را به‌روزرسانی کنید.",
    "An unarchived company vehicle is required.":
      "خودرو بایگانی شده یا پیدا نشد. ابتدا وضعیت آن را بررسی کنید.",
    "A current effective plate is required for activation.":
      "خودرو پلاک معتبر جاری ندارد. ابتدا پلاک را ثبت کنید.",
    "Only an unused draft may be permanently deleted.":
      "حذف دائمی فقط برای پیش‌نویس بدون سابقه مجاز است. این مورد را بایگانی کنید.",
    "Unsupported eligibility status.":
      "وضعیت صلاحیت انتخاب‌شده معتبر نیست. وضعیت مجاز را دوباره انتخاب کنید.",
    "An effective period must end after its start.":
      "زمان پایان باید بعد از زمان شروع باشد.",
  };
  const text = error instanceof Error ? error.message : "";
  if (/lifecycle transition/.test(text))
    return res
      .status(409)
      .json({
        success: false,
        error:
          "این تغییر با وضعیت فعلی پرونده مجاز نیست. فهرست را به‌روزرسانی و وضعیت جدید را بررسی کنید.",
      });
  const message =
    /[\u0600-\u06ff]/.test(text) &&
    !/prisma|constraint|database|sql/i.test(text)
      ? text
      : translations[text];
  if (message) return res.status(400).json({ success: false, error: message });
  if (
    conflict(error) ||
    (error instanceof Error && /overlap|already effective/i.test(error.message))
  ) {
    return res.status(409).json({
      success: false,
      error:
        "The requested change conflicts with existing canonical master data.",
    });
  }
  return res.status(400).json({
    success: false,
    error:
      "درخواست ذخیره قابل پردازش نبود. اطلاعات فرم حفظ شده است؛ فیلدهای الزامی و وضعیت فعلی را بررسی کنید.",
  });
};

export const internalInclude = {
  personnel: {
    include: {
      hrEmploymentRelationships: {
        orderBy: { effectiveFrom: "desc" as const },
      },
    },
  },
  eligibilityPeriods: { orderBy: { effectiveFrom: "desc" as const } },
  vehicleAssignments: {
    orderBy: { effectiveFrom: "desc" as const },
    include: {
      vehicle: {
        include: { plates: { orderBy: { effectiveFrom: "desc" as const } } },
      },
    },
  },
} as const;

export const projectDriver = (driver: any, at = new Date()) => {
  const eligibility = driver.eligibilityPeriods.find(
    (period: any) =>
      period.effectiveFrom <= at &&
      (!period.effectiveTo || period.effectiveTo > at),
  );
  const assignment = driver.vehicleAssignments.find(
    (item: any) =>
      item.effectiveFrom <= at && (!item.effectiveTo || item.effectiveTo > at),
  );
  const employment = driver.personnel.hrEmploymentRelationships.some(
    (item: any) =>
      item.status === "ACTIVE" &&
      item.effectiveFrom <= at &&
      (!item.effectiveTo || item.effectiveTo > at),
  );
  const currentPlate = assignment?.vehicle.plates.find(
    (plate: any) =>
      plate.effectiveFrom <= at &&
      (!plate.effectiveTo || plate.effectiveTo > at),
  );
  return {
    ...driver,
    source: "HR_PERSONNEL",
    currentEligibility: eligibility || null,
    currentAssignment: assignment || null,
    readiness: projectInternalDriverReadiness(
      {
        personnelActive:
          driver.personnel.isActive && !driver.personnel.archivedAt,
        activeEmployment: employment,
        eligible: eligibility?.status === "ELIGIBLE",
        drivingProfileActive: driver.status === "ACTIVE",
        licenceNumber: driver.licenceNumber,
        licenceClass: driver.licenceClass,
        licenceExpiresAt: driver.licenceExpiresAt,
        assignmentActive: Boolean(assignment),
        assignedVehicleActive: assignment
          ? assignment.vehicle.status === "ACTIVE"
          : null,
        assignedVehicleHasCurrentPlate: assignment
          ? Boolean(currentPlate)
          : null,
      },
      at,
    ),
  };
};
