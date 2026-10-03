import type { Metadata } from "next";

import { CreatePropertyForm } from "@/components/host/CreatePropertyForm";

export const metadata: Metadata = { title: "Nowy obiekt" };

/**
 * The heading lives inside the form component, not here: the contextual back
 * link sits above it and has to know whether anything has been typed yet.
 */
export default function NewHostPropertyPage() {
  return <CreatePropertyForm />;
}
