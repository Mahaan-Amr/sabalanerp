"use client";
import { useParams } from "next/navigation";
import FoundationDetailPage from "@/features/hr/FoundationDetailPage";

export default function JobDetailRoute() {
  const { id } = useParams<{ id: string }>();
  return <FoundationDetailPage id={id} entityType="job" />;
}
