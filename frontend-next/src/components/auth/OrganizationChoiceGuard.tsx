"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useOrganizationContext } from "@/lib/auth/useOrganizationContext";

const ORGANIZATION_CHOICE_PATH = "/select-organization";

export default function OrganizationChoiceGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { needsOrganizationChoice, organizationId, loading } = useOrganizationContext();

  useEffect(() => {
    if (loading) {
      return;
    }

    if (needsOrganizationChoice && pathname !== ORGANIZATION_CHOICE_PATH) {
      router.replace(ORGANIZATION_CHOICE_PATH);
      return;
    }

    if (!needsOrganizationChoice && pathname === ORGANIZATION_CHOICE_PATH && organizationId) {
      router.replace("/buscador");
    }
  }, [loading, needsOrganizationChoice, organizationId, pathname, router]);

  return null;
}
