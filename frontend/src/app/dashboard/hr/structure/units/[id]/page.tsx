"use client";
import { useParams } from "next/navigation";
import FoundationDetailPage from "@/features/hr/FoundationDetailPage";

export default function OrganizationalUnitDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <FoundationDetailPage id={id} entityType="organizational-unit" />;
}
